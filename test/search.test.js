import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

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

async function analyze(query, photos, bestCount = 20) {
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, bestCount, photos }),
  })
  assert.equal(response.status, 202)
  const { jobId } = await response.json()

  let lastStatus
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await fetch(`${baseUrl}/api/jobs/${jobId}`)
    const data = await status.json()
    if (!status.ok) throw new Error(`Analiz işi başarısız oldu: ${data.error}`)
    if (data.status === 'completed') return { ...data, jobId }
    lastStatus = data
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(`Görsel analizi tamamlanmadı: ${JSON.stringify(lastStatus)}`)
}

test('SerpApi sonuçları 20, 50 ve 100 görsel sınırına göre döndürülür', async () => {
  let firstSearchId
  for (const count of [20, 50, 100]) {
    const response = await fetch(`${baseUrl}/api/search?query=deneme&count=${count}`)
    assert.equal(response.status, 200, await response.clone().text())

    const data = await response.json()
    assert.equal(data.photos.length, count)
    assert.equal(data.total, count)
    assert.equal(data.photos[0].sourceName, 'Test image source')
    assert.equal(data.photos[0].sourceUrl, 'https://source.example.com/image/1')
    assert.equal(data.photos[0].previewUrl, 'https://encrypted-tbn0.gstatic.com/images?image=1')
    if (count === 20) firstSearchId = data.searchId
  }

  const nextPageParams = new URLSearchParams({
    query: 'deneme',
    count: '20',
    page: '1',
    searchId: firstSearchId,
  })
  const nextPage = await fetch(`${baseUrl}/api/search?${nextPageParams}`)
  const nextData = await nextPage.json()
  assert.equal(nextPage.status, 200)
  assert.equal(nextData.page, 1)
  assert.equal(nextData.hasMore, false)
  assert.equal(nextData.photos[0].alt, 'deneme image 101')
  assert.equal(nextData.searchId, firstSearchId)

  const wrongQuery = await fetch(`${baseUrl}/api/search?${new URLSearchParams({
    query: 'başka sorgu',
    count: '20',
    page: '1',
    searchId: firstSearchId,
  })}`)
  assert.equal(wrongQuery.status, 400)
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

test('Stüdyo yüklemesi gerçek görsel formatını doğrular ve geçici önizleme sağlar', async () => {
  const image = await sharp({
    create: { width: 256, height: 192, channels: 3, background: { r: 28, g: 44, b: 72 } },
  }).png().toBuffer()
  const uploadResponse = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: image,
  })
  assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text())
  const { upload } = await uploadResponse.json()
  assert.equal(upload.mimeType, 'image/png')
  assert.equal(upload.width, 256)
  assert.equal(upload.height, 192)
  assert.ok(upload.size > 0)
  assert.match(upload.previewUrl, new RegExp(`/api/studio/uploads/${upload.id}$`))

  const previewResponse = await fetch(`${baseUrl}${upload.previewUrl}`)
  assert.equal(previewResponse.status, 200)
  assert.equal(previewResponse.headers.get('content-type'), 'image/png')
  assert.equal(previewResponse.headers.get('cache-control'), 'no-store')
  assert.deepEqual(
    await sharp(Buffer.from(await previewResponse.arrayBuffer())).metadata().then(({ format }) => format),
    'png',
  )

  const deleteResponse = await fetch(`${baseUrl}${upload.previewUrl}`, { method: 'DELETE' })
  assert.equal(deleteResponse.status, 204)
  const expiredResponse = await fetch(`${baseUrl}${upload.previewUrl}`)
  assert.equal(expiredResponse.status, 404)
})

test('Stüdyo yüklemesi reddeder: geçersiz içerik türü, bozuk görsel ve aşırı büyük gövde', async () => {
  const wrongContentType = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('not-an-image'),
  })
  assert.equal(wrongContentType.status, 415)

  const corrupted = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('not-an-image'),
  })
  assert.equal(corrupted.status, 415)

  const svg = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
  })
  assert.equal(svg.status, 415)

  const tooManyPixels = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: '#fff' },
  }).png().toBuffer()
  const pixelLimit = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: tooManyPixels,
  })
  assert.equal(pixelLimit.status, 413)

  const oversized = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.alloc(15 * 1024 * 1024 + 1),
  })
  assert.equal(oversized.status, 413)
})

