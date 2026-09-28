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
┌────────────────────────────────────────────────┐    ┌────────────────────────────────┐
│ 3. INVENTORY GATEWAY  (data plane, real-time)  │    │ 4. MESSAGING BUS & BROKERS     │
├────────────────────────────────────────────────┤    ├────────────────────────────────┤
│ Identity / Tenant Resolution                   │    │ • RabbitMQ (AMQP Topic Exch)   │
│  ↓ Policy & Validation Engine                  │ ─▶ │ • NATS JetStream (Streaming)   │
│  ↓ Rate Limiting                               │    │ • Dead Letter Exchange (DLX)   │
│  ↓ Idempotency Check                           │    │ • Queue Workers & Subscriptions│
│  ↓ Stock Availability Scan                     │    └────────────────────────────────┘
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
