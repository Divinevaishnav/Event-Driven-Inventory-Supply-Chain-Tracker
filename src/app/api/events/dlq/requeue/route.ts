import { NextRequest, NextResponse } from 'next/server'
import { eventBus } from '@/lib/event-bus'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    let eventId: string | undefined
    let requeueAll = false

    try {
      const body = await req.json()
      if (body) {
        eventId = body.eventId
        requeueAll = Boolean(body.requeueAll)
      }
    } catch {
      // Body is empty -> defaults
    }

    if (requeueAll) {
      const count = await eventBus.requeueAllDlq()
      return NextResponse.json({
        success: true,
        message: `Requeued all ${count} DLQ events back to PENDING`,
        requeuedCount: count,
      })
    }

    if (!eventId) {
      return NextResponse.json(
        { error: 'eventId or requeueAll flag is required' },
        { status: 400 }
      )
    }

    const success = await eventBus.requeueDlqEvent(eventId)
    if (!success) {
      return NextResponse.json(
        { error: `Event '${eventId}' not found in DLQ` },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Event '${eventId}' requeued back to PENDING`,
      eventId,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Requeue error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  try {
    const metrics = await eventBus.getQueueMetrics()
    const dlqEvents = await prisma.eventLog.findMany({
      where: { status: 'DLQ' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return NextResponse.json({
      metrics,
      dlqEvents: dlqEvents.map((e) => ({
        id: e.id,
        eventId: e.eventId,
        eventType: e.eventType,
        routingKey: e.routingKey,
        aggregateId: e.aggregateId,
        retryCount: e.retryCount,
        maxRetries: e.maxRetries,
        lastError: e.lastError,
        processedAt: e.processedAt?.toISOString() || null,
        createdAt: e.createdAt.toISOString(),
      })),
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch DLQ events'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
