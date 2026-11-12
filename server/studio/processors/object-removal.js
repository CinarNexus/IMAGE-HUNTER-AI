import sharp from 'sharp'
import { boundedNumber, invalid, positiveInteger } from './common.js'
import { withOpenCv } from './opencv-runtime.js'

const maxInpaintPixels = 4_000_000
const maxPreviewInpaintPixels = 1_200_000
const maxMaskBytes = 1_000_000
const maxImagePixels = 20_000_000

function readMaskBuffer(options) {
  if (typeof options.mask !== 'string') invalid('Nesne silmek için fırçayla bir maske çizmelisiniz.')
  const encoded = options.mask.replace(/^data:image\/png;base64,/, '')
  if (!/^[\da-z+/]+=*$/i.test(encoded) || encoded.length > maxMaskBytes * 1.4) {
    invalid('Maske dosyası geçersiz veya çok büyük.')
  }
  const maskBuffer = Buffer.from(encoded, 'base64')
  if (!maskBuffer.length || maskBuffer.length > maxMaskBytes) invalid('Maske dosyası geçersiz veya çok büyük.')
  return maskBuffer
}

async function createInpaintingMasks(maskBuffer, width, height, options, includeSoftened = true) {
  let maskMetadata
  try {
    maskMetadata = await sharp(maskBuffer, { limitInputPixels: 2_000_000 }).metadata()
  } catch {
    invalid('Maske geçerli bir PNG görseli değil.')
  }
  if (maskMetadata.format !== 'png' || maskMetadata.pages > 1) invalid('Maske tek kare PNG olmalıdır.')

  const dilation = boundedNumber(options.dilation, 'Maske genişletme', 0, 30, 4)
  const feather = boundedNumber(options.feather, 'Kenar yumuşatma', 0, 30, 5)
  const sourceMask = await sharp(maskBuffer, { limitInputPixels: 2_000_000 })
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: '#000000' })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer()
  let maskedPixels = 0
  for (const value of sourceMask) {
    if (value > 64) maskedPixels += 1
  }
  const count = width * height
  if (!maskedPixels) invalid('Maske boş; silmek istediğiniz bölgeyi fırçayla işaretleyin.')
  if (maskedPixels >= count * 0.8) invalid('Silinecek alan görselin %80’inden büyük olamaz.')

  const masks = await withOpenCv(async (cv) => {
    const maskMat = new cv.Mat(height, width, cv.CV_8UC1)
    const binary = new cv.Mat()
    let dilated
    let kernel
    let softened
    try {
      maskMat.data.set(sourceMask)
      cv.threshold(maskMat, binary, 64, 255, cv.THRESH_BINARY)
      if (dilation > 0) {
        kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(dilation * 2 + 1, dilation * 2 + 1))
        dilated = new cv.Mat()
        cv.dilate(binary, dilated, kernel)
      } else {
        dilated = binary
      }
      if (feather > 0 && includeSoftened) {
        softened = new cv.Mat()
        cv.GaussianBlur(dilated, softened, new cv.Size(0, 0), feather)
      } else if (includeSoftened) {
        softened = dilated
      }
      return {
        binary: Buffer.from(dilated.data),
        ...(includeSoftened ? { softened: Buffer.from(softened.data) } : {}),
      }
    } finally {
      maskMat.delete()
      if (dilated && dilated !== binary) dilated.delete()
      binary.delete()
      kernel?.delete()
      if (softened && softened !== dilated) softened.delete()
    }
  })

  return { dilation, feather, ...masks }
}

async function prepareInpainting(input, options, pixelLimit = maxInpaintPixels) {
  const maskBuffer = readMaskBuffer(options)

  const radius = boundedNumber(options.radius, 'Doldurma yarıçapı', 1, 10, 3)
  const oriented = await sharp(input, { limitInputPixels: maxImagePixels })
    .rotate()
    .toColourspace('srgb')
    .png()
    .toBuffer()
  const {
    width: sourceWidth,
    height: sourceHeight,
    channels: sourceChannels,
  } = await sharp(oriented).metadata()
  if (sourceWidth * sourceHeight > maxImagePixels) invalid('Görsel 20 megapiksel sınırını aşıyor.')
  const scale = Math.min(1, Math.sqrt(pixelLimit / (sourceWidth * sourceHeight)))
  const width = Math.max(1, Math.floor(sourceWidth * scale))
  const height = Math.max(1, Math.floor(sourceHeight * scale))
  const { data: pixels } = await sharp(oriented)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const masks = await createInpaintingMasks(maskBuffer, width, height, options)

  return {
    oriented,
    pixels,
    width,
    height,
    sourceWidth,
    sourceHeight,
    hasAlpha: sourceChannels === 4,
    radius,
    ...masks,
  }
}

