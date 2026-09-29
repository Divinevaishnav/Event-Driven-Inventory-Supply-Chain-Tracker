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

After responding, the gateway emits an inventory event asynchronously to the Supply Chain plane.

## 4. Messaging Bus & Brokers

| Broker | Architecture Role |
|---|---|
| RabbitMQ | AMQP Topic Exchange (inventory.events) for structured routing |
| NATS JetStream | High-throughput low-latency event streaming |
| Dead Letter Exchange (DLX) | Captures failed message executions for retries and audit logging |
| Event Consumers | Worker pods executing background alert and supply chain tasks |

## 5. Control / Supply Chain Plane

```text
┌────────────────────────────────────────────────────────────────────┐
│ Kubernetes Integration Layer                                       │
├────────────────────────────────────────────────────────────────────┤
│ Kubernetes API        (watches / informers)                        │
│ Workload Metadata     (CRDs / labels / annotations)                │
│ Identity Registry     ServiceAccount → Workload → Application      │
│                       → Warehouse → Tenant                         │
└────────────────────────────────────────────────────────────────────┘
                                  │  sync workload metadata (periodic)
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Usage Event Layer                                                  │
├────────────────────────────────────────────────────────────────────┤
│ Event Queue           (RabbitMQ / NATS JetStream)                  │
│ Event Processor       (consumers)                                  │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Alert Engine                                                       │
├────────────────────────────────────────────────────────────────────┤
│ Low-Stock Evaluation     (current_stock <= threshold)                │
│ Notification Dispatch    (Email / Slack / SMS / Webhooks)          │
│ Deduplication Control    (Redis temporary state)                   │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Reorder & Supplier Engine                                          │
├────────────────────────────────────────────────────────────────────┤
│ Purchase Order Generation(Automated B2B vendor triggers)           │
│ Lead Time Calculation    (Supplier reliability scoring)            │
│ Supplier Contract Pricing(Versioned)                               │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Analytics Engine                                                   │
├────────────────────────────────────────────────────────────────────┤
│ Stock Turnover Aggregation (by tenant / store / product)           │
│ Trend Analysis  •  Demand Forecasting                              │
│ Warehouse Heatmaps   •  Shrinkage Attribution                      │
└────────────────────────────────────────────────────────────────────┘
                                  │  recommendations / reorder alerts
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Control Plane API                                                  │
├────────────────────────────────────────────────────────────────────┤
│ Identity | Thresholds | Suppliers | Orders | Pricing | Analytics   │
└────────────────────────────────────────────────────────────────────┘
```

| Engine | Key capabilities |
|---|---|
| Kubernetes Integration Layer | Watches K8s API, reads CRDs / labels / annotations, maintains the identity registry |
| Usage Event Layer | RabbitMQ / NATS JetStream queues plus consumer pods |
| Alert Engine| Real-time threshold calculation, notification deduplication via Redis, multi-channel alerting |
| Reorder & Supplier Engine | Purchase Order calculation, vendor API integration, versioned contract pricing |
|Analytics Engine | Aggregation by tenant / warehouse / application, stock turnover trends, shrinkage attribution |
| Control Plane API | Identity, threshold, supplier, order, pricing, and analytics management |

## Frontend (React Dashboard)

Talks to the Control Plane API over REST (HTTPS).

| View | Purpose |
|---|---|
| Inventory Dashboard | Top-level stock levels and transaction volume |
| Stock Matrix | Breakdown by warehouse / store / application |
| Low-Stock Alerts | Live real-time event alerts and actions |
| Reorder Management | Track automated supplier Purchase Orders |
| Demand Insights | Historical velocity and turnover forecasting |
| Warehouse Performance | Processing latency, throughput, and reliability |

## Data Layer

| Store | Role | Contents |
|---|---|---|
| **PostgreSQL** | Primary data store | Tenants, Warehouses, Applications, Products, Stock Balances, Stock Movements, Purchase Orders, Audit Logs |
| **Redis** | Low-latency state | Low-latency stateCache, Rate Limits, Idempotency Counters, Supplier Health, Temporary State, Sessions |

---

## Observability

Observability covers both layers: the real-time inventory gateway and the async supply chain pipeline.

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ SIGNAL SOURCES                                                                       │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Inventory Gateway • Event Processors • Control Plane API • K8s • Redis / PostgreSQL  │
└──────────────────────────────────────────────────────────────────────────────────────┘
              ▼                             ▼                             ▼
┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
│ Prometheus               │  │ OpenTelemetry            │  │ Loki / ELK               │
├──────────────────────────┤  ├──────────────────────────┤  ├──────────────────────────┤
│ METRICS                  │  │ TRACES                   │  │ LOGS                     │
│ scrape / alert rules     │  │ request-level spans      │  │ structured, searchable   │
└──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘
              └─────────────────────────────┬─────────────────────────────┘
                                            ▼
                             ┌────────────────────────────┐
                             │ Grafana                    │
                             ├────────────────────────────┤
                             │ dashboards (visualization) │
                             └────────────────────────────┘
                                            ▼
                             ┌────────────────────────────┐
                             │ Monitoring & Alerting      │
                             ├────────────────────────────┤
                             │ platform + business alerts │
                             └────────────────────────────┘
```

### Tooling

| Tool | Signal | Role in this platform |
|---|---|---|
| Prometheus | Metrics | Scrapes gateway, processors, API, Redis, PostgreSQL, and Kubernetes |
| OpenTelemetry | Traces | End-to-end spans: ingress → gateway → PostgreSQL, plus event processing |
| Loki / ELK | Logs | Gateway, processor and audit logs |
| Grafana | Visualization | Platform dashboards and business dashboards |
| Monitoring & Alerting | Alerts | Platform health and business (stock breach / reorder) alerts |
| Kubernetes | Orchestration | Health probes, pod / node metrics |
| Helm | Deployment | Versioned releases |
| Secrets Management | Security | Vault / Kubernetes Secrets for database & broker keys |
| CI/CD | Delivery | Deployment pipeline |

### Suggested key metrics

| Area | Metric |
|---|---|
| Gateway | Request rate, p50 / p95 / p99 latency, transaction rate by warehouse |
| Cache | Hit ratio, read requests saved |
| Enforcement | Rate-limit rejections, idempotency block rate, stock exhaustion blocks |
| Messaging | RabbitMQ queue depth, consumer processing lag, dead-letter event rate |
| Event pipeline | Processing rate, failed / retried event executions |
| Stock | Stock turnover rate, depletion velocity per SKU, lead-time variance |
| Data stores | Redis memory and evictions, PostgreSQL connection pool latency |

### Suggested alerts

| Alert | Type |
|---|---|
| Gateway p95 latency or error rate above threshold | Platform |
| Dead Letter Queue size growing in RabbitMQ | Platform |
| Event queue processing lag growing | Platform |
| Low stock threshold breached for critical SKU | Business |
| Automated Purchase Order dispatch failure | Business |
| Cache hit ratio drops sharply | Business |