test('Studio Sharp düzenlemesi önizleme ve yüksek çözünürlüklü PNG/JPG/WebP üretir; orijinali korur', async () => {
  const original = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 90, g: 120, b: 160 } },
  }).png().toBuffer()
  const uploadResponse = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: original,
  })
  assert.equal(uploadResponse.status, 201)
  const { upload } = await uploadResponse.json()
  const adjustments = {
    brightness: 12,
    contrast: 18,
    saturation: 24,
    temperature: 35,
    gamma: 1.25,
    sharpness: 20,
  }

  const previewResponse = await fetch(`${baseUrl}/api/studio/uploads/${upload.id}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustments }),
  })
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text())
  const preview = Buffer.from(await previewResponse.arrayBuffer())
  const previewMetadata = await sharp(preview).metadata()
  assert.equal(previewMetadata.format, 'jpeg')
  assert.ok(previewMetadata.width <= 1200)
  assert.equal(previewResponse.headers.get('cache-control'), 'no-store')

  for (const [format, expectedMimeType] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const exportResponse = await fetch(`${baseUrl}/api/studio/uploads/${upload.id}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adjustments, format }),
    })
    assert.equal(exportResponse.status, 200, await exportResponse.clone().text())
    assert.equal(exportResponse.headers.get('content-type'), expectedMimeType)
    assert.match(exportResponse.headers.get('content-disposition'), new RegExp(`image-hunter-edited\\.${format}`))
    const exported = Buffer.from(await exportResponse.arrayBuffer())
    const metadata = await sharp(exported).metadata()
    assert.equal(metadata.format, format === 'jpg' ? 'jpeg' : format)
    assert.equal(metadata.width, upload.width)
    assert.equal(metadata.height, upload.height)
  }

  const unchangedResponse = await fetch(`${baseUrl}${upload.previewUrl}`)
  const unchanged = Buffer.from(await unchangedResponse.arrayBuffer())
  assert.deepEqual(unchanged, original)
  assert.notDeepEqual(preview, original)
})

