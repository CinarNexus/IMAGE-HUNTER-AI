import { useEffect, useRef, useState } from 'react'
import './Studio.css'
import { createKenBurnsWebm } from './studio-video.js'

const EMPTY_ADJUSTMENTS = Object.freeze({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  gamma: 1,
  sharpness: 0,
})

const ADJUSTMENT_CONTROLS = [
  { key: 'brightness', label: 'Parlaklık', min: -50, max: 50, step: 1, unit: '' },
  { key: 'contrast', label: 'Kontrast', min: -50, max: 50, step: 1, unit: '' },
  { key: 'saturation', label: 'Doygunluk', min: -100, max: 100, step: 1, unit: '' },
  { key: 'temperature', label: 'Renk sıcaklığı', min: -100, max: 100, step: 1, unit: '' },
  { key: 'gamma', label: 'Gamma', min: 1, max: 3, step: 0.05, unit: '×' },
  { key: 'sharpness', label: 'Keskinlik', min: 0, max: 100, step: 1, unit: '' },
]

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_BATCH_FILES = 5
const STANDARD_PREVIEW_TIMEOUT_MS = 60_000
const LAMA_PREVIEW_TIMEOUT_MS = 225_000
const LAMA_PHASE_LABELS = {
  'starting-python': 'LaMa Python süreci başlatılıyor',
  'loading-python-dependencies': 'Python ve Torch bağımlılıkları yükleniyor',
  'verifying-model': 'LaMa model dosyasının bütünlüğü doğrulanıyor',
  'loading-model': 'TorchScript modeli belleğe yükleniyor',
  ready: 'LaMa modeli hazır',
  preparing: 'Görsel işleme için hazırlanıyor',
  validating: 'Görsel ve maske doğrulanıyor',
  'sending-image': 'Görsel yerel LaMa servisine gönderiliyor',
  inference: 'LaMa modeli CPU üzerinde görseli işliyor',
  encoding: 'Sonuç görseli oluşturuluyor',
  'receiving-result': 'İşlenmiş önizleme alınıyor',
}
const TOOL_OPTIONS = {
  'background-removal': { tolerance: 42, softness: 16 },
  'image-enhancement': { scale: 2, sharpness: 35 },
  sharpening: { amount: 45, sigma: 1.2 },
  'object-removal': { engine: 'lama', mask: '', dilation: 4, feather: 5, radius: 3 },
  'background-replacement': {
    segmentationMask: '',
    backgroundMode: 'color',
    backgroundColor: '#17243a',
    backgroundPreset: '',
    backgroundUploadId: '',
    edgeSoftness: 2,
    maskExpansion: 0,
    subjectScale: 1,
    positionX: 0,
    positionY: 0,
    format: 'png',
  },
  'smart-crop': { ratio: '1:1', width: 1200 },
  thumbnail: { width: 1280, height: 720, text: '', backgroundColor: '#17243a', format: 'png' },
  'glow-effects': { color: '#1677ff', intensity: 30, blur: 20 },
}
const TOOLS = [
  { id: 'background-removal', label: 'Arka plan kaldırma', description: 'Kenar renginden anahtarlama; düz arka planlarda en iyi sonucu verir.' },
  { id: 'image-enhancement', label: 'Kalite artırma', description: 'AI değildir: Lanczos büyütme ve isteğe bağlı keskinleştirme.' },
  { id: 'sharpening', label: 'Fotoğraf netleştirme', description: 'Klasik Sharp keskinleştirme filtresi.' },
  { id: 'object-removal', label: 'Nesne silme', description: 'LaMa generatif inpainting ve açıkça seçilebilir klasik Telea alternatifi.' },
  { id: 'background-replacement', label: 'Arka plan değiştirme', description: 'OpenCV GrabCut ile fırça yönlendirmeli klasik segmentasyon; AI modeli değildir.' },
  { id: 'smart-crop', label: 'Akıllı kırpma', description: 'Sharp attention odaklı oran kırpma.' },
  { id: 'color-light-correction', label: 'Renk ve ışık', description: 'Sharp ile parlaklık, kontrast, doygunluk, sıcaklık, gamma ve keskinlik.' },
  { id: 'thumbnail', label: 'Thumbnail oluşturucu', description: 'Görseli kırpar, katman ve isteğe bağlı metin ekler.' },
  { id: 'glow-effects', label: 'Glow ve efektler', description: 'Renkli bulanık ışık katmanı; AI değildir.' },
  { id: 'batch-editing', label: 'Toplu düzenleme', description: 'Renk/ışık ayarlarını birden çok görsele uygular ve ZIP indirir.' },
  { id: 'image-to-video', label: 'Fotoğraftan video', description: 'Tarayıcıda 5 saniyelik pan/zoom WebM üretir; AI değildir.' },
]

