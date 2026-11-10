const originalFetch = globalThis.fetch
const sharp = (await import('sharp')).default
const testImage = await sharp({
  create: { width: 512, height: 512, channels: 3, background: { r: 200, g: 60, b: 90 } },
}).png().toBuffer()
const smallImage = await sharp({
  create: { width: 128, height: 128, channels: 3, background: { r: 200, g: 60, b: 90 } },
}).png().toBuffer()

globalThis.fetch = async (input, options) => {
  const url = input instanceof URL
    ? input
    : new URL(typeof input === 'string' ? input : input.url)

  if (url.hostname === '8.8.8.8') {
    if (url.pathname === '/small.png') {
      return new Response(smallImage, { headers: { 'Content-Type': 'image/png' } })
    }
    if (url.pathname === '/broken.png') return new Response('', { status: 404 })
    return new Response(testImage, { headers: { 'Content-Type': 'image/png' } })
  }

  if (url.hostname === 'generativelanguage.googleapis.com') {
    const observer = process.env.TEST_GEMINI_OBSERVER
    if (observer) {
      await originalFetch(observer, { method: 'POST' })
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            text: JSON.stringify({
              subjectMatch: 'match',
              subjectConfidence: 96,
              relevance: 90,
              clarity: 80,
              resolution: 75,
              lighting: 80,
              colors: 85,
              composition: 90,
              framing: 88,
              editSuitability: 88,
              reason: 'Konu karede belirgin ve kompozisyon edit için dengeli.',
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
