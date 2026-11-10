import { useEffect, useRef, useState } from 'react'
import './App.css'

const HISTORY_KEY = 'image-hunter-history'

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
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(20)
  const [photos, setPhotos] = useState([])
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
  const pollTimer = useRef(null)

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
  const analyzed = photos.some((photo) => typeof photo.score === 'number')
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
        response = await fetch(`/api/search?${params}`)
        data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Ek görseller aranırken bir hata oluştu.')
        items = data.photos
      }
      items = items.map((photo) => ({ ...photo, selected: false }))
      setPhotos(items)
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
    setError('')
    setProgress({ completed: 0, prepared: 0, total: photos.length, stage: 'preparing' })
    try {
      let candidates = photos
      let page = searchPage
      let hasMore = searchHasMore
      let finalStatus

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
            setPhotos(statusData.photos)
            break
          }
          await new Promise((resolve) => {
            pollTimer.current = window.setTimeout(resolve, 850)
          })
        }

        if (finalStatus.autoSelected >= count || !hasMore || page >= 1) break

        page += 1
        setProgress({ completed: 0, prepared: 0, total: count, stage: 'searching' })
        const params = new URLSearchParams({ query, count: String(count), page: String(page) })
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
    const shouldSelect = selectedPhotos.length !== photos.length
    setPhotos((items) => items.map((photo) => ({ ...photo, selected: shouldSelect })))
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
    if (!selectedPhotos.length) {
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
          photos: selectedPhotos.map(({ id, imageUrl, sourceUrl, sourceName, alt, photographer }) => ({
            id, imageUrl, sourceUrl, sourceName, alt, photographer,
          })),
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

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#" aria-label="Image Hunter ana sayfa" onClick={(event) => {
          event.preventDefault()
          setPhotos([])
          setError('')
          setMobileNavOpen(false)
        }}>
          <span className="brand-mark"><Icon name="image" size={22} /></span>
          <span className="brand-name">IMAGE<span>HUNTER</span><small>AI STUDIO</small></span>
        </a>

        <div className="sidebar-label">ÇALIŞMA ALANI</div>
        <button className="nav-item nav-active" type="button" onClick={() => setMobileNavOpen(false)}>
          <Icon name="search" /><span>Görsel keşfet</span>
        </button>
        <button className="nav-item" type="button" onClick={() => {
          document.getElementById('history-panel')?.scrollIntoView({ behavior: 'smooth' })
          setMobileNavOpen(false)
        }}>
          <Icon name="clock" /><span>Arama geçmişi</span>
          {history.length > 0 && <span className="nav-count">{history.length}</span>}
        </button>

        <div className="sidebar-divider" />
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

        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="note-icon"><Icon name="shield" size={17} /></span>
          <div><strong>Kaynakları koruyoruz</strong><p>Her görsel orijinal kaynağına bağlıdır.</p></div>
        </div>
        <div className="sidebar-footer">IMAGE HUNTER AI <span>v1.0</span></div>
      </aside>

      {mobileNavOpen && <button className="nav-backdrop" aria-label="Menüyü kapat" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button type="button" className="mobile-menu" aria-label="Menüyü aç" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
          <div className="breadcrumb"><span>Image Hunter</span><b>/</b><strong>Görsel keşfet</strong></div>
          <div className="service-status">
            <span className={`status-pill ${health.searchConfigured ? 'status-ready' : ''}`} title={health.searchConfigured ? 'SerpApi bağlantısı hazır' : 'SerpApi anahtarı gerekli'}>
              <i /> GOOGLE {health.searchConfigured ? 'BAĞLI' : 'ANAHTAR GEREKLİ'}
            </span>
            <span className={`status-pill ${health.geminiConfigured ? 'status-ready' : ''}`} title={health.geminiConfigured ? 'Gemini bağlantısı hazır' : 'Gemini API anahtarı gerekli'}>
              <i /> GEMINI {health.geminiConfigured ? 'BAĞLI' : 'ANAHTAR GEREKLİ'}
            </span>
          </div>
        </header>

        <div className="content">
          <section className="hero-section">
            <div className="eyebrow"><span className="eyebrow-line" /> YARATICI İŞ AKIŞINIZ İÇİN <span className="eyebrow-line" /></div>
            <h1>Aradığını bul.<br /><span>En iyisini seç.</span></h1>
            <p className="hero-copy">Gerçek görselleri keşfet, Gemini ile analiz et ve projen için en doğru kareleri saniyeler içinde bul.</p>

            <form className="search-form" onSubmit={(event) => {
              event.preventDefault()
              searchImages()
            }}>
              <Icon name="search" size={21} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Örn. gün batımında Tokyo, Cristiano Ronaldo..."
                aria-label="Görsel arama"
                maxLength={120}
              />
              {query && <button className="clear-search" type="button" aria-label="Aramayı temizle" onClick={() => setQuery('')}><Icon name="close" size={16} /></button>}
              <button className="search-button" type="submit" disabled={loading || analyzing}>
                {loading ? <span className="button-spinner" /> : <><span>Görselleri bul</span><Icon name="arrow" size={16} /></>}
              </button>
            </form>

            <div className="search-options">
              <label className="select-control"><span>HEDEF</span>
                <select value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={loading || analyzing || photos.length > 0}>
                  <option value="20">En iyi 20</option><option value="100">En iyi 100</option>
                </select>
              </label>
              <span className="search-powered">İlk adaylar: seçilen hedef kadar <b>·</b> Ek arama yalnızca gerekirse</span>
            </div>
            <details className="aesthetic-criteria">
              <summary><Icon name="sparkle" size={14} /> AI Aesthetic Ranking · Puanlama kriterleri</summary>
              <div className="criteria-content">
                <p>Gemini öncesinde URL, erişim, en az 300 px kısa kenar ve 120.000 toplam piksel çözünürlük ile benzer kopyalar kontrol edilir. Yalnızca geçen benzersiz görseller analiz edilir. Genel puan ağırlıklı ortalamadır:</p>
                <ul>
                  <li><span>Arama alaka düzeyi</span><b>%15</b></li>
                  <li><span>Netlik</span><b>%15</b></li>
                  <li><span>Çözünürlük</span><b>%10</b></li>
                  <li><span>Işık</span><b>%15</b></li>
                  <li><span>Renk uyumu</span><b>%10</b></li>
                  <li><span>Kompozisyon</span><b>%15</b></li>
                  <li><span>Kadraj / çerçeveleme</span><b>%10</b></li>
                  <li><span>Edit uygunluğu</span><b>%10</b></li>
                </ul>
                <p className="criteria-gate">Otomatik seçim için aranan kişi/konu eşleşmeli, güven en az %70 ve estetik puan en az 45/100 olmalıdır. Yeterli sonuç yoksa en fazla bir ek SerpApi sayfası taranır. Benzer görseller ve önbellekteki analizler yeniden Gemini isteği oluşturmaz.</p>
              </div>
            </details>
            <div className="suggestions">
              <span>ÖRNEKLER</span>
              {['Anime edit', 'Gece şehir ışıkları', 'Futbol aksiyonu'].map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => {
                  setQuery(suggestion)
                  searchImages(suggestion)
                }}>{suggestion}</button>
              ))}
            </div>
          </section>

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
            <section className="results-section" aria-live="polite">
              <div className="results-heading">
                <div>
                  <div className="section-kicker">KEŞİF SONUÇLARI</div>
                  <h2>{loading ? 'Görseller bulunuyor…' : <>{photos.length} <span>görsel bulundu</span></>}</h2>
                </div>
                {photos.length > 0 && <div className="results-controls">
                  <button type="button" className="text-button" onClick={toggleAll}>
                    <span className={`checkbox-mini ${selectedPhotos.length === photos.length ? 'checked' : ''}`}>{selectedPhotos.length === photos.length && <Icon name="check" size={12} />}</span>
                    {selectedPhotos.length === photos.length ? 'Seçimi kaldır' : 'Tümünü seç'}
                  </button>
                  <button type="button" className="outline-button" disabled={analyzing || !health.geminiConfigured} onClick={analyzed ? selectBest : analyzeImages} title={!health.geminiConfigured ? 'Gemini API anahtarı gerekli' : ''}>
                    <Icon name="sparkle" size={16} /> {analyzed ? 'En iyileri seç' : 'AI ile analiz et'}
                  </button>
                  <button type="button" className="primary-button" disabled={!selectedPhotos.length || downloading} onClick={downloadZip}>
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
                    <div className="photo-byline"><span>{photo.width && photo.height ? `${photo.width} × ${photo.height}` : 'Google Görseller'}</span><span className="meta-dot" /> <span>{photo.sourceName || photo.photographer}</span></div>
                    {photo.score !== undefined && <div className="card-analysis">
                      {photo.analysisError ? <span className="analysis-failed">Analiz edilemedi: {photo.analysisError}</span> : <>
                        <div className="quality-bar"><span style={{ width: `${photo.score}%` }} /></div>
                        <span className="quality-label">Estetik <b>{photo.score}/100</b></span>
                        {photo.subjectMatch && <span className={`subject-chip subject-${photo.subjectMatch}`}>
                          {photo.subjectMatch === 'match' ? 'Eşleşti' : photo.subjectMatch === 'mismatch' ? 'Eşleşmedi' : 'Belirsiz'}
                        </span>}
                      </>}
                    </div>}
                    {photo.autoSelected && <p className="selected-reason"><Icon name="check" size={12} /> {photo.reason}</p>}
                  </div>
                </article>)}
              </div>
              {!loading && photos.length > 0 && visiblePhotos.length === 0 && <div className="no-results"><Icon name="image" size={28} /><p>Bu filtrede gösterilecek görsel yok.</p></div>}
            </section>
          )}

          {!loading && photos.length === 0 && !error && (
            <section className="empty-state">
              <div className="empty-art">
                <div className="art-glow" />
                <div className="art-back art-card-one"><span /><i /><b /></div>
                <div className="art-back art-card-two"><span /><i /></div>
                <div className="art-main"><div className="art-sun" /><div className="art-mountain mountain-one" /><div className="art-mountain mountain-two" /><div className="art-water" /><span className="art-scan"><Icon name="sparkle" size={18} /></span></div>
                <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
              </div>
              <span className="empty-label"><Icon name="sparkle" size={13} /> İLHAMINI KEŞFET</span>
              <h2>Fikrini görsele dönüştür.</h2>
              <p>Bir konu ara; gerçek görselleri bul, yapay zekâ ile değerlendir ve en iyilerini seç.</p>
              <div className="empty-features"><span><i />Gerçek kaynaklar</span><span><i />AI ile puanlama</span><span><i />Tek tıkla ZIP</span></div>
            </section>
          )}

          <section className={`history-section ${history.length === 0 ? 'history-empty' : ''}`} id="history-panel">
            <div><div className="section-kicker">SON ARAMALAR</div><h2>Geçmiş</h2></div>
            {history.length ? <div className="history-chips">{history.slice(0, 4).map((entry) => (
              <button key={`${entry.query}-${entry.time}`} type="button" onClick={() => openHistorySearch(entry)}><Icon name="clock" size={14} />{entry.query}<span>{entry.count}</span><Icon name="refresh" size={13} /></button>
            ))}</div> : <p>Aramalarınız burada görünecek.</p>}
          </section>
          <footer className="main-footer"><span>© 2026 IMAGE HUNTER AI</span><span>Görseller Google Görseller ile bulunur. Kullanım ve lisans koşullarını kaynak sayfasında kontrol edin.</span></footer>
        </div>
      </main>

      {detailPhoto && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailPhoto(null)}>
        <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
          <button className="modal-close" type="button" aria-label="Kapat" onClick={() => setDetailPhoto(null)}><Icon name="close" /></button>
          <div className="modal-image"><img src={detailPhoto.imageUrl} alt={detailPhoto.alt || 'Görsel önizlemesi'} /></div>
          <div className="modal-content">
            <span className="section-kicker">GÖRSEL AYRINTILARI</span>
            <h2 id="detail-title">{detailPhoto.alt || 'Başlıksız görsel'}</h2>
            {detailPhoto.score !== undefined ? <div className="modal-score"><Icon name="sparkle" size={16} /> AI Aesthetic Ranking <strong>{detailPhoto.score}/100</strong></div> : <p className="modal-ai-note">AI puanlaması için “AI ile analiz et” seçeneğini kullanın.</p>}
            <dl className="detail-list">
              <div><dt>Çözünürlük</dt><dd>{detailPhoto.width && detailPhoto.height ? `${detailPhoto.width} × ${detailPhoto.height} px` : 'Belirtilmemiş'}</dd></div>
              <div><dt>Fotoğrafçı</dt><dd>{detailPhoto.photographer}</dd></div>
              {detailPhoto.score !== undefined && <div><dt>Konu / kişi eşleşmesi</dt><dd>{detailPhoto.subjectMatch === 'match' ? 'Eşleşti' : detailPhoto.subjectMatch === 'mismatch' ? 'Eşleşmedi' : 'Belirsiz'} · güven {detailPhoto.subjectConfidence}/100</dd></div>}
              {detailPhoto.score !== undefined && <div><dt>Alaka</dt><dd>{detailPhoto.relevance}/100</dd></div>}
              {detailPhoto.score !== undefined && <div><dt>Netlik</dt><dd>{detailPhoto.clarity}/100</dd></div>}
              {detailPhoto.score !== undefined && <div><dt>Çözünürlük</dt><dd>{detailPhoto.resolution}/100</dd></div>}
              {detailPhoto.score !== undefined && <div><dt>Işık · Renk</dt><dd>{detailPhoto.lighting}/100 · {detailPhoto.colors}/100</dd></div>}
              {detailPhoto.score !== undefined && <div><dt>Kompozisyon · Edit uygunluğu</dt><dd>{detailPhoto.composition}/100 · {detailPhoto.editSuitability}/100</dd></div>}
              {detailPhoto.score !== undefined && <div><dt>Kadraj / çerçeveleme</dt><dd>{detailPhoto.framing}/100</dd></div>}
              {detailPhoto.reason && <div><dt>AI değerlendirmesi</dt><dd>{detailPhoto.reason}</dd></div>}
              {detailPhoto.duplicateOf && <div><dt>Benzer görsel</dt><dd>Tekrar eden içerik olarak belirlendi.</dd></div>}
              <div><dt>Lisans</dt><dd>{detailPhoto.license || 'Belirtilmemiş; kaynak sayfasında kontrol edin'}</dd></div>
            </dl>
            <p className="license-disclaimer">İndirmeden veya kullanmadan önce kaynağın güncel lisans koşullarını kontrol edin.</p>
            <div className="modal-actions">
              <a className="source-link" href={detailPhoto.sourceUrl} target="_blank" rel="noreferrer">{detailPhoto.sourceName || 'Görsel kaynağını'} aç <Icon name="external" size={15} /></a>
              <button type="button" className={`primary-button ${detailPhoto.selected ? 'modal-selected' : ''}`} onClick={() => togglePhoto(detailPhoto.id)}>{detailPhoto.selected ? <Icon name="check" size={15} /> : <Icon name="image" size={15} />}{detailPhoto.selected ? 'Seçildi' : 'Seç'}</button>
            </div>
          </div>
        </section>
      </div>}

      {notice && <div className="toast" role="status"><span><Icon name="check" size={15} /></span>{notice}<button type="button" aria-label="Bildirimi kapat" onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}
    </div>
  )
}

export default App