test('Studio düzenleme güvenli şekilde hatalı ayar, format ve yükleme kimliğini reddeder', async () => {
  const image = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#557799' },
  }).png().toBuffer()
  const uploadResponse = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: image,
  })
  const { upload } = await uploadResponse.json()
  const adjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    gamma: 1,
    sharpness: 0,
  }

  const invalidAdjustment = await fetch(`${baseUrl}/api/studio/uploads/${upload.id}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustments: { ...adjustments, brightness: 1000 } }),
  })
  assert.equal(invalidAdjustment.status, 400)

  const invalidFormat = await fetch(`${baseUrl}/api/studio/uploads/${upload.id}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustments, format: 'svg' }),
  })
  assert.equal(invalidFormat.status, 400)

  const invalidUpload = await fetch(`${baseUrl}/api/studio/uploads/not-a-uuid/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustments }),
  })
  assert.equal(invalidUpload.status, 404)
})

test('Studio araç API’leri gerçek önizleme ve dışa aktarma çıktısı üretir', async () => {
  const image = await sharp({
    create: { width: 96, height: 72, channels: 3, background: { r: 32, g: 84, b: 142 } },
  }).png().toBuffer()
  const uploadResponse = await fetch(`${baseUrl}/api/studio/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: image,
  })
  assert.equal(uploadResponse.status, 201)
  const { upload } = await uploadResponse.json()
  const mask = await sharp({
    create: { width: 16, height: 12, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite([{
    input: { create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } },
    left: 6,
    top: 4,
  }]).png().toBuffer()
  const tools = [
    ['background-removal', {}],
    ['image-enhancement', { scale: 2, sharpness: 0 }],
    ['sharpening', { amount: 40, sigma: 1 }],
    ['object-removal', { mask: mask.toString('base64') }],
    ['background-replacement', { backgroundColor: '#eef4ff' }],
    ['smart-crop', { ratio: '4:5', width: 100 }],
    ['color-light-correction', {
      format: 'png',
      adjustments: { brightness: 12, contrast: 8, saturation: 15, temperature: 10, gamma: 1.1, sharpness: 0 },
    }],
    ['thumbnail', { width: 384, height: 216, text: 'Test', format: 'jpg' }],
    ['glow-effects', { color: '#16d9e8', intensity: 30, blur: 20 }],
  ]

  try {
    for (const [tool, options] of tools) {
      for (const action of ['preview', 'export']) {
        const response = await fetch(`${baseUrl}/api/studio/uploads/${upload.id}/tools/${tool}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ options }),
        })
        assert.equal(response.status, 200, `${tool} ${action}: ${await response.clone().text()}`)
        const output = Buffer.from(await response.arrayBuffer())
        assert.ok(output.length > 0, `${tool} ${action} returned an empty output`)
        assert.match(response.headers.get('content-type'), /^image\//)
        assert.ok((await sharp(output).metadata()).width > 0)
        if (action === 'export') assert.match(response.headers.get('content-disposition'), new RegExp(`image-hunter-${tool}`))
      }
    }

    const disabledTool = await fetch(`${baseUrl}/api/studio/uploads/${upload.id}/tools/not-enabled/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: {} }),
    })
    assert.equal(disabledTool.status, 400)
    const unchangedResponse = await fetch(`${baseUrl}${upload.previewUrl}`)
    assert.deepEqual(Buffer.from(await unchangedResponse.arrayBuffer()), image)
  } finally {
    await fetch(`${baseUrl}${upload.previewUrl}`, { method: 'DELETE' })
  }
})

test('Studio toplu düzenleme oturum görsellerini ZIP olarak dışa aktarır', async () => {
  const image = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 80, g: 120, b: 170 } },
  }).png().toBuffer()
  const uploads = []
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${baseUrl}/api/studio/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: image,
      })
      assert.equal(response.status, 201)
      uploads.push((await response.json()).upload)
    }
    const adjustments = {
      brightness: 10,
      contrast: 5,
      saturation: 10,
      temperature: 0,
      gamma: 1,
      sharpness: 0,
    }
    const response = await fetch(`${baseUrl}/api/studio/batch-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadIds: uploads.map(({ id }) => id), adjustments, format: 'webp' }),
    })
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal(response.headers.get('content-type'), 'application/zip')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const archive = Buffer.from(await response.arrayBuffer())
    assert.equal(archive.subarray(0, 2).toString(), 'PK')

    const invalid = await fetch(`${baseUrl}/api/studio/batch-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadIds: [], adjustments, format: 'png' }),
    })
    assert.equal(invalid.status, 400)
  } finally {
    await Promise.all(uploads.map(({ previewUrl }) => (
      fetch(`${baseUrl}${previewUrl}`, { method: 'DELETE' })
    )))
  }
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
  })).concat([
    {
      id: 'low-resolution',
      imageUrl: 'https://8.8.8.8/small.png',
      analysisUrl: 'https://8.8.8.8/small.png',
      previewUrl: 'https://8.8.8.8/small.png',
      sourceUrl: 'https://source.example.com/image/small',
      alt: 'Celebrity at an event',
    },
    {
      id: 'unavailable',
      imageUrl: 'https://8.8.8.8/broken.png',
      analysisUrl: 'https://8.8.8.8/broken.png',
      previewUrl: 'https://8.8.8.8/broken.png',
      sourceUrl: 'https://source.example.com/image/broken',
      alt: 'Celebrity at an event',
    },
  ])

  const first = await analyze('Famous Actor', photos)
  assert.equal(first.photos.length, 4)
  assert.equal(first.autoSelected, 1)
  assert.equal(first.photos[0].subjectMatch, 'match')
  assert.equal(first.photos[0].subjectConfidence, 96)
  assert.equal(first.photos[0].score, 85)
  assert.equal(first.photos.find((photo) => photo.duplicateOf)?.selected, false)
  assert.match(first.photos.find((photo) => photo.id === 'low-resolution').analysisError, /çözünürlüğü/)
  assert.match(first.photos.find((photo) => photo.id === 'unavailable').analysisError, /HTTP 404/)
  assert.equal(geminiRequests, 1)

  const second = await analyze('Famous Actor', photos, 100)
  assert.equal(second.autoSelected, 1)
  assert.equal(geminiRequests, 1)
})