function StudioIcon({ name, size = 18 }) {
  const paths = {
    upload: <><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    sparkle: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z" /><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1L19 14Z" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.6-2L20 12M4 12l2.9 5a7 7 0 0 0 11.6-2" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function describeError(message) {
  if (message.includes('Failed to fetch')) return 'Sunucuya bağlanılamadı. Backend bağlantısını kontrol edip tekrar deneyin.'
  return message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
}

async function describeResponseError(response, fallback) {
  let body
  try {
    body = await response.text()
  } catch (error) {
    return `${fallback} (HTTP ${response.status}): Yanıt gövdesi okunamadı: ${error.message}`
  }

  let detail = ''
  try {
    const data = JSON.parse(body)
    detail = data.error || data.detail || ''
  } catch {
    detail = body
      .replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return `${fallback} (HTTP ${response.status})${detail ? `: ${detail.slice(0, 500)}` : ''}`
}

function Studio() {
  const [upload, setUpload] = useState(null)
  const [adjustments, setAdjustments] = useState(EMPTY_ADJUSTMENTS)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [format, setFormat] = useState('png')
  const [originalOnly, setOriginalOnly] = useState(false)
  const [comparisonPosition, setComparisonPosition] = useState(50)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeTool, setActiveTool] = useState('color-light-correction')
  const [toolOptions, setToolOptions] = useState(TOOL_OPTIONS['background-removal'])
  const [batchUploads, setBatchUploads] = useState([])
  const [batchExporting, setBatchExporting] = useState(false)
  const [maskStrokes, setMaskStrokes] = useState([])
  const [redoStrokes, setRedoStrokes] = useState([])
  const [brushSize, setBrushSize] = useState(28)
  const [maskReady, setMaskReady] = useState(false)
  const [effectiveMaskUrl, setEffectiveMaskUrl] = useState('')
  const [maskPreviewMode, setMaskPreviewMode] = useState('raw')
  const [maskPreviewing, setMaskPreviewing] = useState(false)
  const [maskPreviewError, setMaskPreviewError] = useState('')
  const [backgroundUpload, setBackgroundUpload] = useState(null)
  const [brushMode, setBrushMode] = useState('foreground')
  const [lamaStatus, setLamaStatus] = useState(null)
  const [lamaStarting, setLamaStarting] = useState(false)
  const inputRef = useRef(null)
  const batchInputRef = useRef(null)
  const backgroundInputRef = useRef(null)
  const previewRequestRef = useRef(null)
  const previewUrlRef = useRef('')
  const maskPreviewRequestRef = useRef(null)
  const effectiveMaskUrlRef = useRef('')
  const uploadRef = useRef(null)
  const backgroundUploadRef = useRef(null)
  const batchUploadsRef = useRef([])
  const maskCanvasRef = useRef(null)
  const maskDataCanvasRef = useRef(null)
  const maskDimensionsRef = useRef({ width: 0, height: 0 })
  const activeStrokeRef = useRef(null)

  useEffect(() => () => {
    previewRequestRef.current?.abort()
    maskPreviewRequestRef.current?.abort()
    maskPreviewRequestRef.current = null
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    if (effectiveMaskUrlRef.current) URL.revokeObjectURL(effectiveMaskUrlRef.current)
    if (uploadRef.current?.id) {
      fetch(`/api/studio/uploads/${uploadRef.current.id}`, { method: 'DELETE' })
        .catch((cleanupError) => console.error('Studio upload cleanup failed:', cleanupError))
    }
    if (backgroundUploadRef.current?.id) {
      fetch(`/api/studio/uploads/${backgroundUploadRef.current.id}`, { method: 'DELETE' })
        .catch((cleanupError) => console.error('Studio background cleanup failed:', cleanupError))
    }
    for (const batchUpload of batchUploadsRef.current) {
      fetch(`/api/studio/uploads/${batchUpload.id}`, { method: 'DELETE' })
        .catch((cleanupError) => console.error('Studio batch upload cleanup failed:', cleanupError))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/studio/lama/status', { signal: controller.signal })
      .then(async (response) => {
        const status = await response.json()
        if (!response.ok) throw new Error(status.error || 'LaMa durumu alınamadı.')
        setLamaStatus(status)
      })
      .catch((statusError) => {
        if (statusError.name !== 'AbortError') {
          setLamaStatus({ installed: false, ready: false, error: describeError(statusError.message) })
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!upload) return undefined
    const controller = new AbortController()
    previewRequestRef.current?.abort()
    previewRequestRef.current = controller
    if (['batch-editing', 'image-to-video'].includes(activeTool)) {
      return undefined
    }
    if (activeTool === 'object-removal' && !toolOptions.mask) return undefined
    let timedOut = false
    let timeoutId
    const timer = window.setTimeout(async () => {
      setPreviewing(true)
      setError('')
      const timeoutMs = activeTool === 'object-removal' && toolOptions.engine === 'lama'
        ? LAMA_PREVIEW_TIMEOUT_MS
        : STANDARD_PREVIEW_TIMEOUT_MS
      timeoutId = window.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      try {
        const options = activeTool === 'color-light-correction'
          ? { adjustments, format }
          : toolOptions
        if (typeof upload.id !== 'string' || !upload.id.trim()) {
          throw new Error('Yükleme kimliği eksik. Görseli yeniden yükleyin.')
        }
        const response = await fetch(`/api/studio/uploads/${upload.id}/tools/${activeTool}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ options }),
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(await describeResponseError(response, 'Önizleme oluşturulamadı'))
        }
        const nextUrl = URL.createObjectURL(await response.blob())
        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = nextUrl
        setPreviewUrl(nextUrl)
      } catch (previewError) {
        if (timedOut) {
          setError(activeTool === 'object-removal' && toolOptions.engine === 'lama'
            ? 'LaMa önizlemesi 3 dakika 45 saniye içinde tamamlanmadı. İşlem iptal edildi; daha küçük bir görsel deneyin.'
            : 'Önizleme 60 saniye içinde tamamlanmadı. İşlem iptal edildi; tekrar deneyin.')
        } else if (previewError.name !== 'AbortError') {
          setError(describeError(previewError.message))
        }
      } finally {
        window.clearTimeout(timeoutId)
        if (!controller.signal.aborted || timedOut) setPreviewing(false)
      }
    }, 240)

    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [upload, adjustments, activeTool, toolOptions, format])

  useEffect(() => {
    maskPreviewRequestRef.current?.abort()
    if (effectiveMaskUrlRef.current) URL.revokeObjectURL(effectiveMaskUrlRef.current)
    effectiveMaskUrlRef.current = ''
    if (!upload || activeTool !== 'object-removal' || !toolOptions.mask) return undefined

    const controller = new AbortController()
    maskPreviewRequestRef.current = controller
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 15_000)
    const loadMaskPreview = async () => {
      try {
        const response = await fetch(
          `/api/studio/uploads/${upload.id}/tools/object-removal/mask-preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              options: {
                mask: toolOptions.mask,
                dilation: toolOptions.dilation,
                feather: toolOptions.feather,
              },
            }),
            signal: controller.signal,
          },
        )
        if (!response.ok) {
          throw new Error(await describeResponseError(response, 'Etkin maske önizlemesi oluşturulamadı'))
        }
        if (!response.headers.get('content-type')?.includes('image/png')) {
          throw new Error('Sunucu etkin maske için geçerli bir PNG döndürmedi.')
        }
        const blob = await response.blob()
        if (!blob.size) throw new Error('Etkin maske önizlemesi boş döndü.')
        const nextUrl = URL.createObjectURL(blob)
        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        effectiveMaskUrlRef.current = nextUrl
        setEffectiveMaskUrl(nextUrl)
      } catch (maskError) {
        if (timedOut) {
          setMaskPreviewError('Etkin maske 15 saniyede hazırlanamadı. Lütfen yeniden deneyin.')
        } else if (maskError.name !== 'AbortError') {
          setMaskPreviewError(describeError(maskError.message))
        }
      } finally {
        window.clearTimeout(timeoutId)
        if (maskPreviewRequestRef.current === controller) setMaskPreviewing(false)
      }
    }
    loadMaskPreview()
    return () => {
      window.clearTimeout(timeoutId)
      if (maskPreviewRequestRef.current === controller) maskPreviewRequestRef.current = null
      controller.abort()
    }
  }, [upload, activeTool, toolOptions.mask, toolOptions.dilation, toolOptions.feather])

  useEffect(() => {
    if (activeTool !== 'object-removal' || toolOptions.engine !== 'lama' || (!previewing && !lamaStarting)) {
      return undefined
    }
    const controller = new AbortController()
    const refreshStatus = async () => {
      try {
        const response = await fetch('/api/studio/lama/status', { signal: controller.signal })
        const status = await response.json()
        if (!response.ok) throw new Error(status.error || 'LaMa durumu alınamadı.')
        setLamaStatus(status)
      } catch (statusError) {
        if (statusError.name !== 'AbortError') {
          setLamaStatus((current) => ({ ...current, error: describeError(statusError.message) }))
        }
      }
    }
    refreshStatus()
    const interval = window.setInterval(refreshStatus, 1000)
    return () => {
      window.clearInterval(interval)
      controller.abort()
    }
  }, [activeTool, toolOptions.engine, previewing, lamaStarting])

  async function removeUpload(id) {
    const response = await fetch(`/api/studio/uploads/${id}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw new Error('Geçici görsel silinemedi; bir saat içinde otomatik temizlenecek.')
  }

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreviewUrl('')
  }

  async function acceptFile(file) {
    if (!file) return
    setError('')
    setNotice('')
    setPreviewing(false)
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('JPEG, PNG, WebP veya AVIF formatında bir görsel seçin.')
      return
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      setError('Dosya boş veya 15 MB sınırını aşıyor.')
      return
    }

    setUploading(true)
    setPreviewing(true)
    try {
      const response = await fetch('/api/studio/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      if (!response.ok) throw new Error(await describeResponseError(response, 'Görsel yüklenemedi'))
      const data = await response.json()
      if (!data.upload || typeof data.upload.id !== 'string' || !data.upload.id.trim()) {
        throw new Error('Sunucu geçerli bir yükleme kimliği döndürmedi. Lütfen tekrar yükleyin.')
      }
      const previousUpload = uploadRef.current
      uploadRef.current = data.upload
      setUpload({ ...data.upload, name: file.name })
      setEffectiveMaskUrl('')
      setMaskPreviewMode('raw')
      setMaskPreviewing(false)
      setMaskPreviewError('')
      setAdjustments({ ...EMPTY_ADJUSTMENTS })
      setMaskStrokes([])
      setRedoStrokes([])
      setMaskReady(false)
      setPreviewUrl('')
      setOriginalOnly(false)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
      if (previousUpload?.id) {
        try {
          await removeUpload(previousUpload.id)
        } catch (deleteError) {
          setError(deleteError.message)
        }
      }
      setNotice('Görsel güvenli geçici alana yüklendi. Orijinal dosya korunuyor.')
    } catch (uploadError) {
      setPreviewing(false)
      setError(describeError(uploadError.message))
    } finally {
      setUploading(false)
      if (['batch-editing', 'image-to-video'].includes(activeTool)) setPreviewing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function uploadBatchFiles(files) {
    const selected = [...files]
    const capacity = MAX_BATCH_FILES - (upload ? 1 : 0) - batchUploadsRef.current.length
    if (!selected.length) return
    if (selected.length > capacity) {
      setError(`Bu oturumda en fazla ${MAX_BATCH_FILES} görsel düzenlenebilir.`)
      return
    }
    setError('')
    setNotice('')
    setUploading(true)
    const added = []
    try {
      for (const file of selected) {
        if (!ACCEPTED_TYPES.includes(file.type) || file.size === 0 || file.size > MAX_FILE_BYTES) {
          throw new Error(`${file.name}: JPEG, PNG, WebP veya AVIF olmalı ve 15 MB sınırını aşmamalıdır.`)
        }
        const response = await fetch('/api/studio/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `${file.name} yüklenemedi.`)
        added.push({ ...data.upload, name: file.name })
      }
      batchUploadsRef.current = [...batchUploadsRef.current, ...added]
      setBatchUploads(batchUploadsRef.current)
      setNotice(`${added.length} görsel güvenli geçici alana yüklendi.`)
    } catch (batchError) {
      const cleanupResults = await Promise.allSettled(added.map(({ id }) => removeUpload(id)))
      const cleanupFailed = cleanupResults.some(({ status }) => status === 'rejected')
      setError(`${describeError(batchError.message)}${cleanupFailed ? ' Bazı geçici dosyalar otomatik temizlenmeye bırakıldı.' : ''}`)
    } finally {
      setUploading(false)
      if (batchInputRef.current) batchInputRef.current.value = ''
    }
  }

  async function exportBatch() {
    if (!batchUploads.length || batchExporting || exporting) return
    setBatchExporting(true)
    setError('')
    try {
      const response = await fetch('/api/studio/batch-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadIds: batchUploads.map(({ id }) => id),
          adjustments,
          format,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Toplu ZIP oluşturulamadı.')
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('Toplu işlem boş bir ZIP oluşturdu.')
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = 'image-hunter-batch.zip'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setNotice(`${batchUploads.length} düzenlenmiş görsel ZIP olarak indirildi.`)
    } catch (batchError) {
      setError(describeError(batchError.message))
    } finally {
      setBatchExporting(false)
    }
  }

  function drawMaskStrokes(strokes, { updateOptions = true } = {}) {
    const visualCanvas = maskCanvasRef.current
    const dataCanvas = maskDataCanvasRef.current
    if (!visualCanvas || !dataCanvas) return
    const { width, height } = maskDimensionsRef.current
    const visualContext = visualCanvas.getContext('2d')
    const maskContext = dataCanvas.getContext('2d')
    if (!visualContext || !maskContext) {
      setError('Tarayıcı maske fırçasını başlatamadı.')
      return
    }
    visualContext.clearRect(0, 0, width, height)
    maskContext.fillStyle = '#000'
    maskContext.fillRect(0, 0, width, height)
    for (const stroke of strokes) {
      if (!stroke.points.length) continue
      const start = stroke.points[0]
      const foreground = stroke.mode === 'foreground'
      const visualColor = activeTool === 'background-replacement'
        ? foreground ? 'rgba(22,217,232,.62)' : 'rgba(255,64,96,.62)'
        : 'rgba(255,64,96,.58)'
      const dataColor = activeTool === 'background-replacement'
        ? foreground ? '#00ff00' : '#ff0000'
        : '#fff'
      for (const [context, color] of [[visualContext, visualColor], [maskContext, dataColor]]) {
        context.beginPath()
        context.strokeStyle = color
        context.fillStyle = color
        const strokeSize = stroke.brushSize ?? brushSize
        context.lineWidth = strokeSize
        context.lineCap = 'round'
        context.lineJoin = 'round'
        if (stroke.points.length === 1) {
          context.arc(start.x * width, start.y * height, strokeSize / 2, 0, Math.PI * 2)
          context.fill()
        } else {
          context.moveTo(start.x * width, start.y * height)
          for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height)
          context.stroke()
        }
      }
    }
    if (updateOptions && ['object-removal', 'background-replacement'].includes(activeTool)) {
      if (activeTool === 'object-removal') clearPreview()
      const mask = dataCanvas.toDataURL('image/png')
      setMaskReady(strokes.length > 0)
      if (activeTool === 'object-removal') {
        setEffectiveMaskUrl('')
        setMaskPreviewMode('raw')
        setMaskPreviewError('')
        setMaskPreviewing(strokes.length > 0)
      }
      const maskKey = activeTool === 'object-removal' ? 'mask' : 'segmentationMask'
      setPreviewing(strokes.length > 0 || activeTool === 'background-replacement')
      setToolOptions((current) => ({ ...current, [maskKey]: strokes.length ? mask : '' }))
    }
  }

  function initializeObjectMask(image) {
    if (!image.naturalWidth || !image.naturalHeight) return
    const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    maskDimensionsRef.current = { width, height }
    for (const canvas of [maskCanvasRef.current, maskDataCanvasRef.current]) {
      if (!canvas) continue
      canvas.width = width
      canvas.height = height
    }
    drawMaskStrokes(maskStrokes, { updateOptions: false })
    if (activeTool === 'object-removal') setMaskReady(Boolean(toolOptions.mask))
  }

  function objectMaskPoint(event) {
    const canvas = maskCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const { width, height } = maskDimensionsRef.current
    const scale = Math.min(rect.width / width, rect.height / height)
    const renderedWidth = width * scale
    const renderedHeight = height * scale
    const offsetX = (rect.width - renderedWidth) / 2
    const offsetY = (rect.height - renderedHeight) / 2
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left - offsetX) / renderedWidth)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top - offsetY) / renderedHeight)),
    }
  }

  function beginObjectStroke(event) {
    if (!maskCanvasRef.current || !maskDimensionsRef.current.width) {
      setError('Maske alanı henüz hazır değil.')
      return
    }
    const point = objectMaskPoint(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    activeStrokeRef.current = {
      points: [point],
      brushSize,
      mode: activeTool === 'background-replacement' ? brushMode : 'remove',
    }
    drawMaskStrokes([...maskStrokes, activeStrokeRef.current], { updateOptions: false })
  }

  function continueObjectStroke(event) {
    if (!activeStrokeRef.current) return
    const point = objectMaskPoint(event)
    if (!point) return
    activeStrokeRef.current.points.push(point)
    drawMaskStrokes([...maskStrokes, activeStrokeRef.current], { updateOptions: false })
  }

  function endObjectStroke() {
    if (!activeStrokeRef.current) return
    const completedStroke = activeStrokeRef.current
    activeStrokeRef.current = null
    const strokes = [...maskStrokes, completedStroke]
    setMaskStrokes(strokes)
    setRedoStrokes([])
    drawMaskStrokes(strokes)
    setNotice(activeTool === 'object-removal'
      ? toolOptions.engine === 'lama'
        ? 'İşaretli alan LaMa generatif modeliyle işlenecek.'
        : 'İşaretli alan OpenCV Telea ile doldurulacak; üretken AI kullanılmaz.'
      : 'Ön plan/arka plan işareti OpenCV GrabCut segmentasyonuna eklendi; üretken AI kullanılmaz.')
  }

  function undoMaskStroke() {
    if (!maskStrokes.length) return
    const strokes = maskStrokes.slice(0, -1)
    setMaskStrokes(strokes)
    setRedoStrokes((current) => [...current, maskStrokes.at(-1)])
    drawMaskStrokes(strokes)
  }

  function redoMaskStroke() {
    if (!redoStrokes.length) return
    const strokes = [...maskStrokes, redoStrokes.at(-1)]
    setMaskStrokes(strokes)
    setRedoStrokes((current) => current.slice(0, -1))
    drawMaskStrokes(strokes)
  }

  function clearMask() {
    setMaskStrokes([])
    setRedoStrokes([])
    drawMaskStrokes([])
    setMaskReady(false)
    if (activeTool === 'object-removal') {
      setEffectiveMaskUrl('')
      setMaskPreviewMode('raw')
      setMaskPreviewing(false)
      setMaskPreviewError('')
    }
    const isBackgroundReplacement = activeTool === 'background-replacement'
    setPreviewing(isBackgroundReplacement)
    if (!isBackgroundReplacement) {
      setPreviewUrl('')
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
    }
    const maskKey = isBackgroundReplacement ? 'segmentationMask' : 'mask'
    setToolOptions((current) => ({ ...current, [maskKey]: '' }))
  }

  function selectTool(toolId) {
    drawMaskStrokes([], { updateOptions: false })
    setActiveTool(toolId)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreviewUrl('')
    setOriginalOnly(false)
    setError('')
    setToolOptions(TOOL_OPTIONS[toolId] || {})
    setEffectiveMaskUrl('')
    setMaskPreviewMode('raw')
    setMaskPreviewing(false)
    setMaskPreviewError('')
    setMaskStrokes([])
    setRedoStrokes([])
    setMaskReady(false)
    setBrushMode('foreground')
    setPreviewing(Boolean(upload && !['batch-editing', 'image-to-video', 'object-removal', 'background-replacement'].includes(toolId)))
  }

  function updateToolOptions(nextOptions) {
    clearPreview()
    if (activeTool === 'object-removal') {
      setEffectiveMaskUrl('')
      setMaskPreviewMode('raw')
      setMaskPreviewing(Boolean(upload && toolOptions.mask))
      setMaskPreviewError('')
    }
    setPreviewing(Boolean(upload && (activeTool !== 'object-removal' || toolOptions.mask)))
    setError('')
    setToolOptions((current) => ({ ...current, ...nextOptions }))
  }

  async function startLama() {
    if (lamaStarting) return
    setLamaStarting(true)
    setError('')
    try {
      const response = await fetch('/api/studio/lama/start', {
        method: 'POST',
        signal: AbortSignal.timeout(130_000),
      })
      const status = await response.json()
      if (!response.ok) throw new Error(status.error || 'LaMa motoru başlatılamadı.')
      setLamaStatus(status)
    } catch (startError) {
      setError(startError.name === 'TimeoutError'
        ? 'LaMa motoru 2 dakika içinde hazır olmadı. Servis durumunu yenileyip tekrar deneyin.'
        : describeError(startError.message))
    } finally {
      setLamaStarting(false)
    }
  }

  async function refreshLamaStatus() {
    try {
      const response = await fetch('/api/studio/lama/status', { signal: AbortSignal.timeout(8_000) })
      const status = await response.json()
      if (!response.ok) throw new Error(status.error || 'LaMa durumu alınamadı.')
      setLamaStatus(status)
    } catch (statusError) {
      setError(describeError(statusError.message))
    }
  }

  async function chooseBackgroundImage(file) {
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type) || file.size === 0 || file.size > MAX_FILE_BYTES) {
      setError('Arka plan görseli JPEG, PNG, WebP veya AVIF olmalı ve 15 MB sınırını aşmamalıdır.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const response = await fetch('/api/studio/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Arka plan görseli yüklenemedi.')
      const previous = backgroundUploadRef.current
      backgroundUploadRef.current = { ...data.upload, name: file.name }
      setBackgroundUpload(backgroundUploadRef.current)
      updateToolOptions({
        backgroundMode: 'upload',
        backgroundUploadId: data.upload.id,
        backgroundPreset: '',
      })
      if (previous?.id) await removeUpload(previous.id)
    } catch (backgroundError) {
      setError(describeError(backgroundError.message))
    } finally {
      setUploading(false)
      if (backgroundInputRef.current) backgroundInputRef.current.value = ''
    }
  }

  function updateAdjustment(key, value) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreviewUrl('')
    setPreviewing(true)
    setError('')
    setAdjustments((current) => ({ ...current, [key]: Number(value) }))
    setOriginalOnly(false)
  }

  function resetAdjustments() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreviewUrl('')
    setPreviewing(true)
    setError('')
    setAdjustments({ ...EMPTY_ADJUSTMENTS })
    setOriginalOnly(false)
    setNotice('Tüm ayarlar varsayılan değerlere döndürüldü.')
  }

  async function exportImage() {
    if (!upload || !previewUrl || previewing || exporting) return
    setExporting(true)
    setError('')
    try {
      const options = activeTool === 'color-light-correction'
        ? { adjustments, format }
        : toolOptions
      const response = await fetch(`/api/studio/uploads/${upload.id}/tools/${activeTool}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Düzenlenmiş görsel dışa aktarılamadı.')
      }
      const blob = await response.blob()
      if (!blob.size) throw new Error('Dışa aktarılan görsel boş.')
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || format
      anchor.download = `image-hunter-${activeTool}.${extension}`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setNotice(`${extension.toUpperCase()} çıktı indirildi.`)
    } catch (exportError) {
      setError(describeError(exportError.message))
    } finally {
      setExporting(false)
    }
  }

  async function exportVideo() {
    if (!upload || exporting) return
    setExporting(true)
    setError('')
    try {
      const image = new Image()
      image.src = upload.previewUrl
      await image.decode()
      const blob = await createKenBurnsWebm(image)
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = 'image-hunter-motion.webm'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setNotice('5 saniyelik pan/zoom WebM videosu oluşturuldu. AI kullanılmadı.')
    } catch (videoError) {
      setError(describeError(videoError.message))
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="studio-page" aria-labelledby="studio-title">
      <header className="studio-heading">
        <div>
          <div className="studio-eyebrow"><span /> IMAGE HUNTER CREATIVE SUITE</div>
          <h1 id="studio-title">AI <span>Studio</span></h1>
          <p>Fotoğrafları klasik görüntü işleme araçlarıyla düzenle. Görsel işlemleri güvenli Studio sunucusunda, video tarayıcında çalışır; orijinal dosyan değişmeden kalır.</p>
        </div>
        <div className="studio-engine"><StudioIcon name="sparkle" size={16} /><span>{activeTool === 'image-to-video' ? 'BROWSER RECORDER' : ['object-removal', 'background-replacement'].includes(activeTool) ? 'OPENCV + SHARP' : 'SHARP ENGINE'}</span><i /> Ücretsiz</div>
      </header>

      <nav className="studio-tools" aria-label="Studio araçları">
        {TOOLS.map((tool) => (
          <button
            type="button"
            key={tool.id}
            className={activeTool === tool.id ? 'studio-tool-active' : ''}
            aria-pressed={activeTool === tool.id}
            onClick={() => selectTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </nav>
      <p className="studio-tool-description">{TOOLS.find((tool) => tool.id === activeTool)?.description}</p>

      {activeTool === 'batch-editing' ? (
        <section className="studio-batch-panel">
          <h2>Toplu renk ve ışık düzenleme</h2>
          <p>En fazla {MAX_BATCH_FILES} görseli aynı ayarlarla işleyip ZIP olarak indirin. İşlem başına çıktılar geçici bellekte hazırlanır.</p>
          <input
            ref={batchInputRef}
            className="studio-file-input"
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            multiple
            onChange={(event) => uploadBatchFiles(event.target.files)}
            aria-label="Toplu düzenleme için fotoğrafları seç"
          />
          <button className="studio-export-button" type="button" onClick={() => batchInputRef.current?.click()} disabled={uploading || batchExporting}>
            {uploading ? 'Yükleniyor…' : 'Fotoğrafları seç'}
          </button>
          <ul className="studio-batch-list">
            {batchUploads.map((batchUpload) => (
              <li key={batchUpload.id}>
                <span>{batchUpload.name} · {batchUpload.width} × {batchUpload.height}</span>
                <button type="button" onClick={async () => {
                  try {
                    await removeUpload(batchUpload.id)
                    batchUploadsRef.current = batchUploadsRef.current.filter(({ id }) => id !== batchUpload.id)
                    setBatchUploads(batchUploadsRef.current)
                  } catch (deleteError) {
                    setError(deleteError.message)
                  }
                }}>Kaldır</button>
              </li>
            ))}
          </ul>
          <div className="studio-batch-settings">
            {ADJUSTMENT_CONTROLS.map((control) => (
              <label className="studio-slider" key={control.key}>
                <span className="studio-slider-label"><span>{control.label}</span><output>{adjustments[control.key]}</output></span>
                <input type="range" min={control.min} max={control.max} step={control.step} value={adjustments[control.key]} onChange={(event) => setAdjustments((current) => ({ ...current, [control.key]: Number(event.target.value) }))} />
              </label>
            ))}
            <label className="studio-export">
              <span>DIŞA AKTARMA FORMATI</span>
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option>
              </select>
            </label>
          </div>
          <button className="studio-export-button" type="button" onClick={exportBatch} disabled={!batchUploads.length || batchExporting || uploading}>
            {batchExporting ? 'ZIP hazırlanıyor…' : `${batchUploads.length} görseli düzenle ve ZIP indir`}
          </button>
        </section>
      ) : (
      <div className="studio-workspace">
        <section className="studio-editor" aria-label={`${TOOLS.find((tool) => tool.id === activeTool)?.label} düzenleme`}>
          {!upload ? (
            <button
              type="button"
              className={`studio-dropzone ${dragging ? 'studio-dropzone-active' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                acceptFile(event.dataTransfer.files[0])
              }}
              disabled={uploading}
            >
              <span className="studio-drop-icon">{uploading ? <span className="studio-spinner" /> : <StudioIcon name="upload" size={23} />}</span>
              <strong>{uploading ? 'Görsel doğrulanıyor ve yükleniyor…' : 'Fotoğrafını buraya bırak'}</strong>
              <span>veya cihazından bir dosya seç</span>
              <small>JPEG · PNG · WEBP · AVIF <i /> En fazla 15 MB · 20 MP</small>
            </button>
          ) : (
            <>
              <div className="studio-preview-header">
                <div><StudioIcon name="image" size={16} /><span>{upload.name}</span></div>
                <button type="button" className="studio-remove" onClick={async () => {
                  const previous = upload
                  uploadRef.current = null
                  setUpload(null)
                  setPreviewUrl('')
                  setPreviewing(false)
                  setOriginalOnly(false)
                  setEffectiveMaskUrl('')
                  setMaskPreviewMode('raw')
                  setMaskPreviewing(false)
                  setMaskPreviewError('')
                  if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
                  previewUrlRef.current = ''
                  try {
                    await removeUpload(previous.id)
                    setNotice('Geçici görsel silindi.')
                  } catch (deleteError) {
                    setError(deleteError.message)
                  }
                }} aria-label="Görseli kaldır"><StudioIcon name="close" size={16} /></button>
              </div>
              <div className={`studio-comparison ${originalOnly ? 'studio-original-only' : ''}`}>
                <figure>
                  <figcaption>
                    <span>{activeTool === 'object-removal' && maskPreviewMode === 'effective' ? 'ETKİN İKİLİ MASKE' : 'ORİJİNAL'}</span>
                    <span>{activeTool === 'object-removal' && maskPreviewMode === 'effective' ? 'Beyaz: işlenecek · Siyah: korunacak' : `${upload.width} × ${upload.height}`}</span>
                  </figcaption>
                  {activeTool === 'object-removal' && maskReady && (
                    <div className="studio-mask-preview-switch" role="group" aria-label="Maske önizleme türü">
                      <button
                        type="button"
                        aria-pressed={maskPreviewMode === 'raw'}
                        onClick={() => setMaskPreviewMode('raw')}
                      >
                        Ham fırça maskesi
                      </button>
                      <button
                        type="button"
                        aria-pressed={maskPreviewMode === 'effective'}
                        disabled={!effectiveMaskUrl}
                        onClick={() => setMaskPreviewMode('effective')}
                      >
                        Etkin ikili maske
                      </button>
                    </div>
                  )}
                  <div className="studio-image-wrap">
                    {activeTool === 'object-removal' && maskPreviewMode === 'effective' && effectiveMaskUrl ? (
                      <img className="studio-effective-mask" src={effectiveMaskUrl} alt="LaMa'ya gönderilecek genişletilmiş ikili maske" />
                    ) : ['object-removal', 'background-replacement'].includes(activeTool) ? (
                      <div className="studio-mask-stage">
                        <img src={upload.previewUrl} alt="Düzenleme maskesini çizmek için orijinal fotoğraf" onLoad={(event) => initializeObjectMask(event.currentTarget)} />
                        <canvas
                          ref={maskCanvasRef}
                          className="studio-mask-overlay"
                          aria-label="Fotoğraf düzenleme maskesi çizim alanı"
                          onPointerDown={beginObjectStroke}
                          onPointerMove={continueObjectStroke}
                          onPointerUp={endObjectStroke}
                          onPointerCancel={endObjectStroke}
                        />
                        <canvas ref={maskDataCanvasRef} className="studio-mask-data" aria-hidden="true" />
                      </div>
                    ) : <img src={upload.previewUrl} alt="Orijinal fotoğraf" />}
                  </div>
                </figure>
                <figure>
                  <figcaption><span>{originalOnly ? 'ORİJİNALE DÖNÜLDÜ' : 'DÜZENLENMİŞ'}</span><span>{upload.width} × {upload.height}</span></figcaption>
                  <div className={`studio-image-wrap ${previewUrl && !originalOnly ? 'studio-image-wrap-comparison' : ''}`}>
                    {previewUrl && !originalOnly ? (
                      <div className="studio-compare-wipe">
                        <img className="studio-compare-before" src={upload.previewUrl} alt="Önce: orijinal fotoğraf" />
                        <img
                          className="studio-compare-after"
                          src={previewUrl}
                          alt={`Sonra: ${TOOLS.find((tool) => tool.id === activeTool)?.label} sonucu`}
                          style={{ clipPath: `inset(0 ${100 - comparisonPosition}% 0 0)` }}
                        />
                        <span className="studio-compare-label studio-compare-label-before">ÖNCE</span>
                        <span className="studio-compare-label studio-compare-label-after">SONRA</span>
                        <span className="studio-compare-divider" style={{ left: `${comparisonPosition}%` }} aria-hidden="true" />
                        <input
                          className="studio-compare-range"
                          type="range"
                          min="0"
                          max="100"
                          value={comparisonPosition}
                          aria-label="Önce ve sonra karşılaştırma kaydırıcısı"
                          aria-valuetext={`Düzenlenmiş görüntü yüzde ${comparisonPosition} görünür`}
                          onChange={(event) => setComparisonPosition(Number(event.target.value))}
                        />
                      </div>
                    ) : (
                      <img
                        key={originalOnly ? 'original' : 'source'}
                        src={upload.previewUrl}
                        alt={originalOnly ? 'Orijinal fotoğraf' : 'Düzenleme önizlemesi bekleniyor'}
                      />
                    )}
                    {previewing && <span className="studio-preview-loading"><span className="studio-spinner" /> Önizleme güncelleniyor</span>}
                  </div>
                </figure>
              </div>
              <div className="studio-image-actions">
                <span><StudioIcon name="check" size={14} /> Orijinal dosya korundu</span>
                <button type="button" onClick={() => setOriginalOnly((value) => !value)}>
                  <StudioIcon name="refresh" size={14} /> {originalOnly ? 'Düzenlemeyi göster' : 'Orijinali göster'}
                </button>
              </div>
            </>
          )}
          <input
            ref={inputRef}
            className="studio-file-input"
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            onChange={(event) => acceptFile(event.target.files[0])}
            aria-label="Düzenlenecek fotoğrafı seç"
          />
        </section>

        <aside className="studio-controls">
          <div className="studio-controls-heading">
            <div><span className="studio-section-kicker">STUDIO ARACI</span><h2>{TOOLS.find((tool) => tool.id === activeTool)?.label}</h2></div>
            {activeTool === 'color-light-correction' && (
              <button type="button" onClick={resetAdjustments} disabled={!upload || uploading || exporting}>
                <StudioIcon name="refresh" size={14} /> Sıfırla
              </button>
            )}
          </div>
          {activeTool === 'color-light-correction' && <div className="studio-sliders">
            {ADJUSTMENT_CONTROLS.map((control) => {
              const value = adjustments[control.key]
              const displayedValue = control.key === 'gamma' ? `${value.toFixed(2)}${control.unit}` : `${value > 0 ? '+' : ''}${value}${control.unit}`
              return (
                <label className="studio-slider" key={control.key}>
                  <span className="studio-slider-label"><span>{control.label}</span><output htmlFor={`studio-${control.key}`}>{displayedValue}</output></span>
                  <input
                    id={`studio-${control.key}`}
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={value}
                    disabled={!upload || uploading || exporting}
                    onChange={(event) => updateAdjustment(control.key, event.target.value)}
                  />
                  <span className="studio-slider-range"><span>{control.key === 'temperature' ? 'Soğuk' : control.key === 'sharpness' ? 'Yumuşak' : control.key === 'gamma' ? 'Açık' : control.key === 'saturation' ? 'Soluk' : 'Az'}</span><span>{control.key === 'temperature' ? 'Sıcak' : control.key === 'sharpness' ? 'Keskin' : control.key === 'gamma' ? 'Koyu' : control.key === 'saturation' ? 'Canlı' : 'Çok'}</span></span>
                </label>
              )
            })}
          </div>}
          {activeTool === 'background-removal' && (
            <div className="studio-tool-settings">
              <label>Tolerans <input type="range" min="5" max="120" value={toolOptions.tolerance ?? 42} onChange={(event) => updateToolOptions({ tolerance: Number(event.target.value) })} /></label>
              <label>Kenar yumuşaklığı <input type="range" min="0" max="60" value={toolOptions.softness ?? 16} onChange={(event) => updateToolOptions({ softness: Number(event.target.value) })} /></label>
            </div>
          )}
          {activeTool === 'image-enhancement' && (
            <div className="studio-tool-settings">
              <label>Büyütme oranı <select value={toolOptions.scale ?? 2} onChange={(event) => updateToolOptions({ scale: Number(event.target.value) })}><option value="2">2× Lanczos</option><option value="4">4× Lanczos</option></select></label>
              <label>Keskinleştirme <input type="range" min="0" max="100" value={toolOptions.sharpness ?? 35} onChange={(event) => updateToolOptions({ sharpness: Number(event.target.value) })} /></label>
            </div>
          )}
          {activeTool === 'sharpening' && (
            <div className="studio-tool-settings">
              <label>Keskinlik <input type="range" min="0" max="100" value={toolOptions.amount ?? 45} onChange={(event) => updateToolOptions({ amount: Number(event.target.value) })} /></label>
              <label>Etki yarıçapı <input type="range" min="0.3" max="3" step="0.1" value={toolOptions.sigma ?? 1.2} onChange={(event) => updateToolOptions({ sigma: Number(event.target.value) })} /></label>
            </div>
          )}
          {activeTool === 'object-removal' && (
            <div className="studio-tool-settings">
              <p>Silinecek bölgeyi boya. LaMa, yerel çalışan açık kaynaklı generatif inpainting modelidir. LaMa kurulamazsa klasik Telea seçeneğini ayrıca seçebilirsin; otomatik geçiş yapılmaz.</p>
              <label>Silme motoru
                <select
                  value={toolOptions.engine ?? 'telea'}
                  onChange={(event) => updateToolOptions({ engine: event.target.value })}
                >
                  <option value="lama">LaMa · Generatif AI</option>
                  <option value="telea">Telea · Klasik görüntü işleme</option>
                </select>
              </label>
              <p className="studio-lama-status" role="status">
                {lamaStatus?.error
                  ? `LaMa durumu: ${lamaStatus.error}`
                  : lamaStatus?.ready
                    ? 'LaMa modeli hazır ve bu bilgisayarda çalışıyor.'
                    : lamaStatus?.running
                      ? `${LAMA_PHASE_LABELS[lamaStatus.phase] || 'LaMa servisi başlatılıyor'}${lamaStatus.phaseElapsedSeconds ? ` · ${lamaStatus.phaseElapsedSeconds} sn` : ''}`
                    : lamaStatus?.installed
                      ? 'LaMa kurulu; modeli başlatmak için aşağıdaki düğmeyi kullan.'
                      : 'LaMa bu bilgisayarda kurulu değil. Kurulum için npm run setup:lama komutunu çalıştır; istersen Telea’yı seçebilirsin.'}
              </p>
              {maskReady && (
                <p className="studio-mask-preview-status" role={maskPreviewError ? 'alert' : 'status'}>
                  {maskPreviewError
                    ? maskPreviewError
                    : maskPreviewing
                      ? 'LaMa etkin maskesi hazırlanıyor; inference çalıştırılmıyor.'
                      : 'Etkin maske, işlem çözünürlüğünde LaMa’ya gönderilecek ikili alandır. Beyaz alan doldurulur; siyah alan korunur.'}
                </p>
              )}
              {toolOptions.engine === 'lama' && (previewing || lamaStarting) && (
                <p className="studio-lama-progress" role="status">
                  <span className="studio-spinner" />
                  {LAMA_PHASE_LABELS[lamaStatus?.task?.phase || lamaStatus?.phase] || 'LaMa işlemi başlatılıyor'}
                  {typeof lamaStatus?.task?.elapsedSeconds === 'number' && ` · ${lamaStatus.task.elapsedSeconds} sn`}
                  {lamaStatus?.task?.phase === 'inference' && ' · Model bu aşamada güvenilir bir yüzde üretemiyor.'}
                  {previewing && (
                    <button
                      type="button"
                      onClick={() => {
                        previewRequestRef.current?.abort()
                        setPreviewing(false)
                        setError('LaMa önizlemesi durduruldu. Yeniden çalıştırmak için maskeyi veya ayarları değiştirin.')
                      }}
                    >
                      İptal et
                    </button>
                  )}
                </p>
              )}
              <button
                className="studio-secondary-button"
                type="button"
                onClick={refreshLamaStatus}
                disabled={lamaStarting}
              >
                Kurulum durumunu yenile
              </button>
              {lamaStatus?.installed && !lamaStatus.ready && (
                <button
                  className="studio-secondary-button"
                  type="button"
                  onClick={startLama}
                  disabled={lamaStarting}
                >
                  {lamaStarting
                    ? `${LAMA_PHASE_LABELS[lamaStatus?.phase] || 'LaMa modeli yükleniyor'}…`
                    : 'LaMa motorunu başlat'}
                </button>
              )}
              <label>Fırça boyutu <input type="range" min="6" max="96" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><output>{brushSize} px</output></label>
              <div className="studio-mask-actions">
                <button type="button" onClick={undoMaskStroke} disabled={!maskStrokes.length}>Geri al</button>
                <button type="button" onClick={redoMaskStroke} disabled={!redoStrokes.length}>Yinele</button>
                <button type="button" onClick={clearMask} disabled={!maskStrokes.length}>Maskeyi temizle</button>
              </div>
              <label>Maskeyi genişlet <input type="range" min="0" max="30" value={toolOptions.dilation ?? 4} onChange={(event) => updateToolOptions({ dilation: Number(event.target.value) })} /><output>{toolOptions.dilation ?? 4} px</output></label>
              <label>Kenar yumuşatma <input type="range" min="0" max="30" value={toolOptions.feather ?? 5} onChange={(event) => updateToolOptions({ feather: Number(event.target.value) })} /><output>{toolOptions.feather ?? 5} px</output></label>
              {toolOptions.engine === 'telea' && (
                <label>Telea yarıçapı <input type="range" min="1" max="10" value={toolOptions.radius ?? 3} onChange={(event) => updateToolOptions({ radius: Number(event.target.value) })} /><output>{toolOptions.radius ?? 3} px</output></label>
              )}
              <span>{maskReady ? 'Maske çizildi · sonuç önizleniyor' : 'Silinecek alanı fırçayla işaretleyin'}</span>
            </div>
          )}
          {activeTool === 'background-replacement' && (
            <div className="studio-tool-settings">
              <p>GrabCut klasik görüntü segmentasyonudur, AI modeli değildir. İlk seçim iç çerçeveden başlar; nesne ve arka planı fırçayla işaretleyerek düzelt.</p>
              <label>İşaretleme fırçası
                <select value={brushMode} onChange={(event) => setBrushMode(event.target.value)}>
                  <option value="foreground">Ana nesneyi ekle</option>
                  <option value="background">Arka planı çıkar</option>
                </select>
              </label>
              <label>Fırça boyutu <input type="range" min="6" max="96" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><output>{brushSize} px</output></label>
              <div className="studio-mask-legend"><span>Turkuaz: ana nesne</span><span>Pembe: arka plan</span></div>
              <div className="studio-mask-actions">
                <button type="button" onClick={undoMaskStroke} disabled={!maskStrokes.length}>Geri al</button>
                <button type="button" onClick={redoMaskStroke} disabled={!redoStrokes.length}>Yinele</button>
                <button type="button" onClick={clearMask} disabled={!maskStrokes.length}>İşaretleri temizle</button>
              </div>
              <label>Kenar yumuşatma <input type="range" min="0" max="20" value={toolOptions.edgeSoftness ?? 2} onChange={(event) => updateToolOptions({ edgeSoftness: Number(event.target.value) })} /><output>{toolOptions.edgeSoftness ?? 2} px</output></label>
              <label>Maske genişlet / daralt <input type="range" min="-20" max="20" value={toolOptions.maskExpansion ?? 0} onChange={(event) => updateToolOptions({ maskExpansion: Number(event.target.value) })} /><output>{toolOptions.maskExpansion ?? 0} px</output></label>
              <label>Yeni arka plan
                <select value={toolOptions.backgroundMode ?? 'color'} onChange={(event) => updateToolOptions({
                  backgroundMode: event.target.value,
                  backgroundUploadId: event.target.value === 'upload' ? backgroundUpload?.id || '' : '',
                  backgroundPreset: event.target.value === 'preset' ? 'soft-blue' : '',
                })}>
                  <option value="color">Düz renk</option>
                  <option value="preset">Hazır degrade</option>
                  <option value="upload">Kendi görselim</option>
                </select>
              </label>
              {toolOptions.backgroundMode === 'color' && (
                <label>Arka plan rengi <input type="color" value={toolOptions.backgroundColor ?? '#17243a'} onChange={(event) => updateToolOptions({ backgroundColor: event.target.value })} /></label>
              )}
              {toolOptions.backgroundMode === 'preset' && (
                <label>Hazır arka plan
                  <select value={toolOptions.backgroundPreset || 'soft-blue'} onChange={(event) => updateToolOptions({ backgroundPreset: event.target.value })}>
                    <option value="soft-blue">Yumuşak mavi</option>
                    <option value="warm-studio">Sıcak stüdyo</option>
                    <option value="dark-graphite">Koyu grafit</option>
                  </select>
                </label>
              )}
              {toolOptions.backgroundMode === 'upload' && (
                <>
                  <input ref={backgroundInputRef} className="studio-file-input" type="file" accept={ACCEPTED_TYPES.join(',')} onChange={(event) => chooseBackgroundImage(event.target.files[0])} />
                  <button type="button" className="studio-secondary-button" onClick={() => backgroundInputRef.current?.click()} disabled={uploading}>
                    {backgroundUpload?.name || 'Arka plan fotoğrafı seç'}
                  </button>
                </>
              )}
              <label>Ana nesne boyutu <input type="range" min="0.5" max="1.5" step="0.01" value={toolOptions.subjectScale ?? 1} onChange={(event) => updateToolOptions({ subjectScale: Number(event.target.value) })} /><output>{Math.round((toolOptions.subjectScale ?? 1) * 100)}%</output></label>
              <label>Yatay konum <input type="range" min="-0.5" max="0.5" step="0.01" value={toolOptions.positionX ?? 0} onChange={(event) => updateToolOptions({ positionX: Number(event.target.value) })} /></label>
              <label>Dikey konum <input type="range" min="-0.5" max="0.5" step="0.01" value={toolOptions.positionY ?? 0} onChange={(event) => updateToolOptions({ positionY: Number(event.target.value) })} /></label>
              <label>İndirme biçimi
                <select value={toolOptions.format ?? 'png'} onChange={(event) => updateToolOptions({ format: event.target.value })}>
                  <option value="png">PNG · Saydam kenarlar</option>
                  <option value="jpg">JPG · Evrensel</option>
                </select>
              </label>
              <span>Segmentasyon önizlemesi: {maskStrokes.length ? 'fırça işaretleri uygulandı' : 'otomatik iç çerçeve başlangıcı'}</span>
            </div>
          )}
          {activeTool === 'smart-crop' && (
            <div className="studio-tool-settings">
              <label>Oran <select value={toolOptions.ratio ?? '1:1'} onChange={(event) => updateToolOptions({ ratio: event.target.value })}><option>1:1</option><option>4:5</option><option>3:2</option><option>16:9</option></select></label>
              <label>Genişlik <input type="number" min="1" max="10000" value={toolOptions.width ?? 1200} onChange={(event) => updateToolOptions({ width: Number(event.target.value) })} /></label>
            </div>
          )}
          {activeTool === 'thumbnail' && (
            <div className="studio-tool-settings">
              <label>Başlık <input type="text" maxLength="100" value={toolOptions.text ?? ''} onChange={(event) => updateToolOptions({ text: event.target.value })} /></label>
              <label>Arka plan rengi <input type="color" value={toolOptions.backgroundColor ?? '#17243a'} onChange={(event) => updateToolOptions({ backgroundColor: event.target.value })} /></label>
              <label>Boyut
                <select value={`${toolOptions.width}x${toolOptions.height}`} onChange={(event) => {
                  const [width, height] = event.target.value.split('x').map(Number)
                  updateToolOptions({ width, height })
                }}><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option><option value="1080x1080">1080 × 1080</option></select>
              </label>
              <label>Format <select value={toolOptions.format ?? 'png'} onChange={(event) => updateToolOptions({ format: event.target.value })}><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option></select></label>
            </div>
          )}
          {activeTool === 'glow-effects' && (
            <div className="studio-tool-settings">
              <label>Glow rengi <input type="color" value={toolOptions.color ?? '#1677ff'} onChange={(event) => updateToolOptions({ color: event.target.value })} /></label>
              <label>Yoğunluk <input type="range" min="0" max="100" value={toolOptions.intensity ?? 30} onChange={(event) => updateToolOptions({ intensity: Number(event.target.value) })} /></label>
              <label>Yumuşaklık <input type="range" min="1" max="30" value={toolOptions.blur ?? 20} onChange={(event) => updateToolOptions({ blur: Number(event.target.value) })} /></label>
            </div>
          )}
          {activeTool === 'image-to-video' && (
            <div className="studio-tool-settings">
              <p>Yüklenen fotoğraftan 5 saniyelik merkez odaklı pan/zoom WebM videosu tarayıcında oluşturulur. AI kullanılmaz.</p>
              <button className="studio-export-button" type="button" onClick={exportVideo} disabled={!upload || exporting}>{exporting ? 'Video kaydediliyor…' : 'WebM videosu oluştur ve indir'}</button>
            </div>
          )}
          <div className="studio-export">
            <label htmlFor="studio-format">DIŞA AKTARMA FORMATI</label>
            <select id="studio-format" value={format} onChange={(event) => setFormat(event.target.value)} disabled={!upload || exporting}>
              <option value="png">PNG · Kayıpsız</option>
              <option value="jpg">JPG · Evrensel</option>
              <option value="webp">WebP · Verimli</option>
            </select>
            <button className="studio-export-button" type="button" onClick={exportImage} disabled={!upload || !previewUrl || originalOnly || previewing || uploading || exporting || activeTool === 'image-to-video' || (activeTool === 'object-removal' && !maskReady)}>
              {exporting ? <span className="studio-spinner" /> : <StudioIcon name="download" size={17} />}
              {exporting ? 'Hazırlanıyor…' : 'Yüksek çözünürlükte indir'}
            </button>
            <p>Önizleme web için küçültülür. İndirme, orijinal çözünürlükte sunucuda yeniden işlenir.</p>
          </div>
        </aside>
      </div>
      )}
      {error && <div className="studio-message studio-error" role="alert">{error}<button type="button" aria-label="Hata mesajını kapat" onClick={() => setError('')}><StudioIcon name="close" size={14} /></button></div>}
      {notice && <div className="studio-message studio-notice" role="status">{notice}<button type="button" aria-label="Bildirimi kapat" onClick={() => setNotice('')}><StudioIcon name="close" size={14} /></button></div>}
      <p className="studio-privacy-note"><StudioIcon name="check" size={14} /> Dosyalar geçici olarak tutulur ve bir saat içinde otomatik silinir. Bu araç ücretli AI servisi kullanmaz.</p>
    </section>
  )
}

export default Studio
