import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createKenBurnsWebm } from '../src/studio-video.js'

function createRecordingEnvironment({ supported = true, emptyOutput = false } = {}) {
  const calls = []
  const track = { stop: () => calls.push('track-stopped') }
  const listeners = new Map()
  class MockRecorder {
    static isTypeSupported(type) {
      return supported && type === 'video/webm;codecs=vp9'
    }

    constructor(stream, options) {
      this.stream = stream
      this.options = options
      this.state = 'inactive'
      calls.push(['recorder-created', options.mimeType])
    }

    addEventListener(name, callback) {
      listeners.set(name, callback)
    }

    start() {
      this.state = 'recording'
      calls.push('recording-started')
    }

    stop() {
      this.state = 'inactive'
      calls.push('recording-stopped')
      listeners.get('dataavailable')?.({ data: new Blob(emptyOutput ? [] : ['webm-bytes']) })
      listeners.get('stop')?.()
    }
  }
  const canvas = {
    getContext: () => ({ drawImage: (...args) => calls.push(['frame', ...args.slice(1)]) }),
    captureStream: (frameRate) => {
      calls.push(['capture-stream', frameRate])
      return { getTracks: () => [track] }
    },
  }
  let timestamp = 0
  return {
    calls,
    canvas,
    MockRecorder,
    options: {
      MediaRecorderClass: MockRecorder,
      createCanvas: () => canvas,
      requestFrame: (callback) => {
        timestamp += 2500
        callback(timestamp)
      },
      now: () => 0,
      duration: 5000,
    },
  }
}

test('tarayıcı video aracı gerçek kayıt API çağrılarıyla WebM blob üretir ve kaynakları kapatır', async () => {
  const environment = createRecordingEnvironment()
  const blob = await createKenBurnsWebm(
    { naturalWidth: 2000, naturalHeight: 1000 },
    environment.options,
  )
  assert.equal(blob.type, 'video/webm;codecs=vp9')
  assert.ok(blob.size > 0)
  assert.ok(environment.calls.some((call) => Array.isArray(call) && call[0] === 'capture-stream' && call[1] === 24))
  assert.equal(environment.calls.filter((call) => Array.isArray(call) && call[0] === 'frame').length, 2)
  assert.ok(environment.calls.includes('track-stopped'))
})

test('video aracı uyumsuz tarayıcı ve boş video çıktısını sessiz başarı saymaz', async () => {
  const unsupported = createRecordingEnvironment({ supported: false })
  await assert.rejects(createKenBurnsWebm(
    { naturalWidth: 320, naturalHeight: 240 },
    unsupported.options,
  ), /WebM video kodlamasını desteklemiyor/)
  assert.ok(unsupported.calls.includes('track-stopped'))

  const empty = createRecordingEnvironment({ emptyOutput: true })
  await assert.rejects(createKenBurnsWebm(
    { naturalWidth: 320, naturalHeight: 240 },
    empty.options,
  ), /boş video çıktısı/)
})
