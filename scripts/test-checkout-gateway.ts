import { prisma } from '../src/lib/prisma'

async function runTests() {
  console.log('=== STARTING INVENTORY GATEWAY TEST SUITE ===\n')

  const baseUrl = 'http://localhost:3000'

  // Retrieve test API keys and warehouses from seed
  const appEcom = await prisma.application.findFirst({
    where: { code: 'ECOM-CHECKOUT' },
    include: { tenant: true },
  })

  const appPos = await prisma.application.findFirst({
    where: { code: 'POS-RETAIL-01' },
    include: { tenant: true },
  })

  if (!appEcom || !appPos) {
    throw new Error('Seed applications not found. Run npx prisma db seed first.')
  }

  const whOrd = await prisma.warehouse.findUnique({
    where: { code: 'WH-ORD-01' },
  })
  const whSin = await prisma.warehouse.findUnique({
    where: { code: 'WH-SIN-01' },
  })

  if (!whOrd || !whSin) {
    throw new Error('Seed warehouses not found.')
  }

  // --------------------------------------------------------------------------
  // TEST 1: Unauthorized Caller (Invalid API Key)
  // --------------------------------------------------------------------------
  console.log('[TEST 1] Unauthorized API Key Check...')
  const res1 = await fetch(`${baseUrl}/api/inventory/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: 'test_unauth_001',
      apiKey: 'ak_invalid_bogus_key',
      warehouseCode: 'WH-ORD-01',
      items: [{ sku: 'SKU-APP-HOODIE', quantity: 1 }],
      referenceId: 'ORD-TEST-001',
    }),
  })
  console.log(`Status: ${res1.status} (Expected: 401)`)
  const data1 = await res1.json()
  console.log(`Payload:`, data1)
  if (res1.status !== 401) throw new Error('Test 1 failed: Expected 401')
  console.log('PASSED\n')

  // --------------------------------------------------------------------------
  // TEST 2: Tenant Isolation Check (Apex app accessing Nexus warehouse)
  // --------------------------------------------------------------------------
  console.log('[TEST 2] Tenant Isolation (Apex App accessing Nexus Warehouse)...')
  const res2 = await fetch(`${baseUrl}/api/inventory/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: 'test_isolation_002',
      apiKey: appEcom.apiKey,
      warehouseCode: 'WH-SIN-01', // Belongs to Nexus, not Apex
      items: [{ sku: 'SKU-APP-HOODIE', quantity: 1 }],
      referenceId: 'ORD-TEST-002',
    }),
  })
  console.log(`Status: ${res2.status} (Expected: 403)`)
  const data2 = await res2.json()
  console.log(`Payload:`, data2)
  if (res2.status !== 403) throw new Error('Test 2 failed: Expected 403')
  console.log('PASSED\n')

  // --------------------------------------------------------------------------
  // TEST 3: Valid Synchronous Checkout & ACID Decrement
  // --------------------------------------------------------------------------
  console.log('[TEST 3] Valid Synchronous Checkout & ACID Decrement...')
  const initialBalance = await prisma.stockBalance.findFirst({
    where: {
      warehouseId: whOrd.id,
      product: { sku: 'SKU-APP-HOODIE' },
    },
  })
  console.log(`Pre-decrement On-Hand for SKU-APP-HOODIE: ${initialBalance?.onHand}`)

  const idempotencyKey3 = `idemp_valid_${Date.now()}`
  const res3 = await fetch(`${baseUrl}/api/inventory/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: idempotencyKey3,
      apiKey: appEcom.apiKey,
      warehouseCode: 'WH-ORD-01',
      items: [{ sku: 'SKU-APP-HOODIE', quantity: 5 }],
      referenceId: 'ORD-SUCCESS-100',
    }),
  })
  console.log(`Status: ${res3.status} (Expected: 200)`)
  const data3 = await res3.json()
  console.log(`Decremented items:`, data3.decrementedItems)

  const updatedBalance = await prisma.stockBalance.findFirst({
    where: {
      warehouseId: whOrd.id,
      product: { sku: 'SKU-APP-HOODIE' },
    },
  })
  console.log(`Post-decrement On-Hand for SKU-APP-HOODIE: ${updatedBalance?.onHand}`)
  if (res3.status !== 200 || updatedBalance?.onHand !== (initialBalance?.onHand ?? 0) - 5) {
    throw new Error('Test 3 failed: Decrement was not applied correctly')
  }
  console.log('PASSED\n')

  // --------------------------------------------------------------------------
  // TEST 4: Idempotency Replay (Re-submitting exact same idempotencyKey)
  // --------------------------------------------------------------------------
  console.log('[TEST 4] Idempotency Replay Verification...')
  const res4 = await fetch(`${baseUrl}/api/inventory/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: idempotencyKey3, // Exact same key
      apiKey: appEcom.apiKey,
      warehouseCode: 'WH-ORD-01',
      items: [{ sku: 'SKU-APP-HOODIE', quantity: 5 }],
      referenceId: 'ORD-SUCCESS-100',
    }),
  })
  const replayHeader = res4.headers.get('x-idempotent-replay')
  console.log(`Status: ${res4.status} (Expected: 200)`)
  console.log(`X-Idempotent-Replay header: ${replayHeader}`)

  const checkBalanceAgain = await prisma.stockBalance.findFirst({
    where: {
      warehouseId: whOrd.id,
      product: { sku: 'SKU-APP-HOODIE' },
    },
  })
  console.log(`Balance after idempotent re-request (should NOT change): ${checkBalanceAgain?.onHand}`)
  if (replayHeader !== 'true' || checkBalanceAgain?.onHand !== updatedBalance?.onHand) {
    throw new Error('Test 4 failed: Idempotent replay decremented stock again!')
  }
  console.log('PASSED\n')

  // --------------------------------------------------------------------------
  // TEST 5: Insufficient Stock Rejection
  // --------------------------------------------------------------------------
  console.log('[TEST 5] Insufficient Stock Rejection...')
  const res5 = await fetch(`${baseUrl}/api/inventory/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idemp_insufficient_${Date.now()}`,
      apiKey: appEcom.apiKey,
      warehouseCode: 'WH-ORD-01',
      items: [{ sku: 'SKU-APP-HOODIE', quantity: 999999 }], // Exceeds onHand
      referenceId: 'ORD-FAIL-OVERFLOW',
    }),
  })
  console.log(`Status: ${res5.status} (Expected: 409)`)
  const data5 = await res5.json()
  console.log(`Payload:`, data5)
  if (res5.status !== 409) throw new Error('Test 5 failed: Expected 409 Conflict')
  console.log('PASSED\n')

  // --------------------------------------------------------------------------
  // TEST 6: Critical Low-Stock Threshold Breach Detection
  // --------------------------------------------------------------------------
  console.log('[TEST 6] Critical Low-Stock Breach Detection...')
  // Decrement SKU-ELEC-4090 (already low in WH-ORD-01, min threshold is 20)
  const res6 = await fetch(`${baseUrl}/api/inventory/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idemp_breach_${Date.now()}`,
      apiKey: appEcom.apiKey,
      warehouseCode: 'WH-ORD-01',
      items: [{ sku: 'SKU-ELEC-4090', quantity: 1 }],
      referenceId: 'ORD-BREACH-TEST',
    }),
  })
  console.log(`Status: ${res6.status} (Expected: 200)`)
  const data6 = await res6.json()
  const breachItem = data6.decrementedItems.find(
    (i: { sku: string; thresholdBreached: boolean; newOnHand: number; minimumThreshold: number }) => i.sku === 'SKU-ELEC-4090'
  )
  console.log(`Threshold Breached Flag:`, breachItem?.thresholdBreached)
  console.log(`New On-Hand:`, breachItem?.newOnHand, `Threshold:`, breachItem?.minimumThreshold)

  // Verify that an explicit LOW_STOCK_THRESHOLD_BREACHED event was created in EventLog
  const breachEvent = await prisma.eventLog.findFirst({
    where: {
      eventType: 'LOW_STOCK_THRESHOLD_BREACHED',
      aggregateId: 'SKU-ELEC-4090',
    },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`Recorded EventLog: ${breachEvent?.eventId} (${breachEvent?.eventType})`)
  if (!breachItem?.thresholdBreached || !breachEvent) {
    throw new Error('Test 6 failed: Low stock breach was not detected or logged')
  }
  console.log('PASSED\n')

  console.log('=== ALL 6 TESTS PASSED WITH ZERO ERRORS ===')
}

runTests()
  .catch((e) => {
    console.error('Test Suite Failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
