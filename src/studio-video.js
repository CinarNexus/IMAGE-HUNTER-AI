export async function createKenBurnsWebm(image, {
  MediaRecorderClass = globalThis.MediaRecorder,
  createCanvas = () => document.createElement('canvas'),
  requestFrame = globalThis.requestAnimationFrame,
  now = () => globalThis.performance.now(),
  duration = 5000,
} = {}) {
  if (!MediaRecorderClass || typeof requestFrame !== 'function') {
    throw new Error('Bu tarayıcı WebM kaydı desteklemiyor.')
  }
  const canvas = createCanvas()
  if (typeof canvas.captureStream !== 'function') throw new Error('Bu tarayıcı WebM kaydı desteklemiyor.')
  const scale = Math.min(1, 1920 / image.naturalWidth, 1920 / image.naturalHeight)
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Tarayıcı video tuvali oluşturamadı.')
  const stream = canvas.captureStream(24)
  const supportedTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  const mimeType = supportedTypes.find((candidate) => (
    typeof MediaRecorderClass.isTypeSupported !== 'function'
      || MediaRecorderClass.isTypeSupported(candidate)
  ))
  if (!mimeType) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error('Tarayıcı WebM video kodlamasını desteklemiyor.')
  }

  const recorder = new MediaRecorderClass(stream, { mimeType })
  const chunks = []
  const recorded = new Promise((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data)
    })
    recorder.addEventListener('error', () => reject(new Error('Tarayıcı video kaydını tamamlayamadı.')), { once: true })
    recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true })
  })

  try {
    const startedAt = now()
    recorder.start()
    await new Promise((resolve, reject) => {
      function drawFrame(timestamp) {
        try {
          const progress = Math.min(1, (timestamp - startedAt) / duration)
          const zoom = 1 + progress * 0.1
          const width = canvas.width * zoom
          const height = canvas.height * zoom
          context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
          if (progress < 1) requestFrame(drawFrame)
          else resolve()
        } catch (error) {
          reject(error)
        }
      }
      requestFrame(drawFrame)
    })
    recorder.stop()
    const blob = await recorded
    if (!blob.size) throw new Error('Tarayıcı boş video çıktısı üretti.')
    return blob
  } finally {
    if (recorder.state === 'recording') recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
  }
}
