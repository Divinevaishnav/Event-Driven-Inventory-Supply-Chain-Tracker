'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Play,
  Skull,
  RotateCcw,
  RefreshCw,
  AlertOctagon,
  CheckCircle2,
  Clock,
  Radio,
  FileWarning,
  Sparkles,
} from 'lucide-react'

export interface DlqEventItem {
  id: string
  eventId: string
  eventType: string
  routingKey?: string | null
  aggregateId: string
  retryCount: number
  maxRetries: number
  lastError?: string | null
  processedAt?: string | null
  createdAt: string
}

export interface EventBusDashboardProps {
  onEventProcessed?: () => void
  className?: string
}

export function EventBusDashboard({
  onEventProcessed,
  className = '',
}: EventBusDashboardProps) {
  const [metrics, setMetrics] = useState<{
    pendingDepth: number
    processingCount: number
    processedCount: number
    dlqCount: number
  }>({
    pendingDepth: 0,
    processingCount: 0,
    processedCount: 0,
    dlqCount: 0,
  })

  const [dlqEvents, setDlqEvents] = useState<DlqEventItem[]>([])
  const [isLoadingMetrics, setIsLoadingMetrics] = useState<boolean>(false)
  const [isProcessingWorker, setIsProcessingWorker] = useState<boolean>(false)
  const [isInjectingPoison, setIsInjectingPoison] = useState<boolean>(false)
  const [requeuingId, setRequeuingId] = useState<string | null>(null)
  const [workerResultNotice, setWorkerResultNotice] = useState<string | null>(null)

  // Fetch live stats & DLQ list
  const fetchStats = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsLoadingMetrics(true)
    }
    try {
      const res = await fetch('/api/events/dlq/requeue', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        if (data.metrics) {
          setMetrics(data.metrics)
        }
        if (Array.isArray(data.dlqEvents)) {
          setDlqEvents(data.dlqEvents)
        }
      }
    } catch (err) {
      console.error('Failed to fetch event bus stats:', err)
    } finally {
      if (isManualRefresh) {
        setIsLoadingMetrics(false)
      }
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadInitialStats() {
      try {
        const res = await fetch('/api/events/dlq/requeue', { cache: 'no-store' })
        if (res.ok && !ignore) {
          const data = await res.json()
          if (data.metrics) {
            setMetrics(data.metrics)
          }
          if (Array.isArray(data.dlqEvents)) {
            setDlqEvents(data.dlqEvents)
          }
        }
      } catch (err) {
        console.error('Initial stats load error:', err)
      }
    }

    loadInitialStats()

    return () => {
      ignore = true
    }
  }, [])

  // Run Worker Batch
  const handleRunWorker = async () => {
    setIsProcessingWorker(true)
    setWorkerResultNotice(null)
    const startTime = performance.now()

    try {
      const res = await fetch('/api/events/worker/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: 10 }),
      })

      const elapsed = Math.round(performance.now() - startTime)
      const data = await res.json()

      if (res.ok && data.batchResult) {
        const { totalAttempted, processedCount, retryCount, dlqCount } =
          data.batchResult

        if (totalAttempted === 0) {
          setWorkerResultNotice(`Queue idle: No pending messages to dispatch (${elapsed}ms).`)
        } else {
          setWorkerResultNotice(
            `Batch complete: ${processedCount} processed, ${retryCount} retried, ${dlqCount} moved to DLQ in ${elapsed}ms.`
          )
        }
        await fetchStats()
        if (onEventProcessed) onEventProcessed()
      } else {
        setWorkerResultNotice(`Worker Error: ${data.error || 'Failed to process'}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Worker network error'
      setWorkerResultNotice(`Failed to trigger worker: ${msg}`)
    } finally {
      setIsProcessingWorker(false)
    }
  }

  // Simulate Poison Message
  const handleSimulatePoison = async () => {
    setIsInjectingPoison(true)
    setWorkerResultNotice(null)
    try {
      const res = await fetch('/api/events/simulate-poison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (res.ok) {
        setWorkerResultNotice(
          `Poison Pill injected: [${data.event.eventId}]. Run worker batch to test DLQ trapping.`
        )
        await fetchStats()
        if (onEventProcessed) onEventProcessed()
      }
    } catch (err: unknown) {
      console.error('Poison error:', err)
    } finally {
      setIsInjectingPoison(false)
    }
  }

  // Requeue single DLQ event
  const handleRequeue = async (eventId: string) => {
    setRequeuingId(eventId)
    try {
      const res = await fetch('/api/events/dlq/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      })
      if (res.ok) {
        setWorkerResultNotice(`Event ${eventId} requeued to PENDING.`)
        await fetchStats()
        if (onEventProcessed) onEventProcessed()
      }
    } catch (err) {
      console.error('Requeue error:', err)
    } finally {
      setRequeuingId(null)
    }
  }

  // Requeue all DLQ events
  const handleRequeueAll = async () => {
    try {
      const res = await fetch('/api/events/dlq/requeue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requeueAll: true }),
      })
      if (res.ok) {
        setWorkerResultNotice('All DLQ events requeued to PENDING.')
        await fetchStats()
        if (onEventProcessed) onEventProcessed()
      }
    } catch (err) {
      console.error('Requeue all error:', err)
    }
  }

  return (
    <Card className={`border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm shadow-md ${className}`}>
      <CardHeader className="border-b border-zinc-800/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-400 animate-pulse" />
              Messaging Bus & Dead Letter Exchange (DLX)
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400 mt-0.5">
              Asynchronous event topic exchange, outbox queue worker pipeline, and poisonous message quarantine.
            </CardDescription>
          </div>

          {/* Action Triggers */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchStats(true)}
              disabled={isLoadingMetrics}
              className="h-8 border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${isLoadingMetrics ? 'animate-spin text-cyan-400' : ''}`} />
              Refresh Bus
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSimulatePoison}
              disabled={isInjectingPoison}
              className="h-8 border-rose-900/40 bg-rose-950/20 text-rose-300 hover:bg-rose-950/40 hover:text-rose-100 text-xs"
            >
              <Skull className="h-3.5 w-3.5 mr-1 text-rose-400" />
              {isInjectingPoison ? 'Injecting...' : 'Simulate Poison Event'}
            </Button>

            <Button
              size="sm"
              onClick={handleRunWorker}
              disabled={isProcessingWorker}
              className="h-8 bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs px-3"
            >
              {isProcessingWorker ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Dispatching Queue...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
                  Run Worker Batch
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Worker Notice Toast */}
        {workerResultNotice && (
          <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3.5 py-2 text-xs font-mono text-cyan-200">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span>{workerResultNotice}</span>
          </div>
        )}

        {/* 1. Queue Health Metrics Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Pending Depth */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-medium uppercase tracking-wider">Pending Queue Depth</span>
              <Clock className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono text-white">
                {metrics.pendingDepth}
              </span>
              <span className="text-[11px] text-zinc-400 font-mono">messages waiting</span>
            </div>
          </div>

          {/* Successfully Processed */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-medium uppercase tracking-wider">Processed & Dispatched</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono text-emerald-400">
                {metrics.processedCount}
              </span>
              <span className="text-[11px] text-zinc-400 font-mono">events settled</span>
            </div>
          </div>

          {/* DLQ Count */}
          <div
            className={`rounded-lg border p-3 transition-colors ${
              metrics.dlqCount > 0
                ? 'border-rose-500/50 bg-rose-950/20 text-rose-200 ring-1 ring-rose-500/30'
                : 'border-zinc-800 bg-zinc-950/60 text-zinc-400'
            }`}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium uppercase tracking-wider text-rose-300">
                Dead Letter Queue (DLQ)
              </span>
              <AlertOctagon
                className={`h-3.5 w-3.5 ${
                  metrics.dlqCount > 0 ? 'text-rose-400 animate-pulse' : 'text-zinc-500'
                }`}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold font-mono ${
                    metrics.dlqCount > 0 ? 'text-rose-400' : 'text-zinc-300'
                  }`}
                >
                  {metrics.dlqCount}
                </span>
                <span className="text-[11px] font-mono text-zinc-400">quarantined</span>
              </div>

              {metrics.dlqCount > 0 && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleRequeueAll}
                  className="h-6 border-rose-500/40 bg-rose-950/30 text-rose-200 hover:bg-rose-900/40 text-[10px]"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Requeue All
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 2. Dead Letter Exchange (DLQ) Inspector Table */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
              <FileWarning className="h-3.5 w-3.5 text-rose-400" />
              Dead Letter Exchange (DLQ) Quarantine Inspector
            </h4>
            <span className="text-[11px] font-mono text-zinc-400">
              Max Retry Policy: 3 attempts before dead-lettering
            </span>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
            {dlqEvents.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono text-zinc-400">
                <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-1.5 opacity-80" />
                Dead Letter Queue is empty. No poisoned or unresolvable events detected.
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-zinc-950/60 border-b border-zinc-800">
                  <TableRow className="border-zinc-800 hover:bg-transparent text-xs">
                    <TableHead className="w-[180px] text-zinc-400">Event ID</TableHead>
                    <TableHead className="text-zinc-400">Event Type & Routing</TableHead>
                    <TableHead className="text-zinc-400">Aggregate (SKU)</TableHead>
                    <TableHead className="text-center text-zinc-400">Retries</TableHead>
                    <TableHead className="text-zinc-400">Failure Cause</TableHead>
                    <TableHead className="text-right text-zinc-400">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dlqEvents.map((evt) => (
                    <TableRow key={evt.id} className="border-zinc-800/80 hover:bg-rose-950/10 text-xs">
                      {/* Event ID */}
                      <TableCell className="font-mono text-zinc-200">
                        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 border border-zinc-700/60">
                          {evt.eventId}
                        </span>
                      </TableCell>

                      {/* Event Type & Routing */}
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-rose-300">{evt.eventType}</span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {evt.routingKey || 'default'}
                          </span>
                        </div>
                      </TableCell>

                      {/* Aggregate ID */}
                      <TableCell className="font-mono text-zinc-300">
                        {evt.aggregateId}
                      </TableCell>

                      {/* Retries */}
                      <TableCell className="text-center">
                        <Badge
                          variant="destructive"
                          className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-[10px] font-bold"
                        >
                          {evt.retryCount} / {evt.maxRetries}
                        </Badge>
                      </TableCell>

                      {/* Failure Cause */}
                      <TableCell className="max-w-md">
                        <div
                          className="truncate text-[11px] font-mono text-rose-300/90"
                          title={evt.lastError || ''}
                        >
                          {evt.lastError || 'Unknown processing exception'}
                        </div>
                      </TableCell>

                      {/* Action: Requeue */}
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={requeuingId === evt.eventId}
                          onClick={() => handleRequeue(evt.eventId)}
                          className="h-7 border-zinc-700 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 text-xs"
                        >
                          <RotateCcw
                            className={`h-3 w-3 mr-1 text-cyan-400 ${
                              requeuingId === evt.eventId ? 'animate-spin' : ''
                            }`}
                          />
                          Retry / Requeue
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
