import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LamaService } from '../server/studio/lama-service.js'

const image = Buffer.from('png')
const mask = Buffer.from('mask')

function serviceWithFetch(fetchImpl, options = {}) {
  const service = new LamaService({ fetchImpl, ...options })
  service.start = async () => 12345
  service.ready = true
  return service
}

test('LaMa rejects overlapping work and reports the active phase and elapsed time', async () => {
  let markStarted
  const started = new Promise((resolve) => {
    markStarted = resolve
  })
  const service = serviceWithFetch((_url, { signal }) => new Promise((_resolve, reject) => {
    markStarted()
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  let childExit
  let childKilled = false
  service.child = {
    once(_event, listener) {
      childExit = listener
      return this
    },
    kill() {
      childKilled = true
      queueMicrotask(childExit)
      return true
    },
  }
  const controller = new AbortController()
  const first = service.inpaint(image, mask, { signal: controller.signal })
  await started

  assert.equal(service.status().task.phase, 'sending-image')
  await assert.rejects(service.inpaint(image, mask), (error) => error.statusCode === 409)

  controller.abort()
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(childKilled, true)
  assert.equal(service.status().task, undefined)
})

test('LaMa inpainting has a hard timeout and always releases the single-flight lock', async () => {
  const service = serviceWithFetch((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }), { inpaintTimeout: 20 })

  await assert.rejects(service.inpaint(image, mask), (error) => {
    assert.equal(error.statusCode, 504)
    assert.match(error.message, /tamamlanmadı/)
    return true
  })
  assert.equal(service.status().task, undefined)
})

test('LaMa preserves non-JSON upstream error details when translating 500 to 502', async () => {
  const service = serviceWithFetch(async () => new Response('TorchScript inference failed: out of memory', {
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'Content-Type': 'text/plain' },
  }))

  await assert.rejects(service.inpaint(image, mask), (error) => {
    assert.equal(error.statusCode, 502)
    assert.match(error.message, /HTTP 500/)
    assert.match(error.message, /TorchScript inference failed: out of memory/)
    return true
  })
})
