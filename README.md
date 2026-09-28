# Event-Driven Inventory & Supply Chain Tracker - System Architecture

> End-to-end view: from inventory modification request to asynchronous alert processing, reorder workflows, and supply chain analytics.

## Contents

- [Overview](#overview)
- [Design principles](#design-principles)
- [Request lifecycle](#request-lifecycle)
- [1. Inventory Consumers](#1-inventory-consumers)
- [2. API Edge / Ingress](#2-api-edge--ingress)
- [3. Inventory Gateway (data plane)](#3-inventory-gateway-data-plane)
- [4. Messaging Bus & Brokers](#4-messaging-bus--brokers)
- [5. Control / Supply Chain Plane](#5-control--supply-chain-plane)
- [Frontend](#frontend-react-dashboard)
- [Data Layer](#data-layer)
- [Observability](#observability)

---

## Overview

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ 1. INVENTORY CONSUMERS  (Kubernetes workloads / External services)                   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Web Apps  •  Internal APIs  •  POS Terminals  •  Batch ERP Jobs (CronJobs)           │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                           │  HTTPS (REST / GraphQL API)
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ 2. API EDGE / INGRESS  (Kubernetes Ingress)                                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ TLS Termination → Authentication (API Key / OAuth) → WAF / Rate Limit → Routing      │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────┐     ┌────────────────────────────────┐
│ 3. INVENTORY GATEWAY  (data plane, real-time)  │     │ 4. MESSAGING BUS & BROKERS     │
├────────────────────────────────────────────────┤     ├────────────────────────────────┤
│ Identity / Tenant Resolution                   │     │ • RabbitMQ (AMQP Topic Exch)   │
│  ↓ Policy & Validation Engine                  │ ─▶ │ • NATS JetStream (Streaming)   │
│  ↓ Rate Limiting                               │     │ • Dead Letter Exchange (DLX)   │
│  ↓ Idempotency Check                           │     │ • Queue Workers & Subscriptions│
│  ↓ Stock Availability Scan                     │     └────────────────────────────────┘
│  ↓ Cache Lookup (Redis)                        │
│  ↓ Product Catalog & Inventory Router          │
│  ↓ Reliability (Circuit Breaker)               │
│  ↓ Transactional Atomic Stock Decrement        │
└────────────────────────────────────────────────┘
                        ┆  emit inventory event (async)
                        ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ 5. CONTROL / SUPPLY CHAIN PLANE  (asynchronous)                                      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ K8s Integration → Inventory Events → Alert Engine → Reorder Engine → Analytics       │
│ Control Plane API: Identity | Thresholds | Suppliers | Orders | Pricing | Analytics  │
└──────────────────────────────────────────────────────────────────────────────────────┘
                     ▲▼  REST (HTTPS)                             ▲▼  read / write
┌─────────────────────────────────────────┐  ┌─────────────────────────────────────────┐
│ FRONTEND  (React Dashboard)             │  │ DATA LAYER                              │
├─────────────────────────────────────────┤  ├─────────────────────────────────────────┤
│ Inventory Dashboard  • Stock Matrix     │  │ PostgreSQL - primary ACID data store    │
│ Low-Stock Alerts  • Reorder Management  │  │ Redis      - low-latency state          │
│ Supplier Insights • Demand Forecasting  │  │ (cache, limits, stock counters,         │
│ Warehouse Performance                   │  │  idempotency keys, sessions)            │
└─────────────────────────────────────────┘  └─────────────────────────────────────────┘
                                           │  metrics / traces / logs from every layer
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ OBSERVABILITY & PLATFORM SERVICES                                                    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Prometheus • Grafana • OpenTelemetry • Loki/ELK • Alerting                           │
│ Kubernetes • Helm • Secrets (Vault / K8s) • CI/CD                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Two planes, on purpose:**

| Plane | Runs | Goal |
|---|---|---|
| **Data plane** (Inventory Gateway) | Synchronously on every request | Low latency, transactional enforcement (ACID stock check, rate limit, idempotency) |
| **Control / Supply Chain plane** | Asynchronously from inventory events | Alerts, supplier orders, analytics, optimization - never blocks a checkout request |

---

## Design principles

- **Data plane / control plane separation** - the inventory gateway is real-time; supply chain alerting and reordering processing is asynchronous.
- **Kubernetes-native identity** - costs are attributed via `ServiceAccount → Workload → Application → Warehouse → Tenant`.
- **Broker-agnostic** - new message brokers (RabbitMQ / NATS) plug in through standard event producers and consumers.
- **Low-latency state in Redis**, durable transactional data in PostgreSQL.
- **REST / Event-Driven API** - consumers switch to the inventory gateway without breaking existing checkout workflows.

---

## Request lifecycle

```text
Client
  │  1. HTTPS request (POST /inventory/checkout)
  ▼
Ingress ── TLS ── AuthN ── WAF / rate limit ── Routing
  │
  ▼
Inventory Gateway
  │  2. Resolve identity  (ServiceAccount → Workload → App → Warehouse → Tenant)
  │  3. Policy check, rate limit, idempotency check ◀── Redis (counters, limits, keys)
  │  4. Cache lookup ─────────── hit ───────────────▶ return cached inventory state
  │           │ miss
  │  5. Atomic stock decrement (ACID transaction)   ──▶ PostgreSQL (products / inventory)
  ▼
Response ──▶ Client
  ┆
  ┆  6. Emit inventory event (async, non-blocking)
  ▼
Event Queue ──▶ Event Processor ──▶ Alert Engine ──▶ Reorder Engine ──▶ Analytics
                                                       │
                                                       ▼
                                                 PostgreSQL (events, orders, alerts)
```

---

##1. Inventory Consumers

Workloads running in Kubernetes or external services that execute stock updates and queries over HTTPS.

| Consumer | Description |
|---|---|
| E-commerce | Frontend / checkout portals |
| Internal APIs | Fulfillment & Order Microservices |
| Batch Jobs | Stock Sync CronJobs |
| POS Terminals | In-store checkout hardware and agents |
 
## 2. API Edge / Ingress

| Component | Responsibility |
|---|---|
| Kubernetes Ingress (API Gateway) | Cluster entry point |
| TLS Termination | Encrypts / decrypts traffic |
| Authentication | API Key / OAuth |
| Request Protection | WAF / rate limit |
| Routing | Forwards requests to the Inventory Gateway |

## 3. Inventory Gateway (data plane)

| # | Component | Purpose |
|---|---|---|
| 1 | Identity Resolution | Map caller to tenant / warehouse / store / app |
| 2 | Policy Engine | Apply access and stock allocation policies |
| 3 | Rate Limiting | Enforce request limits |
| 4 | Idempotency Engine | Prevent double-deductions on retries |
| 5 | Stock Availability Check | Validate real-time item stock thresholds |
| 6 | Cache (Redis) | Serve repeated product availability queries from cache |
| 7 | Product Catalog Router | Direct requests to Catalog or Stock services |
| 8 | Reliability (Circuit Breaker) | Database failover and resilience |
| 9 |Transaction Execution | Execute atomic SQL stock decrement in PostgreSQL |
