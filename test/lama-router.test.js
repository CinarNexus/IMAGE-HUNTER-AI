import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import express from 'express'
import { test } from 'node:test'
import sharp from 'sharp'
import { createStudioRouter } from '../server/studio/router.js'

test('LaMa status/start endpoints report setup requirements without claiming fallback AI', async (context) => {
  let startCalls = 0
  const service = {
    status: () => ({ installed: false, ready: false, setupCommand: 'npm run setup:lama' }),
    async start() {
      startCalls += 1
      const error = new Error('LaMa kurulu değil. Kurmak için npm run setup:lama çalıştırın veya Klasik Telea seçeneğini belirleyin.')
      error.statusCode = 503
      throw error
    },
  }
  const app = express()
  app.use('/api/studio', createStudioRouter({ lamaService: service }))
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || 500).json({ error: error.message })
  })
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))
  const url = `http://127.0.0.1:${server.address().port}/api/studio/lama`

  const statusResponse = await fetch(`${url}/status`)
  assert.equal(statusResponse.status, 200)
  assert.equal((await statusResponse.json()).installed, false)

  const startResponse = await fetch(`${url}/start`, { method: 'POST' })
  const result = await startResponse.json()
  assert.equal(startResponse.status, 503)
  assert.match(result.error, /Telea seçeneğini belirleyin/)
  assert.equal(startCalls, 1)
})

test('disconnecting a LaMa preview request aborts the downstream inference signal', async (context) => {
  const image = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#406080' },
  }).png().toBuffer()
  const mask = await sharp({
    create: { width: 16, height: 12, channels: 3, background: '#000000' },
  }).composite([{
    input: { create: { width: 4, height: 4, channels: 3, background: '#ffffff' } },
    left: 6,
    top: 4,
  }]).png().toBuffer()
  let markStarted
  let inferenceSignal
  const started = new Promise((resolve) => {
    markStarted = resolve
  })
  const service = {
    status: () => ({ installed: true, ready: true }),
    async inpaint(_image, _mask, { signal }) {
      inferenceSignal = signal
      markStarted()
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  }
  const uploadStore = {
    async initialize() {},
    async getBuffer() {
      return image
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/api/studio', createStudioRouter({ uploadStore, lamaService: service }))
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || 500).json({ error: error.message })
  })
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const controller = new AbortController()
  const request = fetch(
    `http://127.0.0.1:${server.address().port}/api/studio/uploads/test/tools/object-removal/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { engine: 'lama', mask: mask.toString('base64') } }),
      signal: controller.signal,
    },
  ).catch((error) => error)
  await started
  controller.abort()
  await request
  const abortDeadline = Date.now() + 1_000
  while (!inferenceSignal.aborted && Date.now() < abortDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(inferenceSignal.aborted, true)
})

test('empty upload IDs receive a JSON validation error without entering LaMa', async (context) => {
  const service = {
    status: () => ({ installed: true, ready: true }),
    async inpaint() {
      assert.fail('LaMa must not be called for a missing upload ID')
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/api/studio', createStudioRouter({ lamaService: service }))
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/studio/uploads//tools/object-removal/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { engine: 'lama', mask: 'valid-mask' } }),
    },
  )
  assert.equal(response.status, 400)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await response.json(), {
    error: 'Önizleme için yükleme kimliği eksik. Görseli yeniden yükleyin.',
  })
})

test('effective mask preview returns the LaMa input mask without invoking inference', async (context) => {
  const image = await sharp({
    create: { width: 160, height: 120, channels: 3, background: '#406080' },
  }).png().toBuffer()
  const mask = await sharp({
    create: { width: 16, height: 12, channels: 3, background: '#000000' },
  }).composite([{
    input: { create: { width: 4, height: 4, channels: 3, background: '#ffffff' } },
    left: 6,
    top: 4,
  }]).png().toBuffer()
  let inpaintCalls = 0
  const uploadStore = {
    async initialize() {},
    async getBuffer() {
      return image
    },
  }
  const service = {
    async inpaint() {
      inpaintCalls += 1
      assert.fail('Mask preview must not invoke LaMa inference')
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/api/studio', createStudioRouter({ uploadStore, lamaService: service }))
  app.use((error, _request, response, _next) => {
    response.status(error.statusCode || 500).json({ error: error.message })
  })
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/studio/uploads/test/tools/object-removal/mask-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: { mask: mask.toString('base64'), dilation: 3, feather: 8 },
      }),
    },
  )
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /image\/png/)
  const output = Buffer.from(await response.arrayBuffer())
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([info.width, info.height], [160, 120])
  assert.ok(data.some((value) => value === 255))
  assert.ok(data.some((value) => value === 0))
  assert.equal(inpaintCalls, 0)

  const invalidResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/studio/uploads/test/tools/object-removal/mask-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { mask: 'invalid' } }),
    },
  )
  assert.equal(invalidResponse.status, 400)
  assert.match((await invalidResponse.json()).error, /Maske/)
  assert.equal(inpaintCalls, 0)
})
