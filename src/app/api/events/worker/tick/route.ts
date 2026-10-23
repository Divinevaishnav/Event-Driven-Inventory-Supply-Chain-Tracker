import { NextRequest, NextResponse } from 'next/server'
import { eventBus } from '@/lib/event-bus'

export async function POST(req: NextRequest) {
  try {
    let batchSize = 10
    try {
      const body = await req.json()
      if (body && typeof body.batchSize === 'number') {
        batchSize = Math.max(1, Math.min(100, body.batchSize))
      }
    } catch {
      // Body is optional; default batchSize 10
    }

    const result = await eventBus.processPendingEvents(batchSize)
    const metrics = await eventBus.getQueueMetrics()

    return NextResponse.json({
      success: true,
      batchResult: result,
      queueMetrics: metrics,
      timestamp: new Date().toISOString(),
    })
  } catch (error: unknown) {
    console.error('Queue worker tick failed:', error)
    const msg = error instanceof Error ? error.message : 'Worker execution error'
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    )
  }
}
