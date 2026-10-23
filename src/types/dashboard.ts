export interface TenantData {
  id: string
  name: string
  slug: string
  createdAt: string
  warehouses: {
    id: string
    code: string
    name: string
    city: string
    country: string
    capacity: number
  }[]
  applications: {
    id: string
    name: string
    code: string
    apiKey: string
    serviceAccounts: {
      id: string
      name: string
      workloadType: string
    }[]
  }[]
}

export interface StockBalanceItem {
  id: string
  warehouseId: string
  productId: string
  onHand: number
  reserved: number
  safetyStock: number
  updatedAt: string
  product: {
    id: string
    sku: string
    name: string
    category: string
    unitPrice: number
    minimumThreshold: number
    tenantId: string
    tenant: {
      id: string
      name: string
      slug: string
    }
  }
  warehouse: {
    id: string
    code: string
    name: string
    city: string
    country: string
    tenantId: string
    tenant: {
      id: string
      name: string
      slug: string
    }
  }
}

export interface EventLogItem {
  id: string
  eventId: string
  eventType: string
  tenantId: string
  warehouseId: string | null
  aggregateId: string
  payload: string
  status: string
  retryCount: number
  maxRetries: number
  lastError?: string | null
  processedAt?: string | null
  routingKey?: string | null
  createdAt: string
  tenant?: {
    id: string
    name: string
    slug: string
  }
  warehouse?: {
    id: string
    code: string
    name: string
    city: string
  } | null
}

export interface DashboardPayload {
  tenants: TenantData[]
  stockBalances: StockBalanceItem[]
  eventLogs: EventLogItem[]
  timestamp: string
}
