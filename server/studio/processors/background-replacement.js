import sharp from 'sharp'
import { boundedNumber, invalid, parseColor, parseFormat } from './common.js'
import { withOpenCv } from './opencv-runtime.js'

const maxSegmentationPixels = 3_000_000
const maxImagePixels = 20_000_000
const maxBrushBytes = 1_000_000
const PRESET_BACKGROUNDS = Object.freeze({
  'soft-blue': ['#b8d7f0', '#edf5fb'],
  'warm-studio': ['#9a735c', '#ead8c3'],
  'dark-graphite': ['#10141d', '#344257'],
})

async function readBrushMap(buffer, width, height) {
  let decoded
  try {
    decoded = await sharp(buffer, { limitInputPixels: 2_000_000 })
      .resize(width, height, { fit: 'fill' })
      .flatten({ background: '#000000' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch {
    invalid('Fırça maskesi geçerli bir görsel değil veya boyut sınırını aşıyor.')
  }
  const { data, info } = decoded
  if (info.channels !== 3) invalid('Fırça işaretleri okunamadı.')
  return data
}

function decodeBrushBuffer(value) {
  if (typeof value !== 'string') return null
  const encoded = value.replace(/^data:image\/png;base64,/, '')
  if (!/^[\da-z+/]+=*$/i.test(encoded) || encoded.length > maxBrushBytes * 1.4) {
    invalid('Segmentasyon fırça maskesi geçersiz veya çok büyük.')
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (!buffer.length || buffer.length > maxBrushBytes) invalid('Segmentasyon fırça maskesi geçersiz veya çok büyük.')
  return buffer
}

export async function segmentForeground(input, options = {}) {
  const segmentationMask = decodeBrushBuffer(options.segmentationMask)
  const edgeSoftness = boundedNumber(options.edgeSoftness, 'Kenar yumuşatma', 0, 20, 2)
  const maskExpansion = boundedNumber(options.maskExpansion, 'Maske düzeltme', -20, 20, 0)
  const oriented = await sharp(input, { limitInputPixels: maxImagePixels })
    .rotate()
    .toColourspace('srgb')
    .removeAlpha()
    .png()
    .toBuffer()
  const { width: sourceWidth, height: sourceHeight } = await sharp(oriented).metadata()
  if (sourceWidth * sourceHeight > maxImagePixels) invalid('Görsel 20 megapiksel sınırını aşıyor.')
  const scale = Math.min(1, Math.sqrt(maxSegmentationPixels / (sourceWidth * sourceHeight)))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const sourceData = await sharp(oriented)
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer()
  const markerData = segmentationMask ? await readBrushMap(segmentationMask, width, height) : null
  const result = await withOpenCv(async (cv) => {
    const source = new cv.Mat(height, width, cv.CV_8UC3)
    const labels = cv.Mat.zeros(height, width, cv.CV_8UC1)
    const backgroundModel = new cv.Mat()
    const foregroundModel = new cv.Mat()
    let kernel
    let refined
    let softened
    try {
      source.data.set(sourceData)
      const insetX = Math.max(1, Math.round(width * 0.015))
      const insetY = Math.max(1, Math.round(height * 0.015))
      const rect = new cv.Rect(
        insetX,
        insetY,
        Math.max(1, width - insetX * 2),
        Math.max(1, height - insetY * 2),
      )
      cv.grabCut(source, labels, rect, backgroundModel, foregroundModel, 3, cv.GC_INIT_WITH_RECT)

      let hasMarkers = false
      if (markerData) {
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          const offset = pixel * 3
          const red = markerData[offset]
          const green = markerData[offset + 1]
          const blue = markerData[offset + 2]
          if (green > red + 40 && green > blue + 40) {
            labels.data[pixel] = cv.GC_FGD
            hasMarkers = true
          } else if (red > green + 40 && red > blue + 40) {
            labels.data[pixel] = cv.GC_BGD
            hasMarkers = true
          }
        }
      }
      if (hasMarkers) {
        cv.grabCut(source, labels, rect, backgroundModel, foregroundModel, 3, cv.GC_INIT_WITH_MASK)
      }

      const maskData = new Uint8Array(width * height)
      let foregroundPixels = 0
      for (let pixel = 0; pixel < maskData.length; pixel += 1) {
        const label = labels.data[pixel]
        if (label === cv.GC_FGD || label === cv.GC_PR_FGD) {
          maskData[pixel] = 255
          foregroundPixels += 1
        }
      }
      if (!foregroundPixels || foregroundPixels > maskData.length * 0.98) {
        invalid('Ana nesne güvenilir biçimde ayrılamadı. Ön planı ve arka planı fırçayla işaretleyip tekrar deneyin.')
      }
      let mask = new cv.Mat(height, width, cv.CV_8UC1)
      mask.data.set(maskData)
      if (maskExpansion !== 0) {
        const expansion = Math.abs(Math.round(maskExpansion))
        kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(expansion * 2 + 1, expansion * 2 + 1))
        refined = new cv.Mat()
        if (maskExpansion > 0) cv.dilate(mask, refined, kernel)
        else cv.erode(mask, refined, kernel)
        mask.delete()
        mask = refined
        refined = null
      }
      if (edgeSoftness > 0) {
        softened = new cv.Mat()
        cv.GaussianBlur(mask, softened, new cv.Size(0, 0), edgeSoftness)
        mask.delete()
        mask = softened
        softened = null
      }
      const finalMask = Buffer.from(mask.data)
      mask.delete()
      return finalMask
    } finally {
      source.delete()
      labels.delete()
      backgroundModel.delete()
      foregroundModel.delete()
      kernel?.delete()
      refined?.delete()
      softened?.delete()
    }
  })

  const maskPng = await sharp(result, { raw: { width, height, channels: 1 } })
    .resize(sourceWidth, sourceHeight, { fit: 'fill' })
    .png()
    .toBuffer()
  const subject = await sharp(oriented, { limitInputPixels: maxImagePixels })
    .joinChannel(maskPng)
    .png()
    .toBuffer()
  return { subject, width: sourceWidth, height: sourceHeight }
}

async function createBackground(width, height, options) {
  if (options.backgroundBuffer) {
    return sharp(options.backgroundBuffer, { limitInputPixels: maxImagePixels })
      .rotate()
      .resize(width, height, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer()
  }
  const color = parseColor(options.backgroundColor || '#17243a', 'Yeni arka plan rengi')
  if (!options.backgroundPreset) {
    return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()
  }
  const colors = PRESET_BACKGROUNDS[options.backgroundPreset]
  if (!colors) invalid('Hazır arka plan seçeneği geçersiz.')
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`)
  return sharp(svg, { limitInputPixels: maxImagePixels }).png().toBuffer()
}

export async function replaceBackground(input, options = {}) {
  const format = parseFormat(options.format || 'png')
  const backgroundMode = options.backgroundMode
    ?? (options.backgroundBuffer ? 'upload' : options.backgroundPreset ? 'preset' : 'color')
  if (!['color', 'preset', 'upload'].includes(backgroundMode)) {
    invalid('Arka plan türü geçersiz.')
  }
  if (backgroundMode === 'upload' && !options.backgroundBuffer) {
    invalid('Yüklemek istediğiniz arka plan görselini seçin.')
  }
  const backgroundOptions = backgroundMode === 'color'
    ? { ...options, backgroundBuffer: undefined, backgroundPreset: '' }
    : backgroundMode === 'preset'
      ? { ...options, backgroundBuffer: undefined, backgroundPreset: options.backgroundPreset || 'soft-blue' }
      : { ...options, backgroundPreset: '' }
  const subjectScale = boundedNumber(options.subjectScale, 'Nesne boyutu', 0.5, 1.5, 1)
  const positionX = boundedNumber(options.positionX, 'Yatay konum', -0.5, 0.5, 0)
  const positionY = boundedNumber(options.positionY, 'Dikey konum', -0.5, 0.5, 0)
  const { subject, width, height } = await segmentForeground(input, options)
  const scaledWidth = Math.max(1, Math.round(width * subjectScale))
  const scaledHeight = Math.max(1, Math.round(height * subjectScale))
  const left = Math.round((width - scaledWidth) / 2 + positionX * width)
  const top = Math.round((height - scaledHeight) / 2 + positionY * height)
  const visibleLeft = Math.max(0, left)
  const visibleTop = Math.max(0, top)
  const visibleRight = Math.min(width, left + scaledWidth)
  const visibleBottom = Math.min(height, top + scaledHeight)
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    invalid('Ana nesne konumu görsel çerçevesinin dışına çıkıyor.')
  }
  const resizedSubject = sharp(subject, { limitInputPixels: maxImagePixels })
    .resize(scaledWidth, scaledHeight, { fit: 'fill' })
  const croppedSubject = (left < 0 || top < 0 || left + scaledWidth > width || top + scaledHeight > height)
    ? resizedSubject.extract({
      left: visibleLeft - left,
      top: visibleTop - top,
      width: visibleRight - visibleLeft,
      height: visibleBottom - visibleTop,
    })
    : resizedSubject
  const [background, foreground] = await Promise.all([
    createBackground(width, height, backgroundOptions),
    croppedSubject.png().toBuffer(),
  ])
  const composite = sharp(background, { limitInputPixels: maxImagePixels })
    .composite([{ input: foreground, left: visibleLeft, top: visibleTop }])
  if (format === 'jpg') return { buffer: await composite.flatten({ background: options.backgroundColor || '#17243a' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer(), format }
  if (format === 'webp') return { buffer: await composite.webp({ quality: 92, effort: 5 }).toBuffer(), format }
  return { buffer: await composite.png({ compressionLevel: 9 }).toBuffer(), format }
}

export { PRESET_BACKGROUNDS }
