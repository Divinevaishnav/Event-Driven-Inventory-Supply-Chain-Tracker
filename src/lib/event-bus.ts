// Multi-Tenant Event Bus & Dead Letter Exchange (DLX) Engine
// Simulates AMQP Topic Exchange & JetStream Queue Worker Pipeline

import { prisma } from '@/lib/prisma'

export interface EventPayload {
  eventId: string
  eventType: string
  routingKey?: string | null
  aggregateId: string
  tenantId: string
  warehouseId?: string | null
  payload: string
  retryCount: number
  maxRetries: number
  status: string
  createdAt: Date
}

export type EventHandler = (event: EventPayload) => Promise<void>

export interface IEventBroker {
  publish(topic: string, event: EventPayload): Promise<void>
  subscribe(topic: string, handler: EventHandler): void
}

export interface WorkerBatchResult {
  batchSize: number
  totalAttempted: number
  processedCount: number
  retryCount: number
  dlqCount: number
  durationMs: number
  events: {
    eventId: string
    eventType: string
    routingKey?: string | null
    status: 'PROCESSED' | 'PENDING' | 'DLQ'
    retryCount: number
    maxRetries: number
    error?: string
  }[]
}

export interface QueueMetrics {
  pendingDepth: number
  processingCount: number
  processedCount: number
  dlqCount: number
  timestamp: string
}

class EventBusEngine implements IEventBroker {
  private subscribers: Map<string, EventHandler[]> = new Map()

  constructor() {
    this.registerDefaultSubscribers()
  }

  // -------------------------------------------------------------
  // 1. Subscription Registry (Topic / Routing Key)
  // -------------------------------------------------------------
  subscribe(topic: string, handler: EventHandler): void {
    const handlers = this.subscribers.get(topic) || []
    handlers.push(handler)
    this.subscribers.set(topic, handlers)
  }

  async publish(topic: string, event: EventPayload): Promise<void> {
    const handlers: EventHandler[] = []

    // 1. Exact match on routingKey or eventType
    if (this.subscribers.has(topic)) {
      handlers.push(...(this.subscribers.get(topic) || []))
    }

    // 2. Wildcard pattern match (e.g. inventory.events.*)
    for (const [registeredTopic, list] of this.subscribers.entries()) {
      if (registeredTopic.endsWith('*')) {
        const prefix = registeredTopic.slice(0, -1)
        if (topic.startsWith(prefix) && registeredTopic !== topic) {
          handlers.push(...list)
        }
      }
    }

    if (handlers.length === 0) {
      // Default handler if no explicit subscribers
      return
    }

    // Execute handlers sequentially or in parallel
    for (const handler of handlers) {
      await handler(event)
    }
  }

