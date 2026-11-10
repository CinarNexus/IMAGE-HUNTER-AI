import { useEffect, useRef, useState } from 'react'
import { getPersonEligibilityReason } from '../shared/person-eligibility.js'
import Studio from './Studio.jsx'
import './App.css'

const HISTORY_KEY = 'image-hunter-history'
const SIGNATURE_INTRO_KEY = 'image-hunter-ai-intro-shown'
const SIGNATURE_INTRO_DURATION_MS = 3_800

function shouldShowSignatureIntro() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  try {
    return window.sessionStorage.getItem(SIGNATURE_INTRO_KEY) !== 'true'
  } catch {
    return true
  }
}

function Icon({ name, size = 18 }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    sparkle: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z" /><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1L19 14Z" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
    filter: <><path d="M4 7h16M7 12h10M10 17h4" /><circle cx="8" cy="7" r="2" /><circle cx="15" cy="12" r="2" /></>,
    external: <><path d="M14 3h7v7M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.6-2L20 12M4 12l2.9 5a7 7 0 0 0 11.6-2" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    wand: <><path d="m15 4 5 5M4 20 17 7M7 4v3M5.5 5.5h3M19 15v4M17 17h4" /><path d="m12 6 6 6" /></>,
    cut: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="m8.1 8.1 12 12M14 6l6-2M8.1 15.9 14 10" /></>,
    play: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 9 5 3-5 3V9Z" /></>,
    scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="11" r="3" /><path d="M7 20c.7-2.4 2.4-3.5 5-3.5s4.3 1.1 5 3.5" /></>,
    arrowDown: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></>,
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

function App() {
  const [showSignatureIntro, setShowSignatureIntro] = useState(shouldShowSignatureIntro)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(20)
  const [photos, setPhotos] = useState([])
  const [analysisJobId, setAnalysisJobId] = useState('')
  const [searchId, setSearchId] = useState('')
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchPage, setSearchPage] = useState(0)
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    } catch {
      return []
    }
  })
  const [health, setHealth] = useState({ searchConfigured: false, geminiConfigured: false })
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [detailPhoto, setDetailPhoto] = useState(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [activeView, setActiveView] = useState('search')
  const pollTimer = useRef(null)

  useEffect(() => {
    if (!showSignatureIntro) return undefined
    try {
      window.sessionStorage.setItem(SIGNATURE_INTRO_KEY, 'true')
    } catch {
      // The in-memory state still keeps the intro from replaying during rerenders.
    }
    const timer = window.setTimeout(() => setShowSignatureIntro(false), SIGNATURE_INTRO_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [showSignatureIntro])

  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) throw new Error('Sunucu durumu alınamadı')
        setHealth(await response.json())
      })
      .catch(() => setError('Sunucuya bağlanılamadı. Backend sunucusunun çalıştığını kontrol edin.'))

    return () => window.clearTimeout(pollTimer.current)
  }, [])

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)))
  }, [history])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const selectedPhotos = photos.filter((photo) => photo.selected)
  const currentDetailPhoto = photos.find((photo) => photo.id === detailPhoto?.id) || detailPhoto
  const analyzed = Boolean(analysisJobId)
  const selectablePhotos = photos
  const allPhotosSelected = selectablePhotos.length > 0
    && selectablePhotos.every((photo) => photo.selected)
  const visiblePhotos = photos.filter((photo) => {
    if (activeFilter === 'selected') return photo.selected
    if (activeFilter === 'best') return photo.autoSelected
    return true
  })

  async function searchImages(searchQuery = query, requestedCount = count) {
    const cleanQuery = searchQuery.trim()
    if (!cleanQuery) {
      setError('Aramak istediğiniz konuyu yazın.')
      return
    }
    if (cleanQuery.length < 2) {
      setError('Arama en az 2 karakter olmalı.')
      return
    }

    setQuery(cleanQuery)
    setLoading(true)
    setError('')
    setPhotos([])
    setAnalysisJobId('')
    setSearchId('')
    setSearchHasMore(false)
    setSearchPage(0)
    setActiveFilter('all')
    try {
      const params = new URLSearchParams({ query: cleanQuery, count: String(requestedCount) })
      let response = await fetch(`/api/search?${params}`)
      let data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Görseller aranırken bir hata oluştu.')
      let page = 0
      let items = data.photos
      if (!items.length && data.hasMore) {
        page = 1
        params.set('page', String(page))
        params.set('searchId', data.searchId)
        response = await fetch(`/api/search?${params}`)
        data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Ek görseller aranırken bir hata oluştu.')
        items = data.photos
      }
      items = items.map((photo) => ({ ...photo, selected: false }))
      setPhotos(items)
      setSearchId(data.searchId)
      setSearchHasMore(data.hasMore)
      setSearchPage(page)
      setHistory((previous) => [
        { query: cleanQuery, count: requestedCount, time: Date.now() },
        ...previous.filter((entry) => entry.query.toLowerCase() !== cleanQuery.toLowerCase()),
      ].slice(0, 8))
      if (items.length === 0) setNotice('Bu arama için kaynakta görsel bulunamadı.')
    } catch (searchError) {
      setError(searchError.message)
    } finally {
      setLoading(false)
    }
  }

  async function analyzeImages() {
    if (!health.geminiConfigured) {
      setError('Gerçek AI analizi için GEMINI_API_KEY anahtarını .env dosyasına ekleyip sunucuyu yeniden başlatın.')
      return
    }
    setAnalyzing(true)
    setAnalysisJobId('')
    setError('')
    setProgress({ completed: 0, prepared: 0, total: photos.length, stage: 'preparing' })
    try {
      let candidates = photos
      let page = searchPage
      let hasMore = searchHasMore
      let finalStatus
      const selectedIds = new Set(photos.filter((photo) => photo.selected).map((photo) => photo.id))

      while (true) {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            bestCount: count,
            photos: candidates.map(({ id, imageUrl, previewUrl, analysisUrl, sourceUrl, sourceName, license, licenseUrl, alt, photographer }) => ({
              id, imageUrl, previewUrl, analysisUrl, sourceUrl, sourceName, license, licenseUrl, alt, photographer,
            })),
          }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'AI analizi başlatılamadı.')

        while (true) {
          const statusResponse = await fetch(`/api/jobs/${data.jobId}`)
          const statusData = await statusResponse.json()
          if (!statusResponse.ok) throw new Error(statusData.error || 'Analiz durumu alınamadı.')
          setProgress({
            completed: statusData.completed,
            prepared: statusData.prepared,
            total: statusData.total,
            stage: statusData.stage,
          })
          if (statusData.status === 'completed') {
            finalStatus = statusData
            setAnalysisJobId(data.jobId)
            const analyzedPhotos = statusData.photos.map((photo) => ({
              ...photo,
              selected: Boolean(photo.autoSelected) || selectedIds.has(photo.id),
            }))
            for (const photo of analyzedPhotos) {
              if (photo.selected) selectedIds.add(photo.id)
            }
            candidates = analyzedPhotos
            setPhotos(analyzedPhotos)
            break
          }
          await new Promise((resolve) => {
            pollTimer.current = window.setTimeout(resolve, 850)
          })
        }

        if (finalStatus.autoSelected >= count || !hasMore || page >= 1) break

        page += 1
        setProgress({ completed: 0, prepared: 0, total: count, stage: 'searching' })
        const params = new URLSearchParams({ query, count: String(count), page: String(page), searchId })
        const nextResponse = await fetch(`/api/search?${params}`)
        const nextData = await nextResponse.json()
        if (!nextResponse.ok) throw new Error(nextData.error || 'Ek görseller aranırken bir hata oluştu.')
        const knownIds = new Set(candidates.map((photo) => photo.id))
        const additionalPhotos = nextData.photos
          .filter((photo) => !knownIds.has(photo.id))
          .map((photo) => ({ ...photo, selected: false }))
        hasMore = nextData.hasMore
        setSearchHasMore(hasMore)
        setSearchPage(page)
        if (!additionalPhotos.length) break
        candidates = [...candidates, ...additionalPhotos]
        setPhotos(candidates)
      }

      setActiveFilter('all')
      if (finalStatus.autoSelected < count) {
        setNotice(page > 0
          ? `${finalStatus.autoSelected}/${count} uygun fotoğraf bulundu; ek arama sayfası da tarandı.`
          : `${finalStatus.autoSelected}/${count} uygun fotoğraf bulundu; başka sonuç sayfası yok.`)
      } else if (finalStatus.failed > 0) {
        setNotice(`${finalStatus.failed} görsel Gemini analizine uygun değildi; diğer sonuçlar puanlandı.`)
      } else {
        setNotice(`${finalStatus.autoSelected} görsel AI tarafından seçildi.`)
      }
    } catch (analysisError) {
      setError(analysisError.message)
    } finally {
      setAnalyzing(false)
    }
  }

  function togglePhoto(id) {
    setPhotos((items) => items.map((photo) => (
      photo.id === id ? { ...photo, selected: !photo.selected } : photo
    )))
  }

  function toggleAll() {
    const shouldSelect = selectablePhotos.some((photo) => !photo.selected)
    setPhotos((items) => items.map((photo) => ({
      ...photo,
      selected: shouldSelect,
    })))
  }

  function selectBest() {
    if (!analyzed) {
      setError('Önce AI analizi yaparak görselleri puanlayın.')
      return
    }
    setPhotos((items) => items.map((photo) => ({ ...photo, selected: Boolean(photo.autoSelected) })))
    setActiveFilter('selected')
  }

  async function downloadZip() {
    if (!searchId || !selectedPhotos.length) {
      setError('ZIP indirmek için en az bir görsel seçin.')
      return
    }
    setDownloading(true)
    setError('')
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchId,
          photoIds: selectedPhotos.map(({ id }) => id),
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'ZIP hazırlanamadı.')
      }
      const file = await response.blob()
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = `image-hunter-${Date.now()}.zip`
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setNotice(`${selectedPhotos.length} seçili görsel için ZIP hazırlandı. Kaynak ve lisans bilgileri ZIP içindedir.`)
    } catch (downloadError) {
      setError(downloadError.message)
    } finally {
      setDownloading(false)
    }
  }

  function openHistorySearch(entry) {
    const historyCount = entry.count >= 100 ? 100 : 20
    setCount(historyCount)
    searchImages(entry.query, historyCount)
    setMobileNavOpen(false)
  }

  function navigateToTool(tool) {
    setMobileNavOpen(false)
    if (tool === 'studio') {
      setActiveView('studio')
      return
    }
    if (tool === 'search') {
      setActiveView('search')
      document.getElementById('search-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.querySelector('#image-query')?.focus({ preventScroll: true })
      return
    }
    setActiveView('search')
    if (!photos.length) {
      setNotice(tool === 'downloads'
        ? 'İndirme için önce fotoğraf bulup doğrulayın.'
        : 'Koleksiyon oluşturmak için önce fotoğraf bulun.')
      document.getElementById('search-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    document.getElementById('results-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (tool === 'collection') {
      setActiveFilter(selectedPhotos.length ? 'selected' : 'all')
      return
    }
    if (tool === 'downloads') {
      if (!selectedPhotos.length) setNotice('İndirmeden önce koleksiyonunuzdan fotoğraf seçin.')
      window.setTimeout(() => document.getElementById('download-selected')?.focus({ preventScroll: true }), 0)
    }
  }

  return (
    <>
    {showSignatureIntro && (
      <div className="cinematic-intro" role="presentation" aria-hidden="true">
        <div className="cinematic-intro-lockup">
          <svg className="cinematic-intro-mark" viewBox="0 0 112 112" xmlns="http://www.w3.org/2000/svg">
            <path className="intro-mark-stroke intro-frame" pathLength="1" d="M42 13H28a15 15 0 0 0-15 15v14m57-29h14a15 15 0 0 1 15 15v14M13 70v14a15 15 0 0 0 15 15h14m57-29v14a15 15 0 0 1-15 15H70" />
            <circle className="intro-mark-stroke intro-lens" pathLength="1" cx="56" cy="56" r="22" />
            <path className="intro-mark-stroke intro-focus" pathLength="1" d="m49 56 5 5 10-12M56 3v8m0 90v8M3 56h8m90 0h8" />
          </svg>
          <div className="cinematic-intro-wordmark">
            <span className="cinematic-intro-overline">CREATIVE INTELLIGENCE</span>
            <strong>IMAGE HUNTER</strong>
            <span className="cinematic-intro-edition">ARTIFICIAL INTELLIGENCE</span>
          </div>
        </div>
      </div>
    )}
    <div className="app-shell" inert={showSignatureIntro}>
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#" aria-label="Image Hunter ana sayfa" onClick={(event) => {
          event.preventDefault()
          setPhotos([])
          setAnalysisJobId('')
          setSearchId('')
          setError('')
          setMobileNavOpen(false)
        }}>
          <span className="brand-mark"><Icon name="scan" size={24} /></span>
          <span className="brand-name"><strong>IMAGE HUNTER</strong><small>CREATIVE INTELLIGENCE</small></span>
        </a>

        <div className="sidebar-section">
          <div className="sidebar-label">ÇALIŞMA ALANI</div>
          <button className={`nav-item ${activeView === 'search' ? 'nav-active' : ''}`} type="button" onClick={() => navigateToTool('search')}>
            <span className="nav-icon"><Icon name="search" /></span><span>AI Görsel Bulucu</span>
            {activeView === 'search' && <span className="nav-current">AKTİF</span>}
          </button>
          <button className={`nav-item ${activeView === 'studio' ? 'nav-active' : ''}`} type="button" onClick={() => navigateToTool('studio')}>
            <span className="nav-icon"><Icon name="wand" /></span><span>AI Studio</span>
            {activeView === 'studio' && <span className="nav-current">AKTİF</span>}
          </button>
          <button className="nav-item" type="button" onClick={() => navigateToTool('collection')}>
            <span className="nav-icon"><Icon name="layers" /></span><span>Görsel Koleksiyonlarım</span>
            {selectedPhotos.length > 0 && <span className="nav-count">{selectedPhotos.length}</span>}
          </button>
          <button className="nav-item" type="button" onClick={() => navigateToTool('downloads')}>
            <span className="nav-icon"><Icon name="download" /></span><span>İndirmelerim</span>
          </button>
        </div>

        <div className="sidebar-history">
          <div className="sidebar-label">SON ARAMALAR</div>
          <div className="recent-list">
            {history.length === 0 && <p className="empty-history">Aramalarınız burada görünecek.</p>}
            {history.slice(0, 5).map((entry) => (
              <button type="button" className="recent-item" key={`${entry.query}-${entry.time}`} onClick={() => openHistorySearch(entry)}>
                <span className="recent-dot" />
                <span className="recent-query">{entry.query}</span>
                <span className="recent-count">{entry.count}</span>
              </button>
            ))}
          </div>
          {history.length > 0 && <button className="history-link" type="button" onClick={() => {
            document.getElementById('history-panel')?.scrollIntoView({ behavior: 'smooth' })
            setMobileNavOpen(false)
          }}><Icon name="clock" size={14} /> Tüm geçmiş <Icon name="arrow" size={13} /></button>}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon"><Icon name="shield" size={17} /></span>
            <div><strong>Kaynağıyla birlikte</strong><p>Her görsel orijinal kaynağına bağlı.</p></div>
          </div>
          <div className="sidebar-footer"><span className="footer-orb" /> SYSTEM STATUS <span>v1.0</span></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="nav-backdrop" aria-label="Menüyü kapat" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button type="button" className="mobile-menu" aria-label="Menüyü aç" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
          <div className="breadcrumb"><span>CREATIVE WORKSPACE</span><b>/</b><strong>{activeView === 'studio' ? 'AI Studio' : 'Görsel Avcısı'}</strong></div>
          <div className="service-status">
            <span className={`status-pill ${health.searchConfigured ? 'status-ready' : ''}`} title={health.searchConfigured ? 'SerpApi bağlantısı hazır' : 'SerpApi anahtarı gerekli'}>
              <i /> SERPAPI {health.searchConfigured ? 'BAĞLI' : 'BEKLENİYOR'}
            </span>
            <span className={`status-pill ${health.geminiConfigured ? 'status-ready' : ''}`} title={health.geminiConfigured ? 'Gemini bağlantısı hazır' : 'Gemini API anahtarı gerekli'}>
              <i /> GEMINI {health.geminiConfigured ? 'BAĞLI' : 'BEKLENİYOR'}
            </span>
          </div>
        </header>

        <div className="content">
          {activeView === 'studio' ? <Studio /> : <>
          <section className="hero-section" id="search-panel">
            <div className="hero-top">
              <div className="hero-copy-block">
                <div className="eyebrow"><span className="eyebrow-dot" /> AI DESTEKLİ GÖRSEL KEŞFİ</div>
                <h1>Aradığın kare,<br /><span>doğru ışıkta.</span></h1>
                <p className="hero-copy">Binlerce görsel arasından doğru kişiyi bul. Yapay zekâ ile doğrula, estetik puanla ve en iyilerini tek yerde topla.</p>
                <div className="hero-trust"><span><Icon name="check" size={13} /> Tek kişi doğrulama</span><span><Icon name="check" size={13} /> AI kalite puanı</span><span><Icon name="check" size={13} /> Kaynak bilgisi korunur</span></div>
              </div>
              <div className="hero-visual" aria-hidden="true">
                <div className="hero-glow" />
                <div className="hero-orbit orbit-a" /><div className="hero-orbit orbit-b" />
                <div className="hero-scan-card">
                  <div className="scan-card-head"><span className="scan-indicator" /> SUBJECT VERIFIED <Icon name="scan" size={16} /></div>
                  <div className="scan-portrait"><div className="portrait-halo" /><div className="portrait-head" /><div className="portrait-body" /><span className="scan-corner corner-tl" /><span className="scan-corner corner-tr" /><span className="scan-corner corner-bl" /><span className="scan-corner corner-br" /></div>
                  <div className="scan-card-foot"><span>ESTHETIC SCORE</span><strong>94<span>/100</span></strong></div>
                </div>
                <div className="hero-float-tag"><Icon name="sparkle" size={14} /> AI RANKING</div>
              </div>
            </div>

            <form className="search-form" onSubmit={(event) => {
              event.preventDefault()
              searchImages()
            }}>
              <span className="search-form-icon"><Icon name="search" size={21} /></span>
              <input
                id="image-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Bir kişi, sanatçı veya ünlü ara..."
                aria-label="Görsel arama"
                maxLength={120}
              />
              {query && <button className="clear-search" type="button" aria-label="Aramayı temizle" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}
              <button className="search-button" type="submit" disabled={loading || analyzing}>
                {loading ? <span className="button-spinner" /> : <><span>Görselleri keşfet</span><Icon name="arrow" size={16} /></>}
              </button>
            </form>

            <div className="search-options">
              <span className="result-count-label">SONUÇ HEDEFİ</span>
              <div className="count-switch" role="group" aria-label="Otomatik seçilecek fotoğraf sayısı">
                {[20, 100].map((target) => <button key={target} type="button" className={count === target ? 'count-active' : ''} onClick={() => setCount(target)} disabled={loading || analyzing || photos.length > 0}>{target}<span> fotoğraf</span></button>)}
              </div>
              <span className="search-powered"><span className="powered-dot" /> İlk arama hedef kadar aday getirir; ek arama yalnızca gerekirse.</span>
            </div>

            <details className="aesthetic-criteria">
              <summary><Icon name="sparkle" size={15} /> Puanlama ve doğrulama ölçütleri <span>Detayları gör</span></summary>
              <div className="criteria-content">
                <p>Gemini öncesinde URL, erişim, çözünürlük ve benzer kopyalar kontrol edilir. Tam bir kişi, doğrulanmış kimlik ve görünür/tanınabilir yüz zorunludur. Yalnızca filtreyi geçen farklı fotoğraflar puanlanır:</p>
                <ul>
                  <li><span>Arama alaka düzeyi</span><b>%15</b></li><li><span>Netlik</span><b>%15</b></li>
                  <li><span>Çözünürlük</span><b>%10</b></li><li><span>Işık</span><b>%15</b></li>
                  <li><span>Renk uyumu</span><b>%10</b></li><li><span>Kompozisyon</span><b>%15</b></li>
                  <li><span>Kadraj / çerçeveleme</span><b>%10</b></li><li><span>Edit uygunluğu</span><b>%10</b></li>
                </ul>
                <p className="criteria-gate">Grup fotoğrafları ve eşleşmeyen kişiler seçime eklenmez. Yeterli fotoğraf yoksa bulunan gerçek sayı gösterilir. Önbellek ve kopya kontrolü gereksiz Gemini çağrılarını azaltır.</p>
              </div>
            </details>
          </section>

          {!photos.length && !loading && <section className="value-section" aria-label="Image Hunter özellikleri">
            <div className="value-heading"><div><span className="section-kicker">DAHA İYİ FOTOĞRAFLAR, DAHA AZ UĞRAŞ</span><h2>Aramadan seçime, <span>akıllı iş akışı.</span></h2></div><p>Her görseli kaynağıyla bul, doğru kişiyi doğrula ve kaliteye göre sırala.</p></div>
            <div className="value-grid">
              <article className="value-card"><span className="value-icon icon-blue"><Icon name="search" size={19} /></span><span className="value-step">01 / DISCOVER</span><h3>Kaynağından keşfet</h3><p>Google Görseller sonuçlarını doğrudan kaynakları ve çözünürlük bilgileriyle incele.</p><span className="value-link">SerpApi ile arama <Icon name="arrow" size={13} /></span></article>
              <article className="value-card"><span className="value-icon icon-cyan"><Icon name="scan" size={19} /></span><span className="value-step">02 / VERIFY</span><h3>Tek kişiyi doğrula</h3><p>Grup fotoğraflarını ele. Aradığın kişinin yüzü görünür ve tanınabilir olsun.</p><span className="value-link">Gemini kişi analizi <Icon name="arrow" size={13} /></span></article>
              <article className="value-card"><span className="value-icon icon-violet"><Icon name="sparkle" size={19} /></span><span className="value-step">03 / RANK</span><h3>Kaliteye göre sırala</h3><p>Işık, netlik, renk ve kompozisyon puanıyla en iyi fotoğraflarını seç.</p><span className="value-link">AI estetik puanı <Icon name="arrow" size={13} /></span></article>
            </div>
          </section>}

          {error && <div className="error-banner" role="alert"><span>!</span><p>{error}</p><button type="button" aria-label="Uyarıyı kapat" onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}

          {analyzing && (
            <section className="analysis-progress" aria-live="polite">
              <div className="progress-top"><div className="progress-title"><span className="progress-sparkle"><Icon name="sparkle" size={17} /></span><strong>{progress.stage === 'preparing' ? 'Görseller filtreleniyor' : progress.stage === 'searching' ? 'Ek görseller aranıyor' : 'Gemini görselleri puanlıyor'}</strong></div><span>{progress.stage === 'searching' ? '2. sayfa' : `${progress.stage === 'preparing' ? progress.prepared : progress.completed} / ${progress.total}`}</span></div>
              <div className="progress-track"><div style={{ width: `${progress.total ? ((progress.stage === 'preparing' ? progress.prepared : progress.stage === 'searching' ? 0 : progress.completed) / progress.total) * 100 : 0}%` }} /></div>
              <p>{progress.stage === 'preparing'
                ? 'URL, erişim, çözünürlük ve benzer kopyalar kontrol ediliyor.'
                : progress.stage === 'searching'
                  ? 'Yeterli sayıda uygun sonuç bulunamadı; ek Google Görseller sayfası aranıyor.'
                  : `Yalnızca filtreyi geçen farklı görseller için Gemini analizi çalışıyor; ${progress.prepared} görsel tarandı.`}</p>
            </section>
          )}

          {(loading || photos.length > 0) && (
            <section className="results-section" id="results-panel" aria-live="polite">
              <div className="results-heading">
                <div>
                  <div className="section-kicker">GÖRSEL KOLEKSİYONU</div>
                  <h2>{loading ? 'En iyi kareleri arıyoruz…' : <>Sonuçlar <span>· {photos.length} fotoğraf</span></>}</h2>
                  <p className="results-caption">{analyzed
                    ? `${photos.filter((photo) => photo.autoSelected).length} / ${count} uygun fotoğraf bulundu · yalnızca doğrulanan kişiler`
                    : 'Fotoğrafları AI ile doğrula ve en yüksek kalite puanlarını bul.'}</p>
                </div>
                {photos.length > 0 && <div className="results-controls">
                  <button type="button" className="text-button" onClick={toggleAll}>
                    <span className={`checkbox-mini ${allPhotosSelected ? 'checked' : ''}`}>{allPhotosSelected && <Icon name="check" size={12} />}</span>
                    {selectedPhotos.length > 0 && selectedPhotos.length === photos.length ? 'Seçimi kaldır' : 'Tümünü seç'}
                  </button>
                  <button type="button" className="outline-button" disabled={analyzing || !health.geminiConfigured} onClick={analyzed ? selectBest : analyzeImages} title={!health.geminiConfigured ? 'Gemini API anahtarı gerekli' : ''}>
                    <Icon name="sparkle" size={16} /> {analyzed ? 'En iyileri seç' : 'Fotoğrafları analiz et'}
                  </button>
                  <button type="button" id="download-selected" className="primary-button" disabled={!selectedPhotos.length || downloading} onClick={downloadZip}>
                    {downloading ? <span className="button-spinner" /> : <Icon name="download" size={16} />}
                    ZIP indir <span className="button-count">{selectedPhotos.length}</span>
                  </button>
                </div>}
              </div>

              {analyzed && <div className="filter-row">
                <div className="filter-tabs">
                  {[['all', `Tümü ${photos.length}`], ['best', `AI seçimi ${photos.filter((photo) => photo.autoSelected).length}`], ['selected', `Seçilen ${selectedPhotos.length}`]].map(([key, label]) => (
                    <button type="button" key={key} className={activeFilter === key ? 'filter-active' : ''} onClick={() => setActiveFilter(key)}>{label}</button>
                  ))}
                </div>
                <span className="sort-label"><Icon name="filter" size={14} /> {analyzed ? 'AI puanına göre' : 'Kaynak sırası'}</span>
              </div>}

              <div className="photo-grid">
                {loading && Array.from({ length: 8 }, (_, index) => <div className="photo-skeleton" key={index}><div /><span /></div>)}
                {!loading && visiblePhotos.map((photo, index) => <article className={`photo-card ${photo.selected ? 'photo-selected' : ''}`} key={photo.id}>
                  <div className="photo-frame" onClick={() => setDetailPhoto(photo)} onKeyDown={(event) => event.key === 'Enter' && setDetailPhoto(photo)} role="button" tabIndex={0} aria-label={`${photo.alt || 'Görsel'} ayrıntılarını aç`}>
                    <img src={photo.previewUrl || photo.imageUrl} alt={photo.alt || 'Google Görseller sonucu'} loading={index < 8 ? 'eager' : 'lazy'} />
                    <div className="photo-overlay" />
                    {photo.score !== undefined && <span className={`score-badge ${photo.score >= 80 ? 'score-high' : photo.score >= 60 ? 'score-mid' : 'score-low'}`}><Icon name="sparkle" size={13} /> {photo.score}<small>/100</small></span>}
                    {photo.duplicateOf && <span className="duplicate-badge">BENZER</span>}
                    <button type="button" className={`photo-check ${photo.selected ? 'photo-check-active' : ''}`} aria-label={photo.selected ? 'Seçimi kaldır' : 'Görseli seç'} onClick={(event) => {
                      event.stopPropagation()
                      togglePhoto(photo.id)
                    }}>{photo.selected ? <Icon name="check" size={17} /> : null}</button>
                    <span className="photo-open"><Icon name="external" size={15} /></span>
                  </div>
                  <div className="photo-meta">
                    <p className="photo-title" title={photo.alt}>{photo.alt || 'Başlıksız görsel'}</p>
                    <div className="photo-byline"><span>{photo.width && photo.height ? `${photo.width} × ${photo.height}` : 'Google Görseller'}</span><span className="meta-dot" /><span>{photo.sourceName || photo.photographer}</span></div>
                    {photo.score !== undefined && <div className="card-analysis">
                        <div className="quality-bar"><span style={{ width: `${photo.score}%` }} /></div>
                        <span className="quality-label">Estetik <b>{photo.score}/100</b></span>
                        {photo.subjectMatch && <span className={`subject-chip subject-${photo.subjectMatch}`}>
                          {photo.subjectMatch === 'match' ? 'Eşleşti' : photo.subjectMatch === 'mismatch' ? 'Eşleşmedi' : 'Belirsiz'}
                        </span>}
                    </div>}
                    <p className={`person-filter-status ${!analyzed ? 'eligibility-pending' : photo.aiVerified ? 'eligibility-accepted' : 'eligibility-rejected'}`}>
                      {!analyzed
                        ? 'AI doğrulaması yapılmadı; indirilebilir, ancak doğrulanmış değildir.'
                        : photo.aiVerified
                          ? `AI doğrulaması geçti · ${photo.aiVerificationReason}`
                          : `AI doğrulaması geçmedi · ${photo.aiVerificationReason || getPersonEligibilityReason(photo)} İndirilebilir, ancak doğrulanmış değildir.`}
                    </p>
                    {photo.autoSelected && <p className="selected-reason"><Icon name="check" size={12} /> {photo.reason}</p>}
                  </div>
                </article>)}
              </div>
              {!loading && photos.length > 0 && visiblePhotos.length === 0 && <div className="no-results"><Icon name="image" size={28} /><p>Bu filtrede gösterilecek görsel yok.</p></div>}
            </section>
          )}

          {!loading && photos.length === 0 && !error && (
            <section className="empty-state">
              <span className="empty-icon"><Icon name="search" size={22} /></span>
              <span className="empty-label">İLK ADIM SENDE</span>
              <h2>Bir isimle başla.</h2>
              <p>Aradığın kişiyi yaz. Görselleri bulalım, kimliği doğrulayalım ve en iyi kareleri senin için sıralayalım.</p>
            </section>
          )}

          <section className={`history-section ${history.length === 0 ? 'history-empty' : ''}`} id="history-panel">
            <div><div className="section-kicker">SON ARAMALAR</div><h2>Geçmiş</h2></div>
            {history.length ? <div className="history-chips">{history.slice(0, 4).map((entry) => (
              <button key={`${entry.query}-${entry.time}`} type="button" onClick={() => openHistorySearch(entry)}><Icon name="clock" size={14} />{entry.query}<span>{entry.count}</span><Icon name="refresh" size={13} /></button>
            ))}</div> : <p>Aramalarınız burada görünecek.</p>}
          </section>
          <footer className="main-footer"><span>© 2026 IMAGE HUNTER AI</span><span>Görseller Google Görseller ile bulunur. Kullanım ve lisans koşullarını kaynak sayfasında kontrol edin.</span></footer>
          </>}
        </div>
      </main>

      {currentDetailPhoto && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailPhoto(null)}>
        <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
          <button className="modal-close" type="button" aria-label="Kapat" onClick={() => setDetailPhoto(null)}><Icon name="close" /></button>
          <div className="modal-image"><img src={currentDetailPhoto.imageUrl} alt={currentDetailPhoto.alt || 'Görsel önizlemesi'} /></div>
          <div className="modal-content">
            <span className="section-kicker">GÖRSEL AYRINTILARI</span>
            <h2 id="detail-title">{currentDetailPhoto.alt || 'Başlıksız görsel'}</h2>
            {currentDetailPhoto.score !== undefined ? <div className="modal-score"><Icon name="sparkle" size={16} /> AI Aesthetic Ranking <strong>{currentDetailPhoto.score}/100</strong></div> : <p className="modal-ai-note">{analyzed ? 'AI kişi doğrulama veya puanlama kapısı geçilemedi.' : 'AI doğrulaması yapılmadı; görsel seçilip indirilebilir ancak doğrulanmış değildir.'}</p>}
            <dl className="detail-list">
              <div><dt>Çözünürlük</dt><dd>{currentDetailPhoto.width && currentDetailPhoto.height ? `${currentDetailPhoto.width} × ${currentDetailPhoto.height} px` : 'Belirtilmemiş'}</dd></div>
              <div><dt>Fotoğrafçı</dt><dd>{currentDetailPhoto.photographer}</dd></div>
              <div><dt>AI doğrulaması</dt><dd>{analyzed
                ? currentDetailPhoto.aiVerified
                  ? `Geçti · ${currentDetailPhoto.aiVerificationReason}`
                  : `Geçmedi · ${currentDetailPhoto.aiVerificationReason || getPersonEligibilityReason(currentDetailPhoto)} İndirilebilir, ancak doğrulanmış değildir.`
                : 'Yapılmadı; görsel indirilebilir fakat doğrulanmış değildir.'}</dd></div>
              {currentDetailPhoto.personCount !== undefined && <div><dt>Fotoğraftaki insan sayısı</dt><dd>{currentDetailPhoto.personCount} · güven {currentDetailPhoto.personCountConfidence}/100</dd></div>}
              {currentDetailPhoto.personCount !== undefined && <div><dt>Yüz görünürlüğü / tanınabilirlik</dt><dd>{currentDetailPhoto.faceVisible ? 'Görünür' : 'Yeterince görünür değil'} · {currentDetailPhoto.faceRecognizable ? 'Tanınabilir' : 'Tanınabilir değil'}</dd></div>}
              {currentDetailPhoto.personCount !== undefined && <div><dt>Aranan kişi</dt><dd>{currentDetailPhoto.subjectMatch === 'match' ? 'Eşleşti' : currentDetailPhoto.subjectMatch === 'mismatch' ? 'Eşleşmedi' : 'Belirsiz'} · güven {currentDetailPhoto.subjectConfidence}/100</dd></div>}
              {currentDetailPhoto.score !== undefined && <div><dt>Alaka</dt><dd>{currentDetailPhoto.relevance}/100</dd></div>}
              {currentDetailPhoto.score !== undefined && <div><dt>Netlik</dt><dd>{currentDetailPhoto.clarity}/100</dd></div>}
              {currentDetailPhoto.score !== undefined && <div><dt>Çözünürlük</dt><dd>{currentDetailPhoto.resolution}/100</dd></div>}
              {currentDetailPhoto.score !== undefined && <div><dt>Işık · Renk</dt><dd>{currentDetailPhoto.lighting}/100 · {currentDetailPhoto.colors}/100</dd></div>}
              {currentDetailPhoto.score !== undefined && <div><dt>Kompozisyon · Edit uygunluğu</dt><dd>{currentDetailPhoto.composition}/100 · {currentDetailPhoto.editSuitability}/100</dd></div>}
              {currentDetailPhoto.score !== undefined && <div><dt>Kadraj / çerçeveleme</dt><dd>{currentDetailPhoto.framing}/100</dd></div>}
              {currentDetailPhoto.reason && <div><dt>AI değerlendirmesi</dt><dd>{currentDetailPhoto.reason}</dd></div>}
              {currentDetailPhoto.duplicateOf && <div><dt>Benzer görsel</dt><dd>Tekrar eden içerik olarak belirlendi.</dd></div>}
              <div><dt>Lisans</dt><dd>{currentDetailPhoto.license || 'Belirtilmemiş; kaynak sayfasında kontrol edin'}</dd></div>
            </dl>
            <p className="license-disclaimer">İndirmeden veya kullanmadan önce kaynağın güncel lisans koşullarını kontrol edin.</p>
            <div className="modal-actions">
              <a className="source-link" href={currentDetailPhoto.sourceUrl} target="_blank" rel="noreferrer">{currentDetailPhoto.sourceName || 'Görsel kaynağını'} aç <Icon name="external" size={15} /></a>
              <button type="button" className={`primary-button ${currentDetailPhoto.selected ? 'modal-selected' : ''}`} onClick={() => togglePhoto(currentDetailPhoto.id)}>{currentDetailPhoto.selected ? <Icon name="check" size={15} /> : <Icon name="image" size={15} />}{currentDetailPhoto.selected ? 'Seçildi' : 'Seç'}</button>
            </div>
          </div>
        </section>
      </div>}

      {notice && <div className="toast" role="status"><span><Icon name="check" size={15} /></span>{notice}<button type="button" aria-label="Bildirimi kapat" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
    </div>
    </>
  )
}

export default App
