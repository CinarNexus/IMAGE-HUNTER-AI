import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { StudioJobStore } from '../server/studio/jobs.js'
import { arePaidProvidersEnabled, getStudioDailyBudgetUsd } from '../server/studio/config.js'
import { ProviderRegistry, assertWithinDailyBudget } from '../server/studio/providers.js'
import { TemporaryUploadStore } from '../server/studio/storage.js'

test('geçici stüdyo yüklemeleri süre sonunda silinir ve dosya yolları dışarı açılmaz', async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), 'image-hunter-studio-test-'))
  let now = 1000
  const store = new TemporaryUploadStore({
    baseDirectory,
    now: () => now,
    limits: {
      maxFileBytes: 1024,
      maxStoredFiles: 2,
      maxStoredBytes: 2048,
      retentionMs: 100,
      cleanupIntervalMs: 60_000,
    },
  })

  try {
    const upload = await store.save(Buffer.from('test-image'), {
      format: { extension: 'png' },
      mimeType: 'image/png',
      width: 10,
      height: 10,
      ownerId: 'owner-a',
    })
    assert.equal(upload.id.includes('..'), false)
    assert.equal('filePath' in upload, false)
    assert.equal('ownerId' in upload, false)
    assert.equal(await store.get(upload.id, 'owner-b'), null)
    assert.ok(await store.get(upload.id, 'owner-a'))
    assert.equal(await store.delete(upload.id, 'owner-b'), false)

    now = 1200
    assert.equal(await store.get(upload.id), null)
    assert.deepEqual(await readdir(path.join(baseDirectory, (await readdir(baseDirectory))[0])), [])
  } finally {
    await store.close()
    await rm(baseDirectory, { recursive: true, force: true })
  }
})

test('stüdyo işleri uygunsuz durum geçişlerini ve farklı sahibin erişimini reddeder', () => {
  let now = 1000
  const jobs = new StudioJobStore({ now: () => now, retentionMs: 100 })
  const job = jobs.create({
    tool: 'thumbnail',
    uploadIds: ['upload-1'],
    ownerId: 'owner-capability-0123456789',
  })

  assert.equal(job.status, 'queued')
  assert.equal(jobs.get(job.id, 'different-owner'), null)
  assert.throws(() => jobs.transition(job.id, 'completed', { resultUploadIds: ['result-1'] }), /geçemez/)

  jobs.transition(job.id, 'processing', { progress: 10 })
  const completed = jobs.transition(job.id, 'completed', { progress: 100, resultUploadIds: ['result-1'] })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.progress, 100)
  assert.equal('ownerId' in completed, false)

  now = 1200
  assert.equal(jobs.get(job.id, 'owner-capability-0123456789'), null)
})

test('sağlayıcı adaptörleri gizli alanları listelemez ve bütçe aşımı çağrı öncesi engellenir', async () => {
  const registry = new ProviderRegistry({ budgetUsd: 0 })
  let calls = 0
  registry.register({
    id: 'local-example',
    capabilities: ['thumbnail'],
    paid: false,
    enabled: true,
    apiKey: 'must-not-be-listed',
    estimate: async () => ({ costUsd: 0.01 }),
    execute: async () => { calls += 1 },
  })

  assert.deepEqual(registry.list(), [{
    id: 'local-example',
    capabilities: ['thumbnail'],
    paid: false,
    enabled: true,
  }])
  assert.equal(registry.resolve('local-example', 'thumbnail').id, 'local-example')
  assert.throws(
    () => registry.resolve('local-example', 'object-removal'),
    /uygun sağlayıcı yapılandırılmamış/,
  )
  assert.throws(
    () => assertWithinDailyBudget({ estimatedCostUsd: 0.01, spentUsd: 0, budgetUsd: 0 }),
    /Günlük stüdyo kullanım bütçesi aşılıyor/,
  )
  await assert.rejects(registry.execute('local-example', 'thumbnail', {}), /Günlük stüdyo kullanım bütçesi aşılıyor/)
  assert.equal(calls, 0)
})

test('ücretli sağlayıcılar varsayılan kapalıdır ve bütçe ortam ayarları doğrulanır', () => {
  const previousEnabled = process.env.STUDIO_PAID_PROVIDERS_ENABLED
  const previousBudget = process.env.STUDIO_DAILY_BUDGET_USD
  try {
    delete process.env.STUDIO_PAID_PROVIDERS_ENABLED
    delete process.env.STUDIO_DAILY_BUDGET_USD
    assert.equal(arePaidProvidersEnabled(), false)
    assert.equal(getStudioDailyBudgetUsd(), 0)

    process.env.STUDIO_PAID_PROVIDERS_ENABLED = 'true'
    process.env.STUDIO_DAILY_BUDGET_USD = '3.5'
    assert.equal(arePaidProvidersEnabled(), true)
    assert.equal(getStudioDailyBudgetUsd(), 3.5)

    process.env.STUDIO_PAID_PROVIDERS_ENABLED = 'yes'
    assert.throws(() => arePaidProvidersEnabled(), /yalnızca true veya false/)
    process.env.STUDIO_DAILY_BUDGET_USD = '-1'
    assert.throws(() => getStudioDailyBudgetUsd(), /geçerli bir sayı/)
  } finally {
    if (previousEnabled === undefined) delete process.env.STUDIO_PAID_PROVIDERS_ENABLED
    else process.env.STUDIO_PAID_PROVIDERS_ENABLED = previousEnabled
    if (previousBudget === undefined) delete process.env.STUDIO_DAILY_BUDGET_USD
    else process.env.STUDIO_DAILY_BUDGET_USD = previousBudget
  }
})
