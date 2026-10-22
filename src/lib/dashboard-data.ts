import { prisma } from '@/lib/prisma'
import { DashboardPayload } from '@/types/dashboard'

export async function getDashboardData(): Promise<DashboardPayload> {
  const tenantsRaw = await prisma.tenant.findMany({
    include: {
      warehouses: true,
      applications: {
        include: {
          serviceAccounts: true,
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  })

  const stockBalancesRaw = await prisma.stockBalance.findMany({
    include: {
      product: {
        include: {
          tenant: true,
        },
      },
      warehouse: {
        include: {
          tenant: true,
        },
      },
    },
    orderBy: [
      { onHand: 'asc' }, // Prioritize low-stock critical items first
      { warehouse: { code: 'asc' } },
    ],
  })

  const eventLogsRaw = await prisma.eventLog.findMany({
    include: {
      tenant: true,
      warehouse: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 25,
  })

  return {
    tenants: tenantsRaw.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt.toISOString(),
      warehouses: t.warehouses.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        city: w.city,
        country: w.country,
        capacity: w.capacity,
      })),
      applications: t.applications.map((a) => ({
        id: a.id,
        name: a.name,
        code: a.code,
        apiKey: a.apiKey,
        serviceAccounts: a.serviceAccounts.map((s) => ({
          id: s.id,
          name: s.name,
          workloadType: s.workloadType,
        })),
      })),
    })),
    stockBalances: stockBalancesRaw.map((sb) => ({
      id: sb.id,
      warehouseId: sb.warehouseId,
      productId: sb.productId,
      onHand: sb.onHand,
      reserved: sb.reserved,
      safetyStock: sb.safetyStock,
      updatedAt: sb.updatedAt.toISOString(),
      product: {
        id: sb.product.id,
        sku: sb.product.sku,
        name: sb.product.name,
        category: sb.product.category,
        unitPrice: sb.product.unitPrice,
        minimumThreshold: sb.product.minimumThreshold,
        tenantId: sb.product.tenantId,
        tenant: {
          id: sb.product.tenant.id,
          name: sb.product.tenant.name,
          slug: sb.product.tenant.slug,
        },
      },
      warehouse: {
        id: sb.warehouse.id,
        code: sb.warehouse.code,
        name: sb.warehouse.name,
        city: sb.warehouse.city,
        country: sb.warehouse.country,
        tenantId: sb.warehouse.tenantId,
        tenant: {
          id: sb.warehouse.tenant.id,
          name: sb.warehouse.tenant.name,
          slug: sb.warehouse.tenant.slug,
        },
      },
    })),
    eventLogs: eventLogsRaw.map((e) => ({
      id: e.id,
      eventId: e.eventId,
      eventType: e.eventType,
      tenantId: e.tenantId,
      warehouseId: e.warehouseId,
      aggregateId: e.aggregateId,
      payload: e.payload,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
      tenant: e.tenant
        ? {
          id: e.tenant.id,
          name: e.tenant.name,
          slug: e.tenant.slug,
        }
        : undefined,
      warehouse: e.warehouse
        ? {
          id: e.warehouse.id,
          code: e.warehouse.code,
          name: e.warehouse.name,
          city: e.warehouse.city,
        }
        : null,
    })),
    timestamp: new Date().toISOString(),
  }
}