export async function createEffectiveMaskPreview(input, options = {}) {
  const maskBuffer = readMaskBuffer(options)
  let metadata
  try {
    metadata = await sharp(input, { limitInputPixels: maxImagePixels, failOn: 'error' }).metadata()
  } catch {
    invalid('Kaynak görsel okunamadı; lütfen görseli yeniden yükleyin.')
  }
  const swapDimensions = metadata.orientation >= 5 && metadata.orientation <= 8
  const sourceWidth = swapDimensions ? metadata.height : metadata.width
  const sourceHeight = swapDimensions ? metadata.width : metadata.height
  if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > maxImagePixels) {
    invalid('Görsel 20 megapiksel sınırını aşıyor.')
  }
  const scale = Math.min(1, Math.sqrt(maxPreviewInpaintPixels / (sourceWidth * sourceHeight)))
  const width = Math.max(1, Math.floor(sourceWidth * scale))
  const height = Math.max(1, Math.floor(sourceHeight * scale))
  const { binary } = await createInpaintingMasks(maskBuffer, width, height, options, false)
  return sharp(binary, { raw: { width, height, channels: 1 } }).png().toBuffer()
}

async function compositeAtOriginalResolution(output, prepared) {
  const processed = await sharp(output, {
    raw: { width: prepared.width, height: prepared.height, channels: 3 },
  })
    .resize(prepared.sourceWidth, prepared.sourceHeight, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const alphaMask = await sharp(prepared.softened, {
    raw: { width: prepared.width, height: prepared.height, channels: 1 },
  })
    .resize(prepared.sourceWidth, prepared.sourceHeight, { fit: 'fill' })
    .png()
    .toBuffer()
  const overlay = await sharp(processed).joinChannel(alphaMask).png().toBuffer()
  let composite = sharp(prepared.oriented, { limitInputPixels: maxImagePixels })
    .composite([{ input: overlay }])
  if (!prepared.hasAlpha) composite = composite.removeAlpha()
  return composite.png().toBuffer()
}

export async function removeMaskedObject(input, options = {}) {
  const prepared = await prepareInpainting(input, options)
  const output = await withOpenCv(async (cv) => {
    const source = new cv.Mat(prepared.height, prepared.width, cv.CV_8UC3)
    const mask = new cv.Mat(prepared.height, prepared.width, cv.CV_8UC1)
    const filled = new cv.Mat()
    try {
      source.data.set(prepared.pixels)
      mask.data.set(prepared.binary)
      cv.inpaint(source, mask, filled, prepared.radius, cv.INPAINT_TELEA)
      const composite = new Uint8Array(prepared.pixels.length)
      for (let pixel = 0; pixel < prepared.width * prepared.height; pixel += 1) {
        const alpha = prepared.softened[pixel] / 255
        const offset = pixel * 3
        for (let channel = 0; channel < 3; channel += 1) {
          composite[offset + channel] = Math.round(
            prepared.pixels[offset + channel] * (1 - alpha)
            + filled.data[offset + channel] * alpha,
          )
        }
      }
      return Buffer.from(composite)
    } finally {
      source.delete()
      mask.delete()
      filled.delete()
    }
  })
  return compositeAtOriginalResolution(output, prepared)
}

export async function removeObjectWithLama(input, options = {}, inpaint) {
  if (typeof inpaint !== 'function') {
    const error = new Error('LaMa servisi yapılandırılmamış. Klasik Telea seçeneğini belirleyebilirsiniz.')
    error.statusCode = 503
    throw error
  }
  const prepared = await prepareInpainting(
    input,
    options,
    options.preview ? maxPreviewInpaintPixels : maxInpaintPixels,
  )
  const image = await sharp(prepared.pixels, {
    raw: { width: prepared.width, height: prepared.height, channels: 3 },
  }).png().toBuffer()
  const mask = await sharp(prepared.binary, {
    raw: { width: prepared.width, height: prepared.height, channels: 1 },
  }).png().toBuffer()
  const output = await inpaint(image, mask, { dilation: 0, feather: 0 })
  let metadata
  try {
    metadata = await sharp(output, {
      limitInputPixels: maxInpaintPixels,
      failOn: 'error',
    }).metadata()
  } catch {
    throw new Error('LaMa servisi geçersiz bir görsel sonucu döndürdü.')
  }
  if (metadata.format !== 'png' || metadata.width !== prepared.width || metadata.height !== prepared.height) {
    throw new Error('LaMa sonucu beklenen görsel boyutlarıyla eşleşmiyor.')
  }
  const { data, info } = await sharp(output)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 3) throw new Error('LaMa sonucu geçerli RGB görseli değil.')
  return compositeAtOriginalResolution(data, prepared)
}

export function validateMaskDimensions(width, height) {
  positiveInteger(width, 'Görsel genişliği', 10_000)
  positiveInteger(height, 'Görsel yüksekliği', 10_000)
}
