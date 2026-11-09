import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const serverFile = fileURLToPath(new URL('../server/index.js', import.meta.url))
const mockFile = fileURLToPath(new URL('../test-fixtures/mock-serpapi.js', import.meta.url))
let serverProcess
let baseUrl
let observer
let observerServer
let geminiRequests = 0
const observerSockets = new Set()

async function unusedPort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const { port } = listener.address()
  await new Promise((resolve, reject) => {
    listener.close((error) => error ? reject(error) : resolve())
  })
  return port
}

async function startServer({ apiKey = 'test-server-only-key', geminiKey = '', mock = false } = {}) {
  const port = await unusedPort()
  const args = mock
    ? ['--import', pathToFileURL(mockFile).href, serverFile]
    : [serverFile]
  serverProcess = spawn(process.execPath, args, {
    env: {
      ...process.env,
      PORT: String(port),
      SERPAPI_API_KEY: apiKey,
      GEMINI_API_KEY: geminiKey,
      TEST_GEMINI_OBSERVER: observer,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  baseUrl = `http://127.0.0.1:${port}`
  let serverError = ''
  serverProcess.stderr.setEncoding('utf8')
  serverProcess.stderr.on('data', (chunk) => { serverError += chunk })

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
      throw new Error(`API server exited early: ${serverError}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`API server did not start: ${serverError}`)
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null) return
  serverProcess.kill()
  await once(serverProcess, 'exit')
}

before(async () => {
  const port = await unusedPort()
  observer = `http://127.0.0.1:${port}/gemini-call`
  observerServer = createHttpServer((request, response) => {
    if (request.method === 'POST' && request.url === '/gemini-call') geminiRequests += 1
    response.setHeader('Connection', 'close')
    response.writeHead(204)
    response.end()
  })
  observerServer.on('connection', (socket) => {
    observerSockets.add(socket)
    socket.once('close', () => observerSockets.delete(socket))
  })
  observerServer.listen(port, '127.0.0.1')
  await once(observerServer, 'listening')
  await startServer({ mock: true })
})
after(async () => {
  await stopServer()
  observerServer.close()
  observerServer.closeAllConnections()
  for (const socket of observerSockets) socket.destroy()
})

test('SerpApi sonuçları 20, 50 ve 100 görsel sınırına göre döndürülür', async () => {
  for (const count of [20, 50, 100]) {
    const response = await fetch(`${baseUrl}/api/search?query=deneme&count=${count}`)
    assert.equal(response.status, 200, await response.clone().text())

    const data = await response.json()
    assert.equal(data.photos.length, count)
    assert.equal(data.total, count)
    assert.equal(data.photos[0].sourceName, 'Test image source')
    assert.equal(data.photos[0].sourceUrl, 'https://source.example.com/image/1')
    assert.equal(data.photos[0].previewUrl, 'https://encrypted-tbn0.gstatic.com/images?image=1')
  }
})

test('SerpApi anahtarının değeri health yanıtında açıklanmaz', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  const body = await response.text()
  assert.equal(response.status, 200)
  assert.equal(JSON.parse(body).searchConfigured, true)
  assert.equal(body.includes('test-server-only-key'), false)
})

test('Desteklenmeyen görsel sayısı doğrulama hatası döndürür', async () => {
  const response = await fetch(`${baseUrl}/api/search?query=deneme&count=30`)
  assert.equal(response.status, 400)
})

test('AI analizi doğrular, yakın kopyaları ve tekrarlanan sorguları yeniden Gemini’ye göndermez', async () => {
  await stopServer()
  await startServer({ mock: true, geminiKey: 'test-gemini-key' })
  geminiRequests = 0

  const photos = [1, 2].map((id) => ({
    id: `celebrity-${id}`,
    imageUrl: `https://8.8.8.8/${id}.png`,
    analysisUrl: `https://8.8.8.8/${id}.png`,
    previewUrl: `https://8.8.8.8/${id}.png`,
    sourceUrl: `https://source.example.com/image/${id}`,
    sourceName: 'Test source',
    alt: 'Celebrity at an event',
  }))

  async function analyze() {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Famous Actor', bestCount: 10, photos }),
    })
    assert.equal(response.status, 202)
    const { jobId } = await response.json()

    let lastStatus
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const status = await fetch(`${baseUrl}/api/jobs/${jobId}`)
      const data = await status.json()
      if (!status.ok) throw new Error(`Analiz işi başarısız oldu: ${data.error}`)
      if (data.status === 'completed') return data
      lastStatus = data
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.fail(`Görsel analizi tamamlanmadı: ${JSON.stringify(lastStatus)}`)
  }

  const first = await analyze()
  assert.equal(first.photos.length, 2)
  assert.equal(first.autoSelected, 1)
  assert.equal(first.photos[0].subjectMatch, 'match')
  assert.equal(first.photos[0].subjectConfidence, 96)
  assert.equal(first.photos[0].score, 84)
  assert.equal(first.photos.find((photo) => photo.duplicateOf)?.selected, false)
  assert.equal(geminiRequests, 1)

  const second = await analyze()
  assert.equal(second.autoSelected, 1)
  assert.equal(geminiRequests, 1)
})

test('SerpApi anahtarı yoksa arama açıkça yapılandırma hatası verir', async (context) => {
  await stopServer()
  await startServer({ apiKey: '' })
  context.after(stopServer)

  const response = await fetch(`${baseUrl}/api/search?query=deneme&count=20`)
  const data = await response.json()
  assert.equal(response.status, 503)
  assert.match(data.error, /SERPAPI_API_KEY/)
})
