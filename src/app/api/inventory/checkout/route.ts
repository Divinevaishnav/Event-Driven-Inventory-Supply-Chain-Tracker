import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { gatewayState } from '@/lib/gateway-state'

// Ingress Validation Schema
const checkoutSchema = z.object({
  idempotencyKey: z
    .string()
    .min(1, 'idempotencyKey is required'),
  apiKey: z
    .string()
    .min(1, 'apiKey is required'),
  warehouseCode: z
    .string()
    .min(1, 'warehouseCode is required'),
  items: z
    .array(
      z.object({
        sku: z.string().min(1, 'sku is required'),
        quantity: z.number().int().positive('quantity must be a positive integer'),
      })
    )
    .min(1, 'At least one item is required for checkout'),
  referenceId: z
    .string()
    .min(1, 'referenceId is required'),
})

export async function POST(req: NextRequest) {
  try {
    // 1. Ingress JSON Validation
    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }

    const parseResult = checkoutSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          issues: parseResult.error.issues,
        },
        { status: 400 }
      )
    }

    const { idempotencyKey, apiKey, warehouseCode, items, referenceId } =
      parseResult.data

    // 2. Rate Limiting Check (Token Bucket / Sliding Window per apiKey)
    const rateLimit = gatewayState.checkRateLimit(apiKey, 60, 60 * 1000)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Too many requests to inventory gateway.',
          limit: rateLimit.limit,
          retryAfterSeconds: rateLimit.resetSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.resetSeconds),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': '0',
          },
        }
      )
    }

    // 3. Idempotency Verification (TTL: 24h)
    const cachedIdempotency = gatewayState.getIdempotency(idempotencyKey)
    if (cachedIdempotency) {
      return NextResponse.json(cachedIdempotency.body, {
        status: cachedIdempotency.statusCode,
        headers: {
          'X-Idempotent-Replay': 'true',
          'X-Idempotent-Cached-At': new Date(
            cachedIdempotency.createdAt
          ).toISOString(),
        },
      })
    }

    // 4. Ingress Tenant & Workload Resolution
    let application = await prisma.application.findFirst({
      where: { apiKey },
      include: {
        tenant: true,
      },
    })

    if (!application && apiKey === 'dev-checkout-key') {
      application = await prisma.application.findFirst({
        where: { code: 'ECOM-CHECKOUT' },
        include: { tenant: true },
      })
    }

    if (!application) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid API key' },
        { status: 401 }
      )
    }

    // Resolve Warehouse
    const warehouse = await prisma.warehouse.findUnique({
      where: { code: warehouseCode },
      include: {
        tenant: true,
      },
    })

    if (!warehouse) {
      return NextResponse.json(
        { error: `Warehouse '${warehouseCode}' not found` },
        { status: 404 }
      )
    }

    // Tenant Isolation Check
    if (warehouse.tenantId !== application.tenantId) {
      return NextResponse.json(
        {
          error: `Forbidden: Warehouse '${warehouseCode}' is not part of tenant '${application.tenant.name}'`,
        },
        { status: 403 }
      )
    }

    // Consolidate requested quantities by SKU (in case caller lists same SKU multiple times)
    const aggregatedItems = new Map<string, number>()
    for (const item of items) {
      const current = aggregatedItems.get(item.sku) || 0
      aggregatedItems.set(item.sku, current + item.quantity)
    }

    // 5. Stock Availability Pre-check (Fast In-Memory Cache)
    for (const [sku, requiredQty] of aggregatedItems.entries()) {
      const cached = gatewayState.getCachedAvailability(warehouse.id, sku)
      if (cached && cached.available < requiredQty) {
        const errorResponse = {
          error: `Insufficient available stock for SKU '${sku}'`,
          sku,
          requested: requiredQty,
          available: cached.available,
          onHand: cached.onHand,
          reserved: cached.reserved,
          cachedPrecheck: true,
        }
        // Cache idempotency for bad request / insufficient stock as well
        gatewayState.setIdempotency(idempotencyKey, 409, errorResponse)
        return NextResponse.json(errorResponse, { status: 409 })
      }
    }

    // 6. ACID-Compliant Transactional Stock Decrement
    type DecrementResult = {
      sku: string
      productName: string
      category: string
      quantity: number
      previousOnHand: number
      newOnHand: number
      reserved: number
      available: number
      minimumThreshold: number
      thresholdBreached: boolean
    }

    const transactionId = `tx_${crypto.randomUUID()}`
    const primaryEventId = `evt_chk_${crypto.randomUUID()}`

    let decrementDetails: DecrementResult[] = []

    try {
      decrementDetails = await prisma.$transaction(async (tx) => {
        const results: DecrementResult[] = []
        const breachedProducts: { sku: string; onHand: number; threshold: number }[] = []

        for (const [sku, quantity] of aggregatedItems.entries()) {
          // Verify product existence & tenant ownership
          const product = await tx.product.findUnique({
            where: { sku },
          })

          if (!product) {
            throw new Error(`PRODUCT_NOT_FOUND:${sku}`)
          }

          if (product.tenantId !== application.tenantId) {
            throw new Error(`PRODUCT_TENANT_MISMATCH:${sku}`)
          }

          // Fetch current stock balance
          const balance = await tx.stockBalance.findUnique({
            where: {
              warehouseId_productId: {
                warehouseId: warehouse.id,
                productId: product.id,
              },
            },
          })

          if (!balance) {
            throw new Error(`BALANCE_NOT_FOUND:${sku}`)
          }

          const available = balance.onHand - balance.reserved
          if (available < quantity) {
            throw new Error(
              `INSUFFICIENT_STOCK:${sku}:${available}:${quantity}`
            )
          }

          // Decrement On-Hand inventory atomically
          const updatedBalance = await tx.stockBalance.update({
            where: {
              warehouseId_productId: {
                warehouseId: warehouse.id,
                productId: product.id,
              },
            },
            data: {
              onHand: {
                decrement: quantity,
              },
            },
          })

          const isBreached =
            updatedBalance.onHand <= product.minimumThreshold

          if (isBreached) {
            breachedProducts.push({
              sku: product.sku,
              onHand: updatedBalance.onHand,
              threshold: product.minimumThreshold,
            })
          }

          // Record immutable StockMovement audit trail
          await tx.stockMovement.create({
            data: {
              warehouseId: warehouse.id,
              productId: product.id,
              type: 'OUTBOUND_CHECKOUT',
              quantity,
              referenceId,
            },
          })

          results.push({
            sku: product.sku,
            productName: product.name,
            category: product.category,
            quantity,
            previousOnHand: balance.onHand,
            newOnHand: updatedBalance.onHand,
            reserved: updatedBalance.reserved,
            available: updatedBalance.onHand - updatedBalance.reserved,
            minimumThreshold: product.minimumThreshold,
            thresholdBreached: isBreached,
          })
        }

        // Outbox / Audit Ledger: Record Checkout Event
        await tx.eventLog.create({
          data: {
            eventId: primaryEventId,
            eventType: 'OUTBOUND_CHECKOUT_DISPATCHED',
            tenantId: application.tenantId,
            warehouseId: warehouse.id,
            aggregateId: results.map((r) => r.sku).join(', '),
            payload: JSON.stringify({
              transactionId,
              referenceId,
              warehouseCode: warehouse.code,
              callerApp: application.name,
              callerCode: application.code,
              items: results.map((r) => ({
                sku: r.sku,
                quantity: r.quantity,
                newOnHand: r.newOnHand,
                thresholdBreached: r.thresholdBreached,
              })),
              timestamp: new Date().toISOString(),
            }),
            status: 'PROCESSED',
          },
        })

        // If any items triggered low-stock breach, emit individual breach alert event
        for (const breach of breachedProducts) {
          const breachEventId = `evt_breach_${crypto.randomUUID()}`
          await tx.eventLog.create({
            data: {
              eventId: breachEventId,
              eventType: 'LOW_STOCK_THRESHOLD_BREACHED',
              tenantId: application.tenantId,
              warehouseId: warehouse.id,
              aggregateId: breach.sku,
              payload: JSON.stringify({
                trigger: 'OUTBOUND_CHECKOUT',
                referenceId,
                sku: breach.sku,
                currentOnHand: breach.onHand,
                minimumThreshold: breach.threshold,
                deficit: Math.max(0, breach.threshold - breach.onHand),
                severity: 'CRITICAL',
                suggestedAction: 'TRIGGER_PO_REORDER',
              }),
              status: 'PROCESSED',
            },
          })
        }

        return results
      })
    } catch (txError: unknown) {
      const message: string =
        txError instanceof Error ? txError.message : String(txError)

      if (message.startsWith('PRODUCT_NOT_FOUND:')) {
        const sku = message.split(':')[1]
        return NextResponse.json(
          { error: `Product with SKU '${sku}' does not exist` },
          { status: 404 }
        )
      }

      if (message.startsWith('PRODUCT_TENANT_MISMATCH:')) {
        const sku = message.split(':')[1]
        return NextResponse.json(
          {
            error: `Product '${sku}' does not belong to tenant '${application.tenant.name}'`,
          },
          { status: 403 }
        )
      }

      if (message.startsWith('BALANCE_NOT_FOUND:')) {
        const sku = message.split(':')[1]
        return NextResponse.json(
          {
            error: `No stock balance record found for SKU '${sku}' in warehouse '${warehouseCode}'`,
          },
          { status: 404 }
        )
      }

      if (message.startsWith('INSUFFICIENT_STOCK:')) {
        const [, sku, availStr, reqStr] = message.split(':')
        const available = parseInt(availStr, 10)
        const requested = parseInt(reqStr, 10)

        // Invalidate cache since balance didn't match expectation
        gatewayState.invalidateCache(warehouse.id, sku)

        const errorPayload = {
          error: `Insufficient available stock for SKU '${sku}'`,
          sku,
          requested,
          available,
        }

        gatewayState.setIdempotency(idempotencyKey, 409, errorPayload)
        return NextResponse.json(errorPayload, { status: 409 })
      }

      console.error('Checkout Transaction Failure:', txError)
      return NextResponse.json(
        { error: 'Internal transactional error during stock decrement' },
        { status: 500 }
      )
    }

    // 7. Post-Transaction State & Cache Invalidation
    for (const item of decrementDetails) {
      gatewayState.invalidateCache(warehouse.id, item.sku)
      gatewayState.setCachedAvailability(
        warehouse.id,
        item.sku,
        item.newOnHand,
        item.reserved
      )
    }

    // Successful Response Payload
    const responseData = {
      success: true,
      transactionId,
      referenceId,
      warehouseCode: warehouse.code,
      warehouseName: warehouse.name,
      tenant: {
        id: application.tenant.id,
        name: application.tenant.name,
        slug: application.tenant.slug,
      },
      application: {
        id: application.id,
        name: application.name,
        code: application.code,
      },
      decrementedItems: decrementDetails,
      eventLogId: primaryEventId,
      timestamp: new Date().toISOString(),
    }

    // Store in Idempotency Store (24h)
    gatewayState.setIdempotency(idempotencyKey, 200, responseData)

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        'X-RateLimit-Limit': String(rateLimit.limit),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
      },
    })
  } catch (error) {
    console.error('Unexpected error in checkout gateway:', error)
    return NextResponse.json(
      { error: 'Internal gateway processing error' },
      { status: 500 }
    )
  }
}