test('kadın ve erkek ünlü adları aramadan Gemini doğrulamasına değiştirilmeden aynı kuralla ulaşır', async () => {
  const cases = [
    { query: 'Taylor Swift', scenario: 'female-celebrity' },
    { query: 'Cristiano Ronaldo', scenario: 'male-celebrity' },
  ]

  for (const { query, scenario } of cases) {
    const searchResponse = await fetch(`${baseUrl}/api/search?${new URLSearchParams({ query, count: '20' })}`)
    assert.equal(searchResponse.status, 200)
    const searchData = await searchResponse.json()
    assert.ok(searchData.photos[0].alt.startsWith(`${query} image`))

    const sourcePhoto = searchData.photos[0]
    const photo = {
      ...sourcePhoto,
      id: `test-${scenario}`,
      imageUrl: `https://8.8.8.8/person-${scenario}.png`,
      analysisUrl: `https://8.8.8.8/person-${scenario}.png`,
      previewUrl: `https://8.8.8.8/person-${scenario}.png`,
      sourceUrl: `https://source.example.com/${scenario}`,
      alt: `TEST_PERSON_FILTER: ${scenario}`,
    }
    const result = await analyze(query, [photo])
    const analyzedPhoto = result.photos[0]

    assert.equal(result.autoSelected, 1, JSON.stringify(analyzedPhoto))
    assert.equal(analyzedPhoto.subjectMatch, 'match')
    assert.equal(analyzedPhoto.subjectConfidence, 96)
    assert.equal(analyzedPhoto.personCount, 1)
    assert.equal(analyzedPhoto.personCountConfidence, 99)
    assert.equal(analyzedPhoto.score, 85)
    assert.equal(analyzedPhoto.selected, true)
  }
})

