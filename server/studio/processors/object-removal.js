import sharp from 'sharp'
import { invalid, positiveInteger } from './common.js'

const maxInpaintPixels = 4_000_000
const maxMaskBytes = 1_000_000

export async function removeMaskedObject(input, options = {}) {
  if (typeof options.mask !== 'string') invalid('Nesne silmek için fırçayla bir maske çizmelisiniz.')
  const encoded = options.mask.replace(/^data:image\/png;base64,/, '')
  if (!/^[\da-z+/]+=*$/i.test(encoded) || encoded.length > maxMaskBytes * 1.4) {
    invalid('Maske dosyası geçersiz veya çok büyük.')
  }
  const maskBuffer = Buffer.from(encoded, 'base64')
  if (!maskBuffer.length || maskBuffer.length > maxMaskBytes) invalid('Maske dosyası geçersiz veya çok büyük.')
  let maskMetadata
  try {
    maskMetadata = await sharp(maskBuffer, { limitInputPixels: 2_000_000 }).metadata()
  } catch {
    invalid('Maske geçerli bir PNG görseli değil.')
  }
  if (maskMetadata.format !== 'png' || maskMetadata.pages > 1) invalid('Maske tek kare PNG olmalıdır.')

  const oriented = await sharp(input, { limitInputPixels: 20_000_000 }).rotate().png().toBuffer()
  const { width: sourceWidth, height: sourceHeight } = await sharp(oriented).metadata()
  const scale = Math.min(1, Math.sqrt(maxInpaintPixels / (sourceWidth * sourceHeight)))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const { data: pixels, info } = await sharp(oriented)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const mask = await sharp(maskBuffer, { limitInputPixels: 2_000_000 })
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer()
  const count = width * height
  const queue = new Uint32Array(count)
  const visited = new Uint8Array(count)
  let head = 0
  let tail = 0
  let maskedPixels = 0

  for (let index = 0; index < count; index += 1) {
    if (mask[index] > 64) maskedPixels += 1
  }
  if (!maskedPixels) invalid('Maske boş; silmek istediğiniz bölgeyi fırçayla işaretleyin.')
  if (maskedPixels >= count) invalid('Görselin tamamı maskelenemez; bir miktar alanı maskesiz bırakın.')

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (mask[index] > 64) continue
      const touchesMask = (x > 0 && mask[index - 1] > 64)
        || (x + 1 < width && mask[index + 1] > 64)
        || (y > 0 && mask[index - width] > 64)
        || (y + 1 < height && mask[index + width] > 64)
      if (!touchesMask) continue
      visited[index] = 1
      queue[tail++] = index
    }
  }

  while (head < tail) {
    const index = queue[head++]
    const neighbors = [
      index % width > 0 ? index - 1 : -1,
      index % width + 1 < width ? index + 1 : -1,
      index >= width ? index - width : -1,
      index + width < count ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || mask[neighbor] <= 64 || visited[neighbor]) continue
      const source = index * info.channels
      const target = neighbor * info.channels
      pixels[target] = pixels[source]
      pixels[target + 1] = pixels[source + 1]
      pixels[target + 2] = pixels[source + 2]
      pixels[target + 3] = 255
      mask[neighbor] = 0
      visited[neighbor] = 1
      queue[tail++] = neighbor
    }
  }

  const filled = await sharp(pixels, { raw: info }).png().toBuffer()
  if (width === sourceWidth && height === sourceHeight) return filled
  return sharp(filled)
    .resize(sourceWidth, sourceHeight, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer()
}

export function validateMaskDimensions(width, height) {
  positiveInteger(width, 'Görsel genişliği', 10_000)
  positiveInteger(height, 'Görsel yüksekliği', 10_000)
}
