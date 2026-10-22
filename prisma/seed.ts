import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('--- Starting Database Seeding ---')

  // Clean existing records in reverse dependency order
  await prisma.eventLog.deleteMany()
  await prisma.stockMovement.deleteMany()
  await prisma.purchaseOrder.deleteMany()
  await prisma.supplierContractPricing.deleteMany()
  await prisma.supplier.deleteMany()
  await prisma.stockBalance.deleteMany()
  await prisma.product.deleteMany()
  await prisma.serviceAccount.deleteMany()
  await prisma.application.deleteMany()
  await prisma.warehouse.deleteMany()
  await prisma.tenant.deleteMany()

  // 1. Tenants
  const apexTenant = await prisma.tenant.create({
    data: {
      name: 'Apex Retail Global',
      slug: 'apex-retail',
    },
  })

  const nexusTenant = await prisma.tenant.create({
    data: {
      name: 'Nexus Distribution',
      slug: 'nexus-dist',
    },
  })

  console.log(`Created tenants: ${apexTenant.name}, ${nexusTenant.name}`)

  // 2. Warehouses
  const whOrd = await prisma.warehouse.create({
    data: {
      tenantId: apexTenant.id,
      code: 'WH-ORD-01',
      name: 'ORD-Chicago-01',
      city: 'Chicago',
      country: 'United States',
      capacity: 150000,
    },
  })

  const whFra = await prisma.warehouse.create({
    data: {
      tenantId: apexTenant.id,
      code: 'WH-FRA-02',
      name: 'FRA-Frankfurt-02',
      city: 'Frankfurt',
      country: 'Germany',
      capacity: 120000,
    },
  })

  const whSin = await prisma.warehouse.create({
    data: {
      tenantId: nexusTenant.id,
      code: 'WH-SIN-01',
      name: 'SIN-Singapore-01',
      city: 'Singapore',
      country: 'Singapore',
      capacity: 180000,
    },
  })

  const whNbo = await prisma.warehouse.create({
    data: {
      tenantId: nexusTenant.id,
      code: 'WH-NBO-01',
      name: 'NBO-Nairobi-01',
      city: 'Nairobi',
      country: 'Kenya',
      capacity: 95000,
    },
  })

  console.log('Created 4 warehouses: ORD, FRA, SIN, NBO')

  // 3. Applications & Service Accounts
  await prisma.application.create({
    data: {
      tenantId: apexTenant.id,
      name: 'ECOM-CHECKOUT-SERVICE',
      code: 'ECOM-CHECKOUT',
      apiKey: 'ak_live_apex_ecom_7f3b890a12e4',
      serviceAccounts: {
        create: [
          {
            name: 'Checkout Orchestrator Pod',
            workloadType: 'K8S_POD',
          },
          {
            name: 'Nightly Inventory Reconciler',
            workloadType: 'CRON_JOB',
          },
        ],
      },
    },
  })

  await prisma.application.create({
    data: {
      tenantId: nexusTenant.id,
      name: 'STORE-POS-GATEWAY',
      code: 'POS-RETAIL-01',
      apiKey: 'ak_live_nexus_pos_92c31e4d56b8',
      serviceAccounts: {
        create: [
          {
            name: 'POS Terminal Sync Daemon',
            workloadType: 'EXTERNAL_API',
          },
        ],
      },
    },
  })

  console.log('Created applications and service accounts')

  // 4. Products (8 SKUs across Electronics, Apparel, and Perishables)
  // Apex Retail Catalog
  const prodGpu = await prisma.product.create({
    data: {
      tenantId: apexTenant.id,
      sku: 'SKU-ELEC-4090',
      name: 'GeForce RTX 4090 OC GPU 24GB',
      category: 'Electronics',
      unitPrice: 1599.99,
      minimumThreshold: 20, // Low-stock target in WH-ORD-01
    },
  })

  const prodMac = await prisma.product.create({
    data: {
      tenantId: apexTenant.id,
      sku: 'SKU-ELEC-MACB16',
      name: 'ProBook M3 Max 16-inch 64GB',
      category: 'Electronics',
      unitPrice: 2499.0,
      minimumThreshold: 15,
    },
  })

  const prodHoodie = await prisma.product.create({
    data: {
      tenantId: apexTenant.id,
      sku: 'SKU-APP-HOODIE',
      name: 'ThermalTech Heavyweight Hoodie',
      category: 'Apparel',
      unitPrice: 85.0,
      minimumThreshold: 50,
    },
  })

  const prodJacket = await prisma.product.create({
    data: {
      tenantId: apexTenant.id,
      sku: 'SKU-APP-JACKET',
      name: 'All-Weather Technical Parka',
      category: 'Apparel',
      unitPrice: 180.0,
      minimumThreshold: 30,
    },
  })

  const prodCoffee = await prisma.product.create({
    data: {
      tenantId: apexTenant.id,
      sku: 'SKU-PER-COFFEE',
      name: 'Single-Origin Arabica Roast 1kg',
      category: 'Perishables',
      unitPrice: 28.0,
      minimumThreshold: 100,
    },
  })

  // Nexus Distribution Catalog
  const prodHeadphones = await prisma.product.create({
    data: {
      tenantId: nexusTenant.id,
      sku: 'SKU-ELEC-HEADPH',
      name: 'AcousticNoise Wireless ANC Headphones',
      category: 'Electronics',
      unitPrice: 299.5,
      minimumThreshold: 40,
    },
  })

  const prodCargo = await prisma.product.create({
    data: {
      tenantId: nexusTenant.id,
      sku: 'SKU-APP-CARGO',
      name: 'Ripstop Modular Cargo Pants',
      category: 'Apparel',
      unitPrice: 65.0,
      minimumThreshold: 45,
    },
  })

  const prodMatcha = await prisma.product.create({
    data: {
      tenantId: nexusTenant.id,
      sku: 'SKU-PER-MATCHA',
      name: 'Ceremonial Grade Uji Matcha 100g',
      category: 'Perishables',
      unitPrice: 34.5,
      minimumThreshold: 60, // Low-stock target in WH-SIN-01
    },
  })

  console.log('Created 8 products across Electronics, Apparel, and Perishables')

  // 5. Stock Balances
  // Crucial: 2 SKUs specifically set near or below minimumThreshold:
  // - prodGpu (SKU-ELEC-4090) in WH-ORD-01: onHand = 8 (threshold: 20) -> CRITICAL LOW
  // - prodMatcha (SKU-PER-MATCHA) in WH-SIN-01: onHand = 45 (threshold: 60) -> CRITICAL LOW
  await prisma.stockBalance.createMany({
    data: [
      // Apex Retail Warehouses
      // ORD-Chicago-01
      {
        warehouseId: whOrd.id,
        productId: prodGpu.id,
        onHand: 8, // BREACH: threshold 20
        reserved: 2,
        safetyStock: 25,
      },
      {
        warehouseId: whOrd.id,
        productId: prodMac.id,
        onHand: 42,
        reserved: 5,
        safetyStock: 20,
      },
      {
        warehouseId: whOrd.id,
        productId: prodHoodie.id,
        onHand: 350,
        reserved: 45,
        safetyStock: 80,
      },
      {
        warehouseId: whOrd.id,
        productId: prodJacket.id,
        onHand: 120,
        reserved: 15,
        safetyStock: 40,
      },
      {
        warehouseId: whOrd.id,
        productId: prodCoffee.id,
        onHand: 480,
        reserved: 60,
        safetyStock: 150,
      },

      // FRA-Frankfurt-02
      {
        warehouseId: whFra.id,
        productId: prodGpu.id,
        onHand: 18, // Near threshold warning
        reserved: 3,
        safetyStock: 25,
      },
      {
        warehouseId: whFra.id,
        productId: prodMac.id,
        onHand: 35,
        reserved: 4,
        safetyStock: 20,
      },
      {
        warehouseId: whFra.id,
        productId: prodHoodie.id,
        onHand: 280,
        reserved: 30,
        safetyStock: 70,
      },
      {
        warehouseId: whFra.id,
        productId: prodJacket.id,
        onHand: 95,
        reserved: 12,
        safetyStock: 35,
      },
      {
        warehouseId: whFra.id,
        productId: prodCoffee.id,
        onHand: 310,
        reserved: 40,
        safetyStock: 120,
      },

      // Nexus Distribution Warehouses
      // SIN-Singapore-01
      {
        warehouseId: whSin.id,
        productId: prodMatcha.id,
        onHand: 45, // BREACH: threshold 60
        reserved: 15,
        safetyStock: 80,
      },
      {
        warehouseId: whSin.id,
        productId: prodHeadphones.id,
        onHand: 190,
        reserved: 25,
        safetyStock: 50,
      },
      {
        warehouseId: whSin.id,
        productId: prodCargo.id,
        onHand: 410,
        reserved: 35,
        safetyStock: 60,
      },

      // NBO-Nairobi-01
      {
        warehouseId: whNbo.id,
        productId: prodMatcha.id,
        onHand: 75,
        reserved: 10,
        safetyStock: 80,
      },
      {
        warehouseId: whNbo.id,
        productId: prodHeadphones.id,
        onHand: 85,
        reserved: 8,
        safetyStock: 45,
      },
      {
        warehouseId: whNbo.id,
        productId: prodCargo.id,
        onHand: 240,
        reserved: 20,
        safetyStock: 50,
      },
    ],
  })

  console.log('Created baseline StockBalances across all warehouses (with 2 low-stock breaches)')

  // 6. Suppliers & Contract Pricing
  const supplierSilicon = await prisma.supplier.create({
    data: {
      tenantId: apexTenant.id,
      name: 'Silicon Horizon Semiconductor Ltd',
      contactEmail: 'procurement@siliconhorizon.com',
      leadTimeDays: 7,
      reliabilityScore: 0.98,
      contractPricing: {
        create: [
          {
            productId: prodGpu.id,
            contractPrice: 1320.0,
            minOrderQty: 10,
          },
          {
            productId: prodMac.id,
            contractPrice: 2050.0,
            minOrderQty: 5,
          },
        ],
      },
    },
  })

  const supplierNordic = await prisma.supplier.create({
    data: {
      tenantId: apexTenant.id,
      name: 'Nordic Thread & Textile Mills',
      contactEmail: 'supply@nordictextile.eu',
      leadTimeDays: 14,
      reliabilityScore: 0.94,
      contractPricing: {
        create: [
          {
            productId: prodHoodie.id,
            contractPrice: 42.5,
            minOrderQty: 100,
          },
          {
            productId: prodJacket.id,
            contractPrice: 98.0,
            minOrderQty: 50,
          },
        ],
      },
    },
  })

  console.log('Created 2 suppliers with contract pricing')

  // 7. Purchase Orders & Stock Movements
  await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-2026-APEX-001',
      supplierId: supplierSilicon.id,
      warehouseId: whOrd.id,
      status: 'SUBMITTED',
      totalAmount: 26400.0,
    },
  })

  await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-2026-APEX-002',
      supplierId: supplierNordic.id,
      warehouseId: whFra.id,
      status: 'CONFIRMED',
      totalAmount: 8500.0,
    },
  })

  await prisma.stockMovement.createMany({
    data: [
      {
        warehouseId: whOrd.id,
        productId: prodGpu.id,
        type: 'OUTBOUND_CHECKOUT',
        quantity: 5,
        referenceId: 'ORD-99120',
      },
      {
        warehouseId: whOrd.id,
        productId: prodHoodie.id,
        type: 'INBOUND',
        quantity: 200,
        referenceId: 'ASN-44810',
      },
      {
        warehouseId: whSin.id,
        productId: prodMatcha.id,
        type: 'RESERVED',
        quantity: 15,
        referenceId: 'RES-88219',
      },
    ],
  })

  // 8. EventLog (5 Initial baseline events)
  const now = Date.now()
  await prisma.eventLog.createMany({
    data: [
      {
        eventId: 'evt_init_001_inbound',
        eventType: 'INVENTORY_INBOUND_RECEIVED',
        tenantId: apexTenant.id,
        warehouseId: whOrd.id,
        aggregateId: prodHoodie.sku,
        payload: JSON.stringify({
          batchId: 'BAT-2026-0312',
          unitsReceived: 200,
          carrier: 'DHL-FREIGHT',
          dockDoor: 4,
          operator: 'ops-admin-01',
        }),
        status: 'PROCESSED',
        createdAt: new Date(now - 1000 * 60 * 180),
      },
      {
        eventId: 'evt_init_002_reserve',
        eventType: 'STOCK_RESERVATION_PLACED',
        tenantId: apexTenant.id,
        warehouseId: whOrd.id,
        aggregateId: prodGpu.sku,
        payload: JSON.stringify({
          orderId: 'ORD-US-88491',
          reservedUnits: 2,
          channel: 'ECOM_CHECKOUT',
          customerTier: 'VIP',
        }),
        status: 'PROCESSED',
        createdAt: new Date(now - 1000 * 60 * 115),
      },
      {
        eventId: 'evt_init_003_threshold',
        eventType: 'LOW_STOCK_THRESHOLD_BREACHED',
        tenantId: apexTenant.id,
        warehouseId: whOrd.id,
        aggregateId: prodGpu.sku,
        payload: JSON.stringify({
          currentOnHand: 8,
          threshold: 20,
          deficit: 12,
          severity: 'CRITICAL',
          suggestedAction: 'TRIGGER_PO_REORDER',
        }),
        status: 'PROCESSED',
        createdAt: new Date(now - 1000 * 60 * 60),
      },
      {
        eventId: 'evt_init_004_checkout',
        eventType: 'OUTBOUND_CHECKOUT_DISPATCHED',
        tenantId: apexTenant.id,
        warehouseId: whFra.id,
        aggregateId: prodJacket.sku,
        payload: JSON.stringify({
          shipmentId: 'SHP-EU-29401',
          unitsDispatched: 12,
          courier: 'FedEx-Priority',
          trackingNumber: '1Z9999999999999999',
        }),
        status: 'PROCESSED',
        createdAt: new Date(now - 1000 * 60 * 25),
      },
      {
        eventId: 'evt_init_005_audit',
        eventType: 'STOCK_AUDIT_CYCLE_COUNT_PENDING',
        tenantId: nexusTenant.id,
        warehouseId: whSin.id,
        aggregateId: prodMatcha.sku,
        payload: JSON.stringify({
          varianceDetected: -4,
          systemCount: 45,
          physicalScanCount: 41,
          flaggedBy: 'RFID_GATE_SCANNER',
        }),
        status: 'PENDING',
        createdAt: new Date(now - 1000 * 60 * 8),
      },
    ],
  })

  console.log('Seeded 5 baseline EventLogs')
  console.log('--- Database Seeding Complete ---')
}

main()
  .catch((e) => {
    console.error('Seed script error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
