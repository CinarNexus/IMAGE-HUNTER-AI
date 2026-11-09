const originalFetch = globalThis.fetch
const sharp = (await import('sharp')).default
const testImage = await sharp({
  create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 60, b: 90 } },
}).png().toBuffer()

globalThis.fetch = async (input, options) => {
  const url = input instanceof URL
    ? input
    : new URL(typeof input === 'string' ? input : input.url)

  if (url.hostname === '8.8.8.8') {
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
  const images_results = Array.from({ length: 100 }, (_, index) => ({
    title: `${query} image ${index + 1}`,
    source: 'Test image source',
    original: `https://8.8.8.8/${index + 1}.png`,
    thumbnail: `https://encrypted-tbn0.gstatic.com/images?image=${index + 1}`,
    link: `https://source.example.com/image/${index + 1}`,
    original_width: 1920,
    original_height: 1080,
  }))

  return new Response(JSON.stringify({ images_results }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