test('ZIP uygunluğu kişi, kimlik ve yüz kapılarını birlikte uygular ve her sonuca gerekçe döndürür', async () => {
  geminiRequests = 0
  const searchResponse = await fetch(`${baseUrl}/api/search?${new URLSearchParams({
    query: 'TEST_PERSON_FILTER',
    count: '20',
  })}`)
  const searchData = await searchResponse.json()
  assert.equal(searchResponse.status, 200)
  const scenarios = searchData.photos.map((photo) => photo.alt.split(': ')[1])
  const photos = searchData.photos
  const searchOnlyDownload = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      searchId: searchData.searchId,
      photoIds: [photos.find((photo) => photo.alt.endsWith('group')).id],
      photos: [{ verified: false, imageUrl: 'http://127.0.0.1/private-file' }],
    }),
  })
  assert.equal(searchOnlyDownload.status, 200)
  assert.match(searchOnlyDownload.headers.get('content-type'), /application\/zip/)

  const result = await analyze('Famous Actor', photos)
  const findScenario = (scenario) => result.photos.find((photo) => photo.alt.endsWith(scenario))
  const single = findScenario('single')
  const group = findScenario('group')
  const twoPeople = findScenario('two-people')
  const backgroundPeople = findScenario('background-people')
  const crowd = findScenario('crowd')
  const uncertain = findScenario('uncertain')
  const uncertainIdentity = findScenario('uncertain-identity')
  const wrongPerson = findScenario('wrong-person')
  const hiddenFace = findScenario('hidden-face')

  assert.equal(result.autoSelected, 1)
  assert.equal(single.personCount, 1)
  assert.equal(single.faceVisible, true)
  assert.equal(single.faceRecognizable, true)
  assert.equal(single.personCountConfidence, 99)
  assert.equal(typeof single.score, 'number')
  assert.equal(single.selected, true)
  assert.equal(single.aiVerified, true)
  assert.match(single.aiVerificationReason, /AI tarafından doğrulandı/)

  assert.equal(group.personCount, 2)
  assert.equal(group.score, undefined)
  assert.equal(group.autoSelected, false)
  assert.equal(group.aiVerified, false)
  assert.match(group.aiVerificationReason, /2 kişi/)
  assert.equal(twoPeople.personCount, 2)
  assert.equal(twoPeople.score, undefined)
  assert.equal(backgroundPeople.personCount, 2)
  assert.equal(backgroundPeople.score, undefined)
  assert.equal(crowd.personCount, 8)
  assert.equal(crowd.score, undefined)
  assert.equal(uncertain.personCountConfidence, 52)
  assert.equal(uncertain.score, undefined)
  assert.equal(uncertain.autoSelected, false)
  assert.equal(uncertain.aiVerified, false)
  assert.match(uncertain.aiVerificationReason, /sayımı yeterince kesin değil/)
  assert.equal(uncertainIdentity.subjectMatch, 'uncertain')
  assert.equal(uncertainIdentity.aiVerified, false)
  assert.match(uncertainIdentity.aiVerificationReason, /kimliği doğrulanamadı/)

  assert.equal(wrongPerson.subjectMatch, 'mismatch')
  assert.equal(wrongPerson.score, undefined)
  assert.equal(wrongPerson.autoSelected, false)

  assert.equal(hiddenFace.faceVisible, false)
  assert.equal(hiddenFace.faceRecognizable, false)
  assert.equal(hiddenFace.score, undefined)
  assert.equal(hiddenFace.autoSelected, false)
  assert.equal(hiddenFace.aiVerified, false)
  assert.match(hiddenFace.aiVerificationReason, /Yüz görünmüyor/)
  assert.ok(result.photos.every((photo) => typeof photo.aiVerificationReason === 'string' && photo.aiVerificationReason.length > 0))
  assert.equal(geminiRequests, scenarios.length)

  const unverifiedDownload = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      searchId: 'not-a-real-search-session',
      photoIds: [single.id],
      photos: [{ id: single.id, verified: true, imageUrl: 'https://8.8.8.8/person-single.png' }],
    }),
  })
  assert.equal(unverifiedDownload.status, 400)
  assert.match((await unverifiedDownload.json()).error, /arama oturumu/)

  const fabricatedIdDownload = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      searchId: searchData.searchId,
      photoIds: ['invented-photo-id'],
    }),
  })
  assert.equal(fabricatedIdDownload.status, 400)
  assert.match((await fabricatedIdDownload.json()).error, /bu arama oturumunda/)

  const duplicateIdDownload = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchId: searchData.searchId, photoIds: [single.id, single.id] }),
  })
  assert.equal(duplicateIdDownload.status, 400)
  assert.match((await duplicateIdDownload.json()).error, /seçimleri geçersiz/)

  const unverifiedDownloadFromSearch = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchId: searchData.searchId, photoIds: [group.id] }),
  })
  assert.equal(unverifiedDownloadFromSearch.status, 200)
  assert.match(unverifiedDownloadFromSearch.headers.get('content-type'), /application\/zip/)

  const rejectedDownload = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      searchId: searchData.searchId,
      photoIds: [backgroundPeople.id, uncertainIdentity.id, hiddenFace.id],
    }),
  })
  assert.equal(rejectedDownload.status, 200)
  assert.match(rejectedDownload.headers.get('content-type'), /application\/zip/)

  const validDownload = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchId: searchData.searchId, photoIds: [single.id] }),
  })
  assert.equal(validDownload.status, 200)
  assert.match(validDownload.headers.get('content-type'), /application\/zip/)
  assert.deepEqual(Array.from(new Uint8Array(await validDownload.arrayBuffer()).slice(0, 4)), [80, 75, 3, 4])
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
