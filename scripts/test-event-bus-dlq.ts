// Automated Verification Suite for Version 3: Messaging Bus, Worker Pipeline & DLX
import { prisma } from '../src/lib/prisma'

async function runVerification() {
  console.log('=== STARTING VERSION 3 EVENT BUS & DLX VERIFICATION ===\n')

  const baseUrl = 'http://localhost:3000'

  // Fetch seeded checkout application
  const app = await prisma.application.findFirst({
    where: { code: 'ECOM-CHECKOUT' },
  })
  if (!app) throw new Error('Seeded ECOM-CHECKOUT app not found')

  // --------------------------------------------------------------------------
  // STEP 1: Execute Checkout and verify staged PENDING event
  // --------------------------------------------------------------------------
  console.log('[STEP 1] Executing checkout to stage PENDING event...')
  const refId = `ORD-V3-STAGE-${Date.now()}`
  const checkoutRes = await fetch(`${baseUrl}/api/inventory/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idemp-v3-${Date.now()}`,
      apiKey: app.apiKey,
      warehouseCode: 'WH-ORD-01',
      items: [{ sku: 'SKU-APP-HOODIE', quantity: 1 }],
      referenceId: refId,
    }),
  })

  console.log(`Checkout response status: ${checkoutRes.status} (Expected: 200)`)
  const checkoutData = await checkoutRes.json()
  const eventId = checkoutData.eventLogId
  console.log(`Generated EventLog ID: ${eventId}`)

  const stagedEvent = await prisma.eventLog.findUnique({
    where: { eventId },
  })

  console.log(`Staged Event Type: ${stagedEvent?.eventType} (Expected: INVENTORY_DEDUCTED)`)
  console.log(`Staged Event Status: ${stagedEvent?.status} (Expected: PENDING)`)
  console.log(`Routing Key: ${stagedEvent?.routingKey} (Expected: inventory.events.deducted)`)

  if (!stagedEvent || stagedEvent.status !== 'PENDING' || stagedEvent.eventType !== 'INVENTORY_DEDUCTED') {
    throw new Error('STEP 1 FAILED: Event was not staged with status PENDING and type INVENTORY_DEDUCTED')
  }
  console.log('STEP 1 PASSED\n')

  // --------------------------------------------------------------------------
  // STEP 2: Trigger Worker Batch and verify PENDING -> PROCESSED
  // --------------------------------------------------------------------------
  console.log('[STEP 2] Triggering queue worker batch tick...')
  const workerRes = await fetch(`${baseUrl}/api/events/worker/tick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchSize: 10 }),
  })

  console.log(`Worker response status: ${workerRes.status} (Expected: 200)`)
  const workerData = await workerRes.json()
  console.log(`Batch processed: ${workerData.batchResult?.processedCount} events in ${workerData.batchResult?.durationMs}ms`)

  const processedEvent = await prisma.eventLog.findUnique({
    where: { eventId },
  })

  console.log(`Updated Event Status: ${processedEvent?.status} (Expected: PROCESSED)`)
  console.log(`Processed Timestamp: ${processedEvent?.processedAt}`)

  if (processedEvent?.status !== 'PROCESSED' || !processedEvent?.processedAt) {
    throw new Error('STEP 2 FAILED: Event did not transition to PROCESSED')
  }
  console.log('STEP 2 PASSED\n')

  // --------------------------------------------------------------------------
  // STEP 3: Inject Poison Event and verify DLQ trapping
  // --------------------------------------------------------------------------
  console.log('[STEP 3] Injecting Poison Event and testing Dead Letter Exchange (DLQ)...')
  const poisonRes = await fetch(`${baseUrl}/api/events/simulate-poison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Unit test negative quantity schema violation' }),
  })

  const poisonData = await poisonRes.json()
  const poisonEventId = poisonData.event.eventId
  console.log(`Injected Poison Event: ${poisonEventId}`)

  // Run worker 1st time: retryCount becomes 1
  console.log('Running Worker Tick 1/3 (First failure)...')
  await fetch(`${baseUrl}/api/events/worker/tick`, { method: 'POST' })
  let pEvent = await prisma.eventLog.findUnique({ where: { eventId: poisonEventId } })
  console.log(`Status: ${pEvent?.status}, RetryCount: ${pEvent?.retryCount}/${pEvent?.maxRetries}`)

  // Run worker 2nd time: retryCount becomes 2
  console.log('Running Worker Tick 2/3 (Second failure)...')
  await fetch(`${baseUrl}/api/events/worker/tick`, { method: 'POST' })
  pEvent = await prisma.eventLog.findUnique({ where: { eventId: poisonEventId } })
  console.log(`Status: ${pEvent?.status}, RetryCount: ${pEvent?.retryCount}/${pEvent?.maxRetries}`)

  // Run worker 3rd time: retryCount reaches 3 -> Routed to DLQ!
  console.log('Running Worker Tick 3/3 (Max retry reached -> DLX trap)...')
  await fetch(`${baseUrl}/api/events/worker/tick`, { method: 'POST' })
  pEvent = await prisma.eventLog.findUnique({ where: { eventId: poisonEventId } })
  console.log(`Status: ${pEvent?.status} (Expected: DLQ)`)
  console.log(`RetryCount: ${pEvent?.retryCount}/${pEvent?.maxRetries}`)
  console.log(`Last Error: ${pEvent?.lastError}`)

  if (pEvent?.status !== 'DLQ' || pEvent?.retryCount !== 3) {
    throw new Error('STEP 3 FAILED: Poison event was not trapped into DLQ after 3 retries')
  }
  console.log('STEP 3 PASSED\n')

  // --------------------------------------------------------------------------
  // STEP 4: Test DLQ Requeue action
  // --------------------------------------------------------------------------
  console.log('[STEP 4] Testing DLQ Requeue API...')
  const requeueRes = await fetch(`${baseUrl}/api/events/dlq/requeue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: poisonEventId }),
  })
  console.log(`Requeue Status: ${requeueRes.status} (Expected: 200)`)

  pEvent = await prisma.eventLog.findUnique({ where: { eventId: poisonEventId } })
  console.log(`Requeued Event Status: ${pEvent?.status} (Expected: PENDING)`)
  console.log(`Requeued Event RetryCount: ${pEvent?.retryCount} (Expected: 0)`)

  if (pEvent?.status !== 'PENDING' || pEvent?.retryCount !== 0) {
    throw new Error('STEP 4 FAILED: Requeue did not reset status to PENDING or retryCount to 0')
  }
  console.log('STEP 4 PASSED\n')

  console.log('=== ALL 4 VERIFICATION STEPS PASSED WITH 100% SUCCESS ===')
}

runVerification()
  .catch((e) => {
    console.error('Verification failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
