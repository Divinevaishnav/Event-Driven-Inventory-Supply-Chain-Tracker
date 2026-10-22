'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Zap,
  RefreshCw,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  Warehouse,
  ShoppingBag,
  RotateCcw,
} from 'lucide-react'

export interface WarehouseOption {
  code: string
  name: string
  city?: string
}

export interface ProductOption {
  sku: string
  name: string
  category?: string
}

export interface CheckoutSimulatorProps {
  warehouses?: WarehouseOption[]
  products?: ProductOption[]
  onSuccess?: () => void
  className?: string
}

export interface DecrementedItemDetail {
  sku: string
  productName?: string
  quantity: number
  previousOnHand?: number
  newOnHand: number
  reserved?: number
  available: number
  minimumThreshold?: number
  thresholdBreached?: boolean
}

export interface CheckoutResponseBody {
  success?: boolean
  transactionId?: string
  referenceId?: string
  warehouseCode?: string
  decrementedItems?: DecrementedItemDetail[]
  error?: string
}

const DEFAULT_WAREHOUSES: WarehouseOption[] = [
  { code: 'WH-ORD-01', name: 'ORD-Chicago-01', city: 'Chicago' },
  { code: 'WH-FRA-02', name: 'FRA-Frankfurt-02', city: 'Frankfurt' },
  { code: 'WH-SIN-01', name: 'SIN-Singapore-01', city: 'Singapore' },
  { code: 'WH-NBO-01', name: 'NBO-Nairobi-01', city: 'Nairobi' },
]

const DEFAULT_PRODUCTS: ProductOption[] = [
  { sku: 'SKU-APP-HOODIE', name: 'ThermalTech Heavyweight Hoodie', category: 'Apparel' },
  { sku: 'SKU-ELEC-4090', name: 'GeForce RTX 4090 OC GPU 24GB', category: 'Electronics' },
  { sku: 'SKU-ELEC-MACB16', name: 'ProBook M3 Max 16-inch 64GB', category: 'Electronics' },
  { sku: 'SKU-APP-JACKET', name: 'All-Weather Technical Parka', category: 'Apparel' },
  { sku: 'SKU-PER-COFFEE', name: 'Single-Origin Arabica Roast 1kg', category: 'Perishables' },
  { sku: 'SKU-ELEC-HEADPH', name: 'AcousticNoise Wireless ANC', category: 'Electronics' },
  { sku: 'SKU-APP-CARGO', name: 'Ripstop Modular Cargo Pants', category: 'Apparel' },
  { sku: 'SKU-PER-MATCHA', name: 'Ceremonial Grade Uji Matcha 100g', category: 'Perishables' },
]

const DEFAULT_API_KEY = 'ak_live_apex_ecom_7f3b890a12e4'

function createInitialUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function CheckoutSimulator({
  warehouses = DEFAULT_WAREHOUSES,
  products = DEFAULT_PRODUCTS,
  onSuccess,
  className = '',
}: CheckoutSimulatorProps) {
  const [warehouseCode, setWarehouseCode] = useState<string>(
    warehouses[0]?.code || 'WH-ORD-01'
  )
  const [sku, setSku] = useState<string>(
    products[0]?.sku || 'SKU-APP-HOODIE'
  )
  const [quantity, setQuantity] = useState<number>(1)
  const [idempotencyKey, setIdempotencyKey] = useState<string>(createInitialUuid)
  const [apiKey, setApiKey] = useState<string>(DEFAULT_API_KEY)
  const [isLoading, setIsLoading] = useState<boolean>(false)

  // Simulation response state
  const [responseState, setResponseState] = useState<{
    status: number | null
    executionTimeMs: number | null
    isIdempotentHit: boolean
    body: CheckoutResponseBody | null
    timestamp: string | null
  } | null>(null)

  // Generate random UUID
  const generateNewUuid = () => {
    setIdempotencyKey(createInitialUuid())
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!sku || !warehouseCode || quantity <= 0) return

    setIsLoading(true)
    const startTime = performance.now()

    try {
      const payload = {
        idempotencyKey: idempotencyKey.trim(),
        apiKey: apiKey.trim(),
        warehouseCode: warehouseCode.trim(),
        items: [
          {
            sku: sku.trim(),
            quantity: Number(quantity),
          },
        ],
        referenceId: `ORD-SIM-${Math.floor(100000 + Math.random() * 900000)}`,
      }

      const res = await fetch('/api/inventory/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const endTime = performance.now()
      const executionTimeMs = Math.round(endTime - startTime)
      const isIdempotentHit = res.headers.get('x-idempotent-replay') === 'true'

      let data: CheckoutResponseBody
      try {
        data = (await res.json()) as CheckoutResponseBody
      } catch {
        data = { error: 'Failed to parse JSON response' }
      }

      setResponseState({
        status: res.status,
        executionTimeMs,
        isIdempotentHit,
        body: data,
        timestamp: new Date().toLocaleTimeString(),
      })

      if (res.ok && onSuccess) {
        onSuccess()
      }
    } catch (err: unknown) {
      const endTime = performance.now()
      const errorMsg = err instanceof Error ? err.message : 'Network connection failed'
      setResponseState({
        status: 500,
        executionTimeMs: Math.round(endTime - startTime),
        isIdempotentHit: false,
        body: { error: errorMsg },
        timestamp: new Date().toLocaleTimeString(),
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className={`border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm shadow-md ${className}`}>
      <CardHeader className="border-b border-zinc-800/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              Data Plane Ingestion Simulator
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400 mt-0.5">
              Simulate high-throughput synchronous checkouts via <code>POST /api/inventory/checkout</code> with ACID decrement & idempotency validation.
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-xs px-2 py-0.5 self-start sm:self-auto font-mono">
            Direct API Ingress
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Warehouse Select */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Warehouse className="h-3.5 w-3.5 text-indigo-400" />
                Target Warehouse
              </label>
              <select
                aria-label="Select Warehouse"
                value={warehouseCode}
                onChange={(e) => setWarehouseCode(e.target.value)}
                className="w-full h-8 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              >
                {warehouses.map((wh) => (
                  <option key={wh.code} value={wh.code}>
                    {wh.code} ({wh.name})
                  </option>
                ))}
              </select>
            </div>

            {/* Product SKU Select */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <ShoppingBag className="h-3.5 w-3.5 text-emerald-400" />
                Product SKU
              </label>
              <select
                aria-label="Select Product SKU"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full h-8 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
              >
                {products.map((prod) => (
                  <option key={prod.sku} value={prod.sku}>
                    {prod.sku} - {prod.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Quantity Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Quantity Units
              </label>
              <Input
                type="number"
                min={1}
                max={100000}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-8 text-xs bg-zinc-950/70 border-zinc-800 text-zinc-200"
              />
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-zinc-400" />
                API Key
              </label>
              <Input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ak_live_... or dev-checkout-key"
                className="h-8 text-xs font-mono bg-zinc-950/70 border-zinc-800 text-zinc-200"
              />
            </div>
          </div>

          {/* Idempotency Key Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <span>Idempotency-Key (UUID v4)</span>
                <span className="text-[11px] text-zinc-500 font-mono">(Ensures exact-once processing)</span>
              </label>
              <Input
                type="text"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                className="h-8 text-xs font-mono bg-zinc-950/70 border-zinc-800 text-zinc-200"
              />
            </div>

            <div className="flex items-end gap-2 pt-1 sm:pt-5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={generateNewUuid}
                title="Generate fresh UUID"
                className="h-8 border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1 text-indigo-400" />
                New UUID
              </Button>

              <Button
                type="submit"
                size="sm"
                disabled={isLoading}
                className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs px-4"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Executing ACID Tx...
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    Submit Checkout
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>

        {/* Live Feedback / Response Card */}
        {responseState && (
          <div
            className={`mt-3 rounded-lg border p-3.5 transition-all text-xs font-mono ${
              responseState.status === 200
                ? responseState.isIdempotentHit
                  ? 'border-indigo-500/40 bg-indigo-950/20 text-indigo-200'
                  : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                : responseState.status === 409
                ? 'border-amber-500/40 bg-amber-950/20 text-amber-200'
                : 'border-rose-500/40 bg-rose-950/20 text-rose-200'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                {responseState.status === 200 ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                )}
                <span className="font-bold">
                  HTTP {responseState.status}
                </span>

                {/* Idempotent Hit vs Fresh Deduction */}
                {responseState.isIdempotentHit ? (
                  <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 text-[10px] uppercase font-bold tracking-wider">
                    ⚡ IDEMPOTENT_HIT (Replay Cached)
                  </Badge>
                ) : responseState.status === 200 ? (
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] uppercase font-bold tracking-wider">
                    ✓ FRESH_DEDUCTION (Stock Mutated)
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider">
                    GATEWAY_REJECTED
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-3 text-zinc-400 text-[11px]">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {responseState.executionTimeMs}ms latency
                </span>
                <span>•</span>
                <span>{responseState.timestamp}</span>
              </div>
            </div>

            {/* Response Details Body */}
            <div className="pt-2 text-zinc-300 space-y-1">
              {responseState.status === 200 ? (
                <div>
                  <div className="text-zinc-200 font-semibold mb-1">
                    Checkout Processed for {responseState.body?.referenceId}
                  </div>
                  {responseState.body?.decrementedItems?.map((item: DecrementedItemDetail) => (
                    <div key={item.sku} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-300">
                      <span>SKU: <strong className="text-white">{item.sku}</strong></span>
                      <span>Qty: <strong className="text-white">{item.quantity}</strong></span>
                      <span>New On-Hand: <strong className="text-emerald-400">{item.newOnHand}</strong></span>
                      <span>Available: <strong className="text-indigo-300">{item.available}</strong></span>
                      {item.thresholdBreached && (
                        <span className="text-rose-400 font-bold animate-pulse">
                          ⚠️ LOW STOCK BREACH TRIGGERED
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-rose-300">
                  <span>Error: </span>
                  <strong>{responseState.body?.error || JSON.stringify(responseState.body)}</strong>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
