import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    let customReason = 'Simulated poison pill payload: negative quantity & schema corruption'
    try {
      const body = await req.json()
      if (body && typeof body.reason === 'string') {
        customReason = body.reason
      }
    } catch {
      // Body is optional
    }

    // Resolve tenant and warehouse from seed
    const tenant = await prisma.tenant.findFirst()
    const warehouse = await prisma.warehouse.findFirst()

    if (!tenant) {
      return NextResponse.json(
        { error: 'No tenant available to associate poison event' },
        { status: 400 }
      )
    }

    const eventId = `evt_poison_${crypto.randomUUID()}`

    const poisonEvent = await prisma.eventLog.create({
      data: {
        eventId,
        eventType: 'CORRUPT_PAYLOAD_TEST',
        routingKey: 'inventory.events.corrupt',
        tenantId: tenant.id,
        warehouseId: warehouse?.id || null,
        aggregateId: 'SKU-POISON-ERR',
        payload: JSON.stringify({
          errorSimulation: true,
          invalidQuantity: -999,
          cause: customReason,
          injectedAt: new Date().toISOString(),
        }),
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Poison event injected with status PENDING',
      event: {
        id: poisonEvent.id,
        eventId: poisonEvent.eventId,
        eventType: poisonEvent.eventType,
        routingKey: poisonEvent.routingKey,
        status: poisonEvent.status,
        retryCount: poisonEvent.retryCount,
        maxRetries: poisonEvent.maxRetries,
        createdAt: poisonEvent.createdAt.toISOString(),
      },
    })
  } catch (error: unknown) {
    console.error('Poison simulation failed:', error)
    const msg = error instanceof Error ? error.message : 'Simulation failed'
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    )
  }
}