  // -------------------------------------------------------------
  // 2. Default Domain Subscribers
  // -------------------------------------------------------------
  private registerDefaultSubscribers(): void {
    // A. Successful Outbound Checkout / Stock Deducted Handler
    this.subscribe('inventory.events.deducted', async (event) => {
      // Parse payload to verify integrity
      let parsed: { transactionId?: string; referenceId?: string; items?: unknown[] } = {}
      try {
        parsed = JSON.parse(event.payload)
      } catch {
        throw new Error('PayloadCorruptedException: Failed to parse event JSON.')
      }

      if (!parsed.referenceId) {
        throw new Error('InvalidEventDataException: Missing required referenceId.')
      }

      // Simulated async work: dispatch to ERP replica or external sync
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // Also alias by eventType
    this.subscribe('INVENTORY_DEDUCTED', async (event) => {
      await this.publish('inventory.events.deducted', event)
    })

    // B. Low Stock Threshold Breach Handler (Triggers auto reorder workflow)
    this.subscribe('inventory.events.reorder', async (event) => {
      try {
        JSON.parse(event.payload)
      } catch {
        throw new Error('PayloadCorruptedException: Unparseable threshold breach payload.')
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    this.subscribe('LOW_STOCK_THRESHOLD_BREACHED', async (event) => {
      await this.publish('inventory.events.reorder', event)
    })

    // C. Poison Pill / Chaos Simulation Handler (Deliberately throws validation error)
    this.subscribe('inventory.events.corrupt', async (event) => {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(event.payload)
      } catch {
        throw new Error('DeadLetterException: Malformed JSON syntax in poison event.')
      }

      if (parsed.errorSimulation || (typeof parsed.invalidQuantity === 'number' && parsed.invalidQuantity < 0)) {
        throw new Error(
          `PayloadValidationException: Schema corrupted. Negative quantity '${parsed.invalidQuantity}' rejected by consumer contract.`
        )
      }

      throw new Error('DeadLetterException: Simulated poison event validation failure.')
    })

    this.subscribe('CORRUPT_PAYLOAD_TEST', async (event) => {
      await this.publish('inventory.events.corrupt', event)
    })
  }

  // -------------------------------------------------------------
  // 3. Queue Worker Pipeline (processPendingEvents)
  // -------------------------------------------------------------
  async processPendingEvents(batchSize: number = 10): Promise<WorkerBatchResult> {
    const startTime = performance.now()

    // 1. Query pending events
    const pendingEvents = await prisma.eventLog.findMany({
      where: {
        status: 'PENDING',
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: batchSize,
    })

    if (pendingEvents.length === 0) {
      return {
        batchSize,
        totalAttempted: 0,
        processedCount: 0,
        retryCount: 0,
        dlqCount: 0,
        durationMs: Math.round(performance.now() - startTime),
        events: [],
      }
    }

    const eventIds = pendingEvents.map((e) => e.id)

    // 2. Atomically transition to PROCESSING
    await prisma.eventLog.updateMany({
      where: {
        id: { in: eventIds },
      },
      data: {
        status: 'PROCESSING',
      },
    })

    const results: WorkerBatchResult['events'] = []
    let processedCount = 0
    let retryCount = 0
    let dlqCount = 0

    // 3. Process each event sequentially
    for (const event of pendingEvents) {
      const topic = event.routingKey || event.eventType

      try {
        await this.publish(topic, event)

        // Success: Mark as PROCESSED
        await prisma.eventLog.update({
          where: { id: event.id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
            lastError: null,
          },
        })

        processedCount++
        results.push({
          eventId: event.eventId,
          eventType: event.eventType,
          routingKey: event.routingKey,
          status: 'PROCESSED',
          retryCount: event.retryCount,
          maxRetries: event.maxRetries,
        })
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        const nextRetry = event.retryCount + 1

        if (nextRetry < event.maxRetries) {
          // Retryable failure: Return to PENDING with updated retry count
          await prisma.eventLog.update({
            where: { id: event.id },
            data: {
              status: 'PENDING',
              retryCount: nextRetry,
              lastError: errorMessage,
            },
          })

          retryCount++
          results.push({
            eventId: event.eventId,
            eventType: event.eventType,
            routingKey: event.routingKey,
            status: 'PENDING',
            retryCount: nextRetry,
            maxRetries: event.maxRetries,
            error: errorMessage,
          })
        } else {
          // Exhausted maxRetries: Route to DEAD LETTER EXCHANGE (DLQ)
          console.warn(
            `[DLX WARNING] Event ${event.eventId} exceeded max retries (${nextRetry}/${event.maxRetries}). Moving to DLQ.`
          )

          await prisma.eventLog.update({
            where: { id: event.id },
            data: {
              status: 'DLQ',
              retryCount: nextRetry,
              lastError: `DLX_MOVED: ${errorMessage}`,
              processedAt: new Date(),
            },
          })

          dlqCount++
          results.push({
            eventId: event.eventId,
            eventType: event.eventType,
            routingKey: event.routingKey,
            status: 'DLQ',
            retryCount: nextRetry,
            maxRetries: event.maxRetries,
            error: `DLX_MOVED: ${errorMessage}`,
          })
        }
      }
    }

    const durationMs = Math.round(performance.now() - startTime)

    return {
      batchSize,
      totalAttempted: pendingEvents.length,
      processedCount,
      retryCount,
      dlqCount,
      durationMs,
      events: results,
    }
  }

  // -------------------------------------------------------------
  // 4. DLQ Requeue & Repair Functions
  // -------------------------------------------------------------
  async requeueDlqEvent(eventId: string): Promise<boolean> {
    const updated = await prisma.eventLog.updateMany({
      where: {
        eventId,
        status: 'DLQ',
      },
      data: {
        status: 'PENDING',
        retryCount: 0,
        lastError: null,
      },
    })
    return updated.count > 0
  }

  async requeueAllDlq(): Promise<number> {
    const updated = await prisma.eventLog.updateMany({
      where: {
        status: 'DLQ',
      },
      data: {
        status: 'PENDING',
        retryCount: 0,
        lastError: null,
      },
    })
    return updated.count
  }

  // -------------------------------------------------------------
  // 5. Health & Queue Depth Metrics
  // -------------------------------------------------------------
  async getQueueMetrics(): Promise<QueueMetrics> {
    const [pendingDepth, processingCount, processedCount, dlqCount] =
      await Promise.all([
        prisma.eventLog.count({ where: { status: 'PENDING' } }),
        prisma.eventLog.count({ where: { status: 'PROCESSING' } }),
        prisma.eventLog.count({ where: { status: 'PROCESSED' } }),
        prisma.eventLog.count({ where: { status: 'DLQ' } }),
      ])

    return {
      pendingDepth,
      processingCount,
      processedCount,
      dlqCount,
      timestamp: new Date().toISOString(),
    }
  }
}

// Preserve across hot reloads in dev mode
const globalForEventBus = globalThis as unknown as {
  eventBusEngine: EventBusEngine | undefined
}

export const eventBus =
  globalForEventBus.eventBusEngine ?? new EventBusEngine()

if (process.env.NODE_ENV !== 'production') {
  globalForEventBus.eventBusEngine = eventBus
}
