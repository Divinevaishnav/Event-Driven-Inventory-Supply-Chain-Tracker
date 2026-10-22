// Thread-safe / memory-backed Data Plane Gateway utility
// Handles Idempotency Store, Token Bucket / Sliding Window Rate Limiting, and Fast Availability Caching

export interface IdempotencyRecord {
  statusCode: number
  body: unknown
  createdAt: number
  expiresAt: number
}

export interface RateLimitStatus {
  allowed: boolean
  remaining: number
  limit: number
  resetSeconds: number
}

export interface CachedAvailability {
  sku: string
  warehouseId: string
  onHand: number
  reserved: number
  available: number
  cachedAt: number
  expiresAt: number
}

class GatewayStateManager {
  private idempotencyStore = new Map<string, IdempotencyRecord>()
  private rateLimitStore = new Map<string, number[]>() // sliding window timestamps
  private availabilityCache = new Map<string, CachedAvailability>()

  // -------------------------------------------------------------
  // 1. Idempotency Store (TTL default 24h)
  // -------------------------------------------------------------
  getIdempotency(key: string): IdempotencyRecord | null {
    const record = this.idempotencyStore.get(key)
    if (!record) return null

    if (Date.now() > record.expiresAt) {
      this.idempotencyStore.delete(key)
      return null
    }

    return record
  }

  setIdempotency(
    key: string,
    statusCode: number,
    body: unknown,
    ttlMs: number = 24 * 60 * 60 * 1000 // 24 hours
  ): void {
    const now = Date.now()
    this.idempotencyStore.set(key, {
      statusCode,
      body,
      createdAt: now,
      expiresAt: now + ttlMs,
    })
  }

  // -------------------------------------------------------------
  // 2. Rate Limiter (Sliding Window: e.g. 60 requests / 60 seconds per caller)
  // -------------------------------------------------------------
  checkRateLimit(
    callerKey: string,
    limit: number = 60,
    windowMs: number = 60 * 1000
  ): RateLimitStatus {
    const now = Date.now()
    const windowStart = now - windowMs

    const timestamps = this.rateLimitStore.get(callerKey) || []
    // Filter timestamps within current window
    const validTimestamps = timestamps.filter((t) => t > windowStart)

    if (validTimestamps.length >= limit) {
      const oldestInWindow = validTimestamps[0]
      const resetSeconds = Math.max(
        1,
        Math.ceil((oldestInWindow + windowMs - now) / 1000)
      )

      this.rateLimitStore.set(callerKey, validTimestamps)
      return {
        allowed: false,
        remaining: 0,
        limit,
        resetSeconds,
      }
    }

    // Record request timestamp
    validTimestamps.push(now)
    this.rateLimitStore.set(callerKey, validTimestamps)

    return {
      allowed: true,
      remaining: limit - validTimestamps.length,
      limit,
      resetSeconds: Math.ceil(windowMs / 1000),
    }
  }

  // -------------------------------------------------------------
  // 3. Fast Availability Cache (TTL e.g. 30 seconds)
  // -------------------------------------------------------------
  getCacheKey(warehouseId: string, sku: string): string {
    return `${warehouseId}:${sku.toUpperCase()}`
  }

  getCachedAvailability(
    warehouseId: string,
    sku: string
  ): CachedAvailability | null {
    const key = this.getCacheKey(warehouseId, sku)
    const cached = this.availabilityCache.get(key)
    if (!cached) return null

    if (Date.now() > cached.expiresAt) {
      this.availabilityCache.delete(key)
      return null
    }

    return cached
  }

  setCachedAvailability(
    warehouseId: string,
    sku: string,
    onHand: number,
    reserved: number,
    ttlMs: number = 30 * 1000 // 30s TTL
  ): void {
    const key = this.getCacheKey(warehouseId, sku)
    const now = Date.now()
    this.availabilityCache.set(key, {
      sku: sku.toUpperCase(),
      warehouseId,
      onHand,
      reserved,
      available: onHand - reserved,
      cachedAt: now,
      expiresAt: now + ttlMs,
    })
  }

  invalidateCache(warehouseId: string, sku?: string): void {
    if (sku) {
      const key = this.getCacheKey(warehouseId, sku)
      this.availabilityCache.delete(key)
    } else {
      // Invalidate all items for this warehouse
      for (const [key] of this.availabilityCache.entries()) {
        if (key.startsWith(`${warehouseId}:`)) {
          this.availabilityCache.delete(key)
        }
      }
    }
  }

  // Helper to clear stores (for tests/reset)
  reset(): void {
    this.idempotencyStore.clear()
    this.rateLimitStore.clear()
    this.availabilityCache.clear()
  }
}

// Preserve across hot-reloading in dev mode
const globalForGateway = globalThis as unknown as {
  gatewayState: GatewayStateManager | undefined
}

export const gatewayState =
  globalForGateway.gatewayState ?? new GatewayStateManager()

if (process.env.NODE_ENV !== 'production') {
  globalForGateway.gatewayState = gatewayState
}
