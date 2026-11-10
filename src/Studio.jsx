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
const TOOL_OPTIONS = {
  'background-removal': { tolerance: 42, softness: 16 },
  'image-enhancement': { scale: 2, sharpness: 35 },
  sharpening: { amount: 45, sigma: 1.2 },
  'object-removal': { mask: '' },
  'background-replacement': { backgroundColor: '#17243a', tolerance: 42, softness: 16 },
  'smart-crop': { ratio: '1:1', width: 1200 },
  thumbnail: { width: 1280, height: 720, text: '', backgroundColor: '#17243a', format: 'png' },
  'glow-effects': { color: '#1677ff', intensity: 30, blur: 20 },
}
const TOOLS = [
  { id: 'background-removal', label: 'Arka plan kaldırma', description: 'Kenar renginden anahtarlama; düz arka planlarda en iyi sonucu verir.' },
  { id: 'image-enhancement', label: 'Kalite artırma', description: 'AI değildir: Lanczos büyütme ve isteğe bağlı keskinleştirme.' },
  { id: 'sharpening', label: 'Fotoğraf netleştirme', description: 'Klasik Sharp keskinleştirme filtresi.' },
  { id: 'object-removal', label: 'Nesne silme', description: 'AI inpainting değildir; maskeli alanı komşu piksellerle doldurur.' },
  { id: 'background-replacement', label: 'Arka plan değiştirme', description: 'Kenar rengi anahtarlama ve düz renk arka plan.' },
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

function Studio() {
  const [upload, setUpload] = useState(null)
  const [adjustments, setAdjustments] = useState(EMPTY_ADJUSTMENTS)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [format, setFormat] = useState('png')
  const [originalOnly, setOriginalOnly] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeTool, setActiveTool] = useState('color-light-correction')
  const [toolOptions, setToolOptions] = useState(TOOL_OPTIONS['background-removal'])
  const [batchUploads, setBatchUploads] = useState([])
  const [batchExporting, setBatchExporting] = useState(false)
  const inputRef = useRef(null)
  const maskInputRef = useRef(null)
  const batchInputRef = useRef(null)
  const previewRequestRef = useRef(null)
  const previewUrlRef = useRef('')
  const uploadRef = useRef(null)
  const batchUploadsRef = useRef([])

  useEffect(() => () => {
    previewRequestRef.current?.abort()
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    if (uploadRef.current?.id) {
      fetch(`/api/studio/uploads/${uploadRef.current.id}`, { method: 'DELETE' })
        .catch((cleanupError) => console.error('Studio upload cleanup failed:', cleanupError))
    }
    for (const batchUpload of batchUploadsRef.current) {
      fetch(`/api/studio/uploads/${batchUpload.id}`, { method: 'DELETE' })
        .catch((cleanupError) => console.error('Studio batch upload cleanup failed:', cleanupError))
    }
  }, [])

  useEffect(() => {
    if (!upload) return undefined
    const controller = new AbortController()
    previewRequestRef.current?.abort()
    previewRequestRef.current = controller
    if (['batch-editing', 'image-to-video'].includes(activeTool)) {
      return undefined
    }
    const timer = window.setTimeout(async () => {
      try {
        const options = activeTool === 'color-light-correction'
          ? { adjustments, format }
          : toolOptions
        const response = await fetch(`/api/studio/uploads/${upload.id}/tools/${activeTool}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ options }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Önizleme oluşturulamadı.')
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
        if (previewError.name !== 'AbortError') setError(describeError(previewError.message))
      } finally {
        if (!controller.signal.aborted) setPreviewing(false)
      }
    }, 240)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [upload, adjustments, activeTool, toolOptions, format])

  async function removeUpload(id) {
    const response = await fetch(`/api/studio/uploads/${id}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw new Error('Geçici görsel silinemedi; bir saat içinde otomatik temizlenecek.')
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
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Görsel yüklenemedi.')
      const previousUpload = uploadRef.current
      uploadRef.current = data.upload
      setUpload({ ...data.upload, name: file.name })
      setAdjustments({ ...EMPTY_ADJUSTMENTS })
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

  async function loadMask(file) {
    if (!file) return
    if (file.type !== 'image/png' || file.size > 1_000_000) {
      setError('Nesne maskesi en fazla 1 MB boyutunda PNG olmalıdır.')
      return
    }
    const mask = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('Maske dosyası okunamadı.'))
      reader.readAsDataURL(file)
    })
    updateToolOptions({ mask })
    setNotice('Maske yüklendi. Beyaz alanlar komşu piksellerle doldurulur; bu işlem AI inpainting değildir.')
    if (maskInputRef.current) maskInputRef.current.value = ''
  }

  function selectTool(toolId) {
    setActiveTool(toolId)
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreviewUrl('')
    setOriginalOnly(false)
    setError('')
    setToolOptions(TOOL_OPTIONS[toolId] || {})
    setPreviewing(Boolean(upload && !['batch-editing', 'image-to-video'].includes(toolId)))
  }

  function updateToolOptions(nextOptions) {
    setPreviewing(true)
    setError('')
    setToolOptions((current) => ({ ...current, ...nextOptions }))
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
        <div className="studio-engine"><StudioIcon name="sparkle" size={16} /><span>{activeTool === 'image-to-video' ? 'BROWSER RECORDER' : 'SHARP ENGINE'}</span><i /> Ücretsiz</div>
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
                  <figcaption><span>ORİJİNAL</span><span>{upload.width} × {upload.height}</span></figcaption>
                  <div className="studio-image-wrap"><img src={upload.previewUrl} alt="Orijinal fotoğraf" /></div>
                </figure>
                <figure>
                  <figcaption><span>{originalOnly ? 'ORİJİNALE DÖNÜLDÜ' : 'DÜZENLENMİŞ'}</span><span>{upload.width} × {upload.height}</span></figcaption>
                  <div className="studio-image-wrap">
                    <img src={originalOnly ? upload.previewUrl : previewUrl || upload.previewUrl} alt={originalOnly ? 'Orijinal fotoğraf' : `${TOOLS.find((tool) => tool.id === activeTool)?.label} sonucu`} />
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
              <p>Silmek istediğiniz bölgeyi beyaz, korunacak alanı siyah gösteren bir PNG maske seçin.</p>
              <input ref={maskInputRef} type="file" accept="image/png" onChange={(event) => loadMask(event.target.files[0]).catch((maskError) => setError(maskError.message))} />
              <span>{toolOptions.mask ? 'Maske hazır' : 'Maske gerekli'}</span>
            </div>
          )}
          {activeTool === 'background-replacement' && (
            <div className="studio-tool-settings">
              <label>Yeni arka plan rengi <input type="color" value={toolOptions.backgroundColor ?? '#17243a'} onChange={(event) => updateToolOptions({ backgroundColor: event.target.value })} /></label>
              <label>Tolerans <input type="range" min="5" max="120" value={toolOptions.tolerance ?? 42} onChange={(event) => updateToolOptions({ tolerance: Number(event.target.value) })} /></label>
              <label>Kenar yumuşaklığı <input type="range" min="0" max="60" value={toolOptions.softness ?? 16} onChange={(event) => updateToolOptions({ softness: Number(event.target.value) })} /></label>
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
            <button className="studio-export-button" type="button" onClick={exportImage} disabled={!upload || !previewUrl || originalOnly || previewing || uploading || exporting || activeTool === 'image-to-video'}>
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
