'use client'

import React, { useState, useMemo } from 'react'
import {
  DashboardPayload,
  StockBalanceItem,
  EventLogItem,
} from '@/types/dashboard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Activity,
  Layers,
  Radio,
  Boxes,
  Warehouse,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  Building2,
  RefreshCw,
  FileCode,
  ArrowDownLeft,
  ArrowUpRight,
  BookmarkCheck,
  ClipboardCopy,
  Check,
  SlidersHorizontal,
  Server,
} from 'lucide-react'
import { CheckoutSimulator } from '@/components/CheckoutSimulator'
import { EventBusDashboard } from '@/components/EventBusDashboard'

interface Props {
  initialData: DashboardPayload
}

export function ControlPlaneDashboard({ initialData }: Props) {
  const [data, setData] = useState<DashboardPayload>(initialData)
  const [selectedTenantSlug, setSelectedTenantSlug] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all')
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [selectedEvent, setSelectedEvent] = useState<EventLogItem | null>(null)
  const [copiedSku, setCopiedSku] = useState<string | null>(null)

  // Trigger manual refresh via API
  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch('/api/dashboard', { cache: 'no-store' })
      if (res.ok) {
        const freshData: DashboardPayload = await res.json()
        setData(freshData)
      }
    } catch (err) {
      console.error('Refresh error:', err)
    } finally {
      setTimeout(() => setIsRefreshing(false), 400)
    }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedSku(id)
    setTimeout(() => setCopiedSku(null), 1500)
  }

  // Filter stock balances by tenant
  const filteredByTenantStock = useMemo(() => {
    if (selectedTenantSlug === 'all') return data.stockBalances
    return data.stockBalances.filter(
      (sb) => sb.warehouse.tenant.slug === selectedTenantSlug
    )
  }, [data.stockBalances, selectedTenantSlug])

  // Low stock status calculation
  const getStockStatus = (sb: StockBalanceItem) => {
    if (sb.onHand <= sb.product.minimumThreshold) {
      return 'Critical Low'
    }
    if (
      sb.onHand <= sb.product.minimumThreshold * 1.25 ||
      sb.onHand <= sb.safetyStock
    ) {
      return 'Warning'
    }
    return 'Healthy'
  }

  // KPI calculations
  const kpis = useMemo(() => {
    // Unique SKUs in current view
    const uniqueSkus = new Set(filteredByTenantStock.map((s) => s.product.sku))
    const totalOnHand = filteredByTenantStock.reduce((acc, s) => acc + s.onHand, 0)
    const totalReserved = filteredByTenantStock.reduce((acc, s) => acc + s.reserved, 0)

    // Warehouses in current view
    const warehouseCodes = new Set(filteredByTenantStock.map((s) => s.warehouse.code))

    // Critical low stock breaches
    const criticalBreaches = filteredByTenantStock.filter(
      (s) => s.onHand <= s.product.minimumThreshold
    ).length

    // Warning items
    const warningCount = filteredByTenantStock.filter(
      (s) =>
        s.onHand > s.product.minimumThreshold &&
        (s.onHand <= s.product.minimumThreshold * 1.25 || s.onHand <= s.safetyStock)
    ).length

    return {
      activeSkus: uniqueSkus.size,
      totalOnHand,
      totalReserved,
      warehousesCount: warehouseCodes.size,
      criticalBreaches,
      warningCount,
    }
  }, [filteredByTenantStock])

  // Filter stock balances by search, category, status, and warehouse
  const filteredTableData = useMemo(() => {
    return filteredByTenantStock.filter((sb) => {
      // Search filter
      const matchesSearch =
        sb.product.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sb.product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sb.warehouse.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sb.warehouse.city.toLowerCase().includes(searchQuery.toLowerCase())

      // Category filter
      const matchesCategory =
        categoryFilter === 'all' || sb.product.category === categoryFilter

      // Status filter
      const status = getStockStatus(sb)
      const matchesStatus =
        statusFilter === 'all' || status === statusFilter

      // Warehouse filter
      const matchesWarehouse =
        warehouseFilter === 'all' || sb.warehouse.code === warehouseFilter

      return matchesSearch && matchesCategory && matchesStatus && matchesWarehouse
    })
  }, [
    filteredByTenantStock,
    searchQuery,
    categoryFilter,
    statusFilter,
    warehouseFilter,
  ])

  // Filter events by tenant
  const filteredEvents = useMemo(() => {
    if (selectedTenantSlug === 'all') return data.eventLogs
    return data.eventLogs.filter(
      (e) => e.tenant?.slug === selectedTenantSlug
    )
  }, [data.eventLogs, selectedTenantSlug])

  // Distinct categories & warehouses for filters
  const categories = useMemo(() => {
    const set = new Set<string>()
    data.stockBalances.forEach((s) => set.add(s.product.category))
    return Array.from(set)
  }, [data.stockBalances])

  const availableWarehouses = useMemo(() => {
    const list: { code: string; name: string }[] = []
    const seen = new Set<string>()
    filteredByTenantStock.forEach((s) => {
      if (!seen.has(s.warehouse.code)) {
        seen.add(s.warehouse.code)
        list.push({ code: s.warehouse.code, name: s.warehouse.name })
      }
    })
    return list
  }, [filteredByTenantStock])

  const availableProducts = useMemo(() => {
    const list: { sku: string; name: string; category?: string }[] = []
    const seen = new Set<string>()
    filteredByTenantStock.forEach((s) => {
      if (!seen.has(s.product.sku)) {
        seen.add(s.product.sku)
        list.push({
          sku: s.product.sku,
          name: s.product.name,
          category: s.product.category,
        })
      }
    })
    return list
  }, [filteredByTenantStock])

  const formatEventBadge = (eventType: string) => {
    if (eventType.includes('INBOUND')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
          <ArrowDownLeft className="h-3 w-3" />
          INBOUND
        </span>
      )
    }
    if (eventType.includes('DEDUCTED')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-400 border border-blue-500/20">
          <ArrowUpRight className="h-3 w-3" />
          DEDUCTED
        </span>
      )
    }
    if (eventType.includes('CORRUPT') || eventType.includes('POISON')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-400 border border-rose-500/20">
          <AlertTriangle className="h-3 w-3" />
          POISON
        </span>
      )
    }
    if (eventType.includes('OUTBOUND') || eventType.includes('DISPATCHED')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-400 border border-cyan-500/20">
          <ArrowUpRight className="h-3 w-3" />
          OUTBOUND
        </span>
      )
    }
    if (eventType.includes('RESERVATION')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-xs font-semibold text-purple-400 border border-purple-500/20">
          <BookmarkCheck className="h-3 w-3" />
          RESERVED
        </span>
      )
    }
    if (eventType.includes('THRESHOLD') || eventType.includes('LOW_STOCK')) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-400 border border-rose-500/20 animate-pulse">
          <AlertTriangle className="h-3 w-3" />
          BREACH
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/20">
        <Activity className="h-3 w-3" />
        AUDIT
      </span>
    )
  }

  const formatRelativeTime = (isoString: string) => {
    const baseTime = new Date(data.timestamp).getTime()
    const targetTime = new Date(isoString).getTime()
    const diffMs = Math.max(0, baseTime - targetTime)
    const diffMins = Math.floor(diffMs / (1000 * 60))
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-indigo-500/30">
      {/* ================================================================ */}
      {/* 1. TOP NAVIGATION BAR */}
      {/* ================================================================ */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand & Planes Status */}
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 shadow-inner">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-tight text-white text-base">
                    EVENT-STREAM
                  </span>
                  <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 text-[10px] px-1.5 py-0 h-4">
                    Control Plane v3.0
                  </Badge>
                </div>
                <p className="text-[11px] text-zinc-400 font-mono">
                  Multi-Tenant Inventory & Supply Chain Ops
                </p>
              </div>
            </div>

            {/* System Planes Status Indicators */}
            <div className="hidden lg:flex items-center gap-3 border-l border-zinc-800/80 pl-6">
              {/* Data Plane */}
              <div className="flex items-center gap-1.5 rounded-full bg-zinc-900/90 px-2.5 py-1 text-xs border border-zinc-800">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                <span className="text-zinc-400">Data Plane:</span>
                <span className="font-medium text-emerald-400">Active</span>
              </div>

              {/* Control Plane */}
              <div className="flex items-center gap-1.5 rounded-full bg-zinc-900/90 px-2.5 py-1 text-xs border border-zinc-800">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500"></span>
                </span>
                <span className="text-zinc-400">Control Plane:</span>
                <span className="font-medium text-cyan-400">Active</span>
              </div>

              {/* Broker */}
              <div className="flex items-center gap-1.5 rounded-full bg-zinc-900/90 px-2.5 py-1 text-xs border border-zinc-800">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                <span className="text-zinc-400">Broker:</span>
                <span className="font-medium text-emerald-400">Active (In-Memory / Outbox Worker)</span>
              </div>
            </div>
          </div>

          {/* Right Controls: Tenant Selector & Refresh */}
          <div className="flex items-center gap-3">
            {/* Tenant Selector Dropdown / Segmented Toggle */}
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 p-1">
              <Building2 className="ml-2 h-4 w-4 text-zinc-400" />
              <select
                id="tenant-select"
                aria-label="Filter by Tenant"
                className="bg-transparent text-xs font-medium text-zinc-200 outline-none cursor-pointer pr-2 py-1"
                value={selectedTenantSlug}
                onChange={(e) => setSelectedTenantSlug(e.target.value)}
              >
                <option value="all" className="bg-zinc-900 text-zinc-200">
                  All Tenants ({data.tenants.length})
                </option>
                {data.tenants.map((tenant) => (
                  <option
                    key={tenant.id}
                    value={tenant.slug}
                    className="bg-zinc-900 text-zinc-200"
                  >
                    {tenant.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Refresh Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ================================================================ */}
      {/* MAIN CONTAINER */}
      {/* ================================================================ */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Active Context Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-gradient-to-r from-zinc-900/60 via-zinc-900/30 to-zinc-900/60 p-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>Supply Chain Operations Console</span>
              {selectedTenantSlug !== 'all' ? (
                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-mono text-xs">
                  Tenant: {data.tenants.find((t) => t.slug === selectedTenantSlug)?.name}
                </Badge>
              ) : (
                <Badge variant="secondary" className="font-mono text-xs">
                  Global Multi-Tenant Mesh
                </Badge>
              )}
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Control plane state synchronized with distributed database replica & event ledger.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
            <Server className="h-3.5 w-3.5 text-zinc-400" />
            <span>SQLite Engine: <strong className="text-zinc-200">Online</strong></span>
            <span className="text-zinc-600">•</span>
            <span>Sync: <strong className="text-zinc-200">{formatRelativeTime(data.timestamp)}</strong></span>
          </div>
        </div>

        {/* ================================================================ */}
        {/* 2. KPI METRICS BAR (4 CARDS) */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total Active SKUs */}
          <Card className="border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm shadow-md">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Total Active SKUs
                </CardDescription>
                <div className="rounded-md bg-blue-500/10 p-1.5 text-blue-400">
                  <Boxes className="h-4 w-4" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold text-white tracking-tight mt-1">
                {kpis.activeSkus}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                Catalog items in active distribution
              </p>
            </CardContent>
          </Card>

          {/* Card 2: Global On-Hand Units */}
          <Card className="border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm shadow-md">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Global On-Hand Units
                </CardDescription>
                <div className="rounded-md bg-indigo-500/10 p-1.5 text-indigo-400">
                  <Layers className="h-4 w-4" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold text-white tracking-tight mt-1">
                {kpis.totalOnHand.toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Reserved: <strong className="text-zinc-200">{kpis.totalReserved.toLocaleString()}</strong></span>
                <span>Available: <strong className="text-emerald-400">{(kpis.totalOnHand - kpis.totalReserved).toLocaleString()}</strong></span>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Warehouses Monitored */}
          <Card className="border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm shadow-md">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  Warehouses Monitored
                </CardDescription>
                <div className="rounded-md bg-emerald-500/10 p-1.5 text-emerald-400">
                  <Warehouse className="h-4 w-4" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold text-white tracking-tight mt-1">
                {kpis.warehousesCount}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-zinc-400 truncate">
                {availableWarehouses.map((w) => w.code).join(' • ') || 'All sites monitored'}
              </p>
            </CardContent>
          </Card>

          {/* Card 4: Critical Low-Stock Breach Counter (Highlighted with alert if > 0) */}
          <Card
            className={`border transition-all duration-300 shadow-md ${
              kpis.criticalBreaches > 0
                ? 'border-rose-500/50 bg-gradient-to-br from-rose-950/40 via-zinc-900/80 to-zinc-900/90 shadow-rose-950/40 ring-1 ring-rose-500/30'
                : 'border-zinc-800/80 bg-zinc-900/60'
            }`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription
                  className={`text-xs font-medium uppercase tracking-wider ${
                    kpis.criticalBreaches > 0 ? 'text-rose-300 font-semibold' : 'text-zinc-400'
                  }`}
                >
                  Critical Low-Stock Breach
                </CardDescription>
                <div
                  className={`rounded-md p-1.5 ${
                    kpis.criticalBreaches > 0
                      ? 'bg-rose-500/20 text-rose-400 animate-pulse'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <CardTitle
                  className={`text-3xl font-bold tracking-tight ${
                    kpis.criticalBreaches > 0 ? 'text-rose-400' : 'text-zinc-300'
                  }`}
                >
                  {kpis.criticalBreaches}
                </CardTitle>
                {kpis.criticalBreaches > 0 && (
                  <Badge variant="destructive" className="bg-rose-600 hover:bg-rose-500 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 animate-bounce">
                    Action Required
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-zinc-400">
                {kpis.criticalBreaches > 0 ? (
                  <span className="text-rose-300 font-medium">
                    {kpis.criticalBreaches} SKU balances breached replenishment threshold
                  </span>
                ) : (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> All stock balances healthy
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ================================================================ */}
        {/* 2.5 DATA PLANE CHECKOUT SIMULATOR */}
        {/* ================================================================ */}
        <CheckoutSimulator
          warehouses={availableWarehouses}
          products={availableProducts}
          onSuccess={handleRefresh}
        />

        {/* ================================================================ */}
        {/* 2.6 MESSAGING BUS & DLQ CONTROL PANEL */}
        {/* ================================================================ */}
        <EventBusDashboard onEventProcessed={handleRefresh} />

        {/* ================================================================ */}
        {/* 3. WAREHOUSE STOCK MATRIX TABLE */}
        {/* ================================================================ */}
        <Card className="border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm shadow-md">
          <CardHeader className="border-b border-zinc-800/80 pb-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                  <Warehouse className="h-4 w-4 text-indigo-400" />
                  Warehouse Stock Matrix
                </CardTitle>
                <CardDescription className="text-xs text-zinc-400 mt-0.5">
                  Real-time multi-location stock availability, reservation quotas, and threshold alerts.
                </CardDescription>
              </div>

              {/* Controls: Search, Category, Status, Warehouse filters */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Search SKU/Product */}
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                  <Input
                    type="text"
                    placeholder="Search SKU or Product..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-xs bg-zinc-950/60 border-zinc-800 text-zinc-200 placeholder:text-zinc-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Category Filter */}
                <select
                  aria-label="Filter by Category"
                  className="h-8 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 text-xs text-zinc-300 outline-none cursor-pointer"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                {/* Warehouse Filter */}
                <select
                  aria-label="Filter by Warehouse"
                  className="h-8 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 text-xs text-zinc-300 outline-none cursor-pointer"
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                >
                  <option value="all">All Warehouses</option>
                  {availableWarehouses.map((wh) => (
                    <option key={wh.code} value={wh.code}>
                      {wh.code} ({wh.name})
                    </option>
                  ))}
                </select>

                {/* Status Filter */}
                <select
                  aria-label="Filter by Stock Status"
                  className="h-8 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 text-xs text-zinc-300 outline-none cursor-pointer"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="Critical Low">Critical Low</option>
                  <option value="Warning">Warning</option>
                  <option value="Healthy">Healthy</option>
                </select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-zinc-950/40 border-b border-zinc-800/80">
                  <TableRow className="border-zinc-800/80 hover:bg-transparent">
                    <TableHead className="w-[140px] text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      SKU
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Product Name
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Category
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Warehouse
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      On-Hand
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Reserved
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Available
                    </TableHead>
                    <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Status Badge
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTableData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-32 text-center text-zinc-500">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <SlidersHorizontal className="h-6 w-6 text-zinc-600" />
                          <p>No inventory records match the current filter criteria.</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSearchQuery('')
                              setCategoryFilter('all')
                              setStatusFilter('all')
                              setWarehouseFilter('all')
                            }}
                            className="text-indigo-400 hover:text-indigo-300 text-xs"
                          >
                            Reset all filters
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTableData.map((sb) => {
                      const status = getStockStatus(sb)
                      const available = sb.onHand - sb.reserved
                      const isCritical = status === 'Critical Low'
                      const isWarning = status === 'Warning'

                      return (
                        <TableRow
                          key={sb.id}
                          className={`border-zinc-800/60 transition-colors ${
                            isCritical
                              ? 'bg-rose-950/20 hover:bg-rose-950/30'
                              : 'hover:bg-zinc-800/40'
                          }`}
                        >
                          {/* SKU */}
                          <TableCell className="font-mono text-xs font-semibold text-zinc-200">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 border border-zinc-700/60">
                                {sb.product.sku}
                              </span>
                              <button
                                onClick={() => copyToClipboard(sb.product.sku, sb.id)}
                                title="Copy SKU"
                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                              >
                                {copiedSku === sb.id ? (
                                  <Check className="h-3 w-3 text-emerald-400" />
                                ) : (
                                  <ClipboardCopy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          </TableCell>

                          {/* Product Name */}
                          <TableCell>
                            <div>
                              <div className="font-medium text-zinc-100 text-sm">
                                {sb.product.name}
                              </div>
                              <div className="text-[11px] text-zinc-400">
                                Min Threshold: {sb.product.minimumThreshold} units • ${sb.product.unitPrice.toFixed(2)}
                              </div>
                            </div>
                          </TableCell>

                          {/* Category */}
                          <TableCell>
                            <span className="inline-flex rounded-md bg-zinc-800/80 px-2 py-0.5 text-xs text-zinc-300 border border-zinc-700/40">
                              {sb.product.category}
                            </span>
                          </TableCell>

                          {/* Warehouse */}
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium text-xs text-zinc-200 flex items-center gap-1.5">
                                <span className="font-mono text-indigo-400 font-semibold">
                                  {sb.warehouse.code}
                                </span>
                                <span className="text-zinc-400">({sb.warehouse.city})</span>
                              </span>
                              <span className="text-[11px] text-zinc-400">
                                {sb.warehouse.name} • {sb.warehouse.tenant.name}
                              </span>
                            </div>
                          </TableCell>

                          {/* On-Hand */}
                          <TableCell className="text-right font-mono text-sm">
                            <span
                              className={`font-semibold ${
                                isCritical
                                  ? 'text-rose-400 underline decoration-rose-500/50'
                                  : isWarning
                                  ? 'text-amber-400'
                                  : 'text-zinc-200'
                              }`}
                            >
                              {sb.onHand}
                            </span>
                          </TableCell>

                          {/* Reserved */}
                          <TableCell className="text-right font-mono text-sm text-zinc-400">
                            {sb.reserved}
                          </TableCell>

                          {/* Available (On-Hand - Reserved) */}
                          <TableCell className="text-right font-mono text-sm">
                            <span
                              className={`font-bold ${
                                available < sb.product.minimumThreshold
                                  ? 'text-rose-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {available}
                            </span>
                          </TableCell>

                          {/* Status Badge */}
                          <TableCell className="text-center">
                            {isCritical ? (
                              <Badge
                                variant="destructive"
                                className="bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 text-xs gap-1 font-semibold"
                              >
                                <AlertTriangle className="h-3 w-3 text-rose-400" />
                                Critical Low
                              </Badge>
                            ) : isWarning ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
                                <AlertTriangle className="h-3 w-3 text-amber-400" />
                                Warning
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                Healthy
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ================================================================ */}
        {/* 4. RECENT EVENT LEDGER PREVIEW */}
        {/* ================================================================ */}
        <Card className="border-zinc-800/80 bg-zinc-900/60 backdrop-blur-sm shadow-md">
          <CardHeader className="border-b border-zinc-800/80 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                  <Radio className="h-4 w-4 text-emerald-400 animate-pulse" />
                  Recent Event Ledger
                </CardTitle>
                <CardDescription className="text-xs text-zinc-400 mt-0.5">
                  Append-only immutable event stream with payload diagnostics and processing states.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                Live Ingestion Buffer: Active
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="divide-y divide-zinc-800/60">
              {filteredEvents.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  No events found for the active tenant selection.
                </div>
              ) : (
                filteredEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 hover:bg-zinc-800/30 transition-colors gap-3 group"
                  >
                    {/* Event Type & Aggregate Info */}
                    <div className="flex items-start sm:items-center gap-3">
                      {formatEventBadge(event.eventType)}

                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <span className="font-mono text-xs font-semibold text-zinc-200">
                          {event.aggregateId}
                        </span>
                        <span className="text-zinc-600 hidden sm:inline">•</span>
                        <span className="text-xs text-zinc-400 font-mono">
                          ID: <span className="text-zinc-300">{event.eventId}</span>
                        </span>
                        {event.warehouse && (
                          <>
                            <span className="text-zinc-600 hidden sm:inline">•</span>
                            <span className="text-xs text-indigo-400 font-mono">
                              @{event.warehouse.code} ({event.warehouse.city})
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Metadata & Actions */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 self-end sm:self-auto">
                      {/* Status */}
                      <span
                        className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                          event.status === 'PROCESSED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : event.status === 'PENDING'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}
                      >
                        {event.status}
                      </span>

                      {/* Timestamp */}
                      <div className="flex items-center gap-1 text-xs text-zinc-400 font-mono" title={event.createdAt}>
                        <Clock className="h-3 w-3 text-zinc-400" />
                        <span>{formatRelativeTime(event.createdAt)}</span>
                      </div>

                      {/* Inspect Payload Button */}
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setSelectedEvent(event)}
                        className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 gap-1 text-xs h-7"
                      >
                        <FileCode className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Payload</span>
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </main>

      {/* ================================================================ */}
      {/* 5. EVENT PAYLOAD INSPECTION DIALOG MODAL */}
      {/* ================================================================ */}
      <Dialog
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => !open && setSelectedEvent(null)}
      >
        {selectedEvent && (
          <DialogContent className="max-w-2xl border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
            <DialogHeader>
              <div className="flex items-center justify-between pr-6">
                <DialogTitle className="text-base font-semibold text-white flex items-center gap-2">
                  <FileCode className="h-5 w-5 text-indigo-400" />
                  Event Payload Diagnostics
                </DialogTitle>
                {formatEventBadge(selectedEvent.eventType)}
              </div>
              <DialogDescription className="text-xs text-zinc-400">
                Detailed JSON event attributes emitted to the event stream pipeline.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-zinc-900/80 p-3 rounded-lg border border-zinc-800">
                <div>
                  <span className="text-zinc-400">Event ID:</span>{' '}
                  <span className="text-zinc-200">{selectedEvent.eventId}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Aggregate ID:</span>{' '}
                  <span className="text-zinc-200">{selectedEvent.aggregateId}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Status:</span>{' '}
                  <span className="text-emerald-400 font-bold">{selectedEvent.status}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Recorded:</span>{' '}
                  <span className="text-zinc-200">{new Date(selectedEvent.createdAt).toLocaleString()}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5 block">
                  Decoded Event Body (JSON)
                </label>
                <div className="relative">
                  <pre className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/90 p-3 text-xs font-mono text-emerald-300">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(selectedEvent.payload), null, 2)
                      } catch {
                        return selectedEvent.payload
                      }
                    })()}
                  </pre>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => copyToClipboard(selectedEvent.payload, 'payload')}
                    className="absolute top-2 right-2 border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white"
                  >
                    {copiedSku === 'payload' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="h-3 w-3" /> Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
