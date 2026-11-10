const originalFetch = globalThis.fetch
const sharp = (await import('sharp')).default
const testImage = await sharp({
  create: { width: 512, height: 512, channels: 3, background: { r: 200, g: 60, b: 90 } },
}).png().toBuffer()
const smallImage = await sharp({
  create: { width: 128, height: 128, channels: 3, background: { r: 200, g: 60, b: 90 } },
}).png().toBuffer()
const personFilterImages = Object.fromEntries(await Promise.all(
  [
    ['single', { r: 210, g: 30, b: 40 }],
    ['group', { r: 30, g: 210, b: 40 }],
    ['wrong-person', { r: 30, g: 40, b: 210 }],
    ['hidden-face', { r: 210, g: 180, b: 30 }],
  ].map(async ([name, background]) => [
    name,
    await sharp({ create: { width: 512, height: 512, channels: 3, background } }).png().toBuffer(),
  ]),
))

globalThis.fetch = async (input, options) => {
  const url = input instanceof URL
    ? input
    : new URL(typeof input === 'string' ? input : input.url)

  if (url.hostname === '8.8.8.8') {
    if (url.pathname === '/small.png') {
      return new Response(smallImage, { headers: { 'Content-Type': 'image/png' } })
    }
    if (url.pathname === '/broken.png') return new Response('', { status: 404 })
    const scenario = url.pathname.match(/^\/person-(single|group|wrong-person|hidden-face)\.png$/)?.[1]
    if (scenario) return new Response(personFilterImages[scenario], { headers: { 'Content-Type': 'image/png' } })
    return new Response(testImage, { headers: { 'Content-Type': 'image/png' } })
  }

  if (url.hostname === 'generativelanguage.googleapis.com') {
    const observer = process.env.TEST_GEMINI_OBSERVER
    if (observer) {
      await originalFetch(observer, { method: 'POST' })
    }
    const requestBody = typeof options?.body === 'string'
      ? options.body
      : JSON.stringify(options?.body || {})
    const scenario = ['group', 'wrong-person', 'hidden-face'].find((name) => requestBody.includes(`TEST_PERSON_FILTER: ${name}`))
    const subject = scenario === 'group'
      ? { personCount: 2, subjectMatch: 'match', faceVisible: true, faceRecognizable: true, reason: 'Fotoğrafta birden fazla insan var.' }
      : scenario === 'wrong-person'
        ? { personCount: 1, subjectMatch: 'mismatch', faceVisible: true, faceRecognizable: true, reason: 'Fotoğraftaki kişi aranan kişi değil.' }
        : scenario === 'hidden-face'
          ? { personCount: 1, subjectMatch: 'match', faceVisible: false, faceRecognizable: false, reason: 'Yüz yeterince görünür ve tanınabilir değil.' }
          : { personCount: 1, subjectMatch: 'match', faceVisible: true, faceRecognizable: true, reason: 'Aranan kişi tek başına ve yüzü tanınabilir şekilde görünüyor.' }
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            text: JSON.stringify({
              ...subject,
              subjectConfidence: 96,
              relevance: 90,
              clarity: 80,
              resolution: 75,
              lighting: 80,
              colors: 85,
              composition: 90,
              framing: 88,
              editSuitability: 88,
            }),
          }],
        },
        finishReason: 'STOP',
      }],
    }), { headers: { 'Content-Type': 'application/json' } })
  }

  if (url.hostname !== 'serpapi.com') return originalFetch(input, options)

  if (url.searchParams.get('api_key') !== process.env.SERPAPI_API_KEY) {
    return new Response(JSON.stringify({ error: 'Invalid test API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const query = url.searchParams.get('q')
  const page = Number(url.searchParams.get('ijn')) || 0
  const images_results = Array.from({ length: 100 }, (_, index) => ({
    title: `${query} image ${page * 100 + index + 1}`,
    source: 'Test image source',
    original: `https://8.8.8.8/${page * 100 + index + 1}.png`,
    thumbnail: `https://encrypted-tbn0.gstatic.com/images?image=${page * 100 + index + 1}`,
    link: `https://source.example.com/image/${page * 100 + index + 1}`,
    original_width: 1920,
    original_height: 1080,
  }))

  const serpapi_pagination = page < 1 ? { next: 'https://serpapi.com/search.json?ijn=1' } : {}
  return new Response(JSON.stringify({ images_results, serpapi_pagination }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
