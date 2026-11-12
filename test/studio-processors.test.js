import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { removeSolidBackground } from '../server/studio/processors/background-removal.js'
import { addGlow } from '../server/studio/processors/glow-effects.js'
import { enhanceImage } from '../server/studio/processors/image-enhancement.js'
import {
  createEffectiveMaskPreview,
  removeMaskedObject,
  removeObjectWithLama,
} from '../server/studio/processors/object-removal.js'
import { processStudioTool } from '../server/studio/processors/registry.js'
import { sharpenImage } from '../server/studio/processors/sharpening.js'
import { smartCrop } from '../server/studio/processors/smart-crop.js'
import { createThumbnail } from '../server/studio/processors/thumbnail.js'

async function createImage(width = 64, height = 48) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 36, g: 88, b: 142 } },
  }).png().toBuffer()
}

test('arka plan kaldırma gerçek alfa çıktısı üretir ve tolerans sınırını doğrular', async () => {
  const image = await createImage()
  const output = await removeSolidBackground(image)
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.channels, 4)
  assert.equal(data[3], 0)
  await assert.rejects(removeSolidBackground(image, { tolerance: 200 }), { statusCode: 400 })
})

test('Lanczos kalite artırma çıktıyı büyütür, sınır aşımını reddeder ve sıfır keskinliği destekler', async () => {
  const image = await createImage()
  const output = await enhanceImage(image, { scale: 2, sharpness: 0 })
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.width, 128)
  assert.equal(metadata.height, 96)
  await assert.rejects(enhanceImage(image, { scale: 3 }), { statusCode: 400 })
})

test('keskinleştirme hem varsayılan hem sıfır miktarda geçerli görsel üretir', async () => {
  const image = await createImage()
  for (const amount of [0, 60]) {
    const output = await sharpenImage(image, { amount })
    assert.equal((await sharp(output).metadata()).format, 'png')
  }
  await assert.rejects(sharpenImage(image, { amount: 101 }), { statusCode: 400 })
})

async function createBrushMask(width = 16, height = 12, size = 4) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite([{
    input: { create: { width: size, height: size, channels: 3, background: { r: 255, g: 255, b: 255 } } },
    left: Math.floor((width - size) / 2),
    top: Math.floor((height - size) / 2),
  }]).png().toBuffer()
}

test('OpenCV Telea inpainting removes a small marked object and preserves surrounding pixels', async () => {
  const image = await createImage(160, 120)
  const mask = await createBrushMask()
  const output = await removeMaskedObject(image, {
    mask: mask.toString('base64'),
    radius: 3,
    dilation: 2,
    feather: 4,
  })
  const { data: originalPixels } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
  const { data: outputPixels, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 160)
  assert.equal(info.height, 120)
  assert.equal(info.channels, 3)
  assert.notDeepEqual(outputPixels, originalPixels)
  const outsideOffset = (10 * info.width + 10) * info.channels
  assert.deepEqual(
    [...outputPixels.subarray(outsideOffset, outsideOffset + 3)],
    [...originalPixels.subarray(outsideOffset, outsideOffset + 3)],
  )
})

test('OpenCV Telea inpainting handles large images with a bounded working resolution', async () => {
  const image = await createImage(3000, 2000)
  const mask = await createBrushMask(100, 67, 8)
  const output = await removeMaskedObject(image, {
    mask: mask.toString('base64'),
    radius: 4,
    dilation: 1,
    feather: 2,
  })
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.width, 3000)
  assert.equal(metadata.height, 2000)
  const maskTooLarge = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).png().toBuffer()
  await assert.rejects(removeMaskedObject(image, { mask: maskTooLarge.toString('base64') }), { statusCode: 400 })
})

test('maskeli nesne kaldırma bozuk ve boş maskeyi reddeder', async () => {
  const image = await createImage()
  const mask = await createBrushMask()
  const output = await removeMaskedObject(image, { mask: mask.toString('base64') })
  assert.equal((await sharp(output).metadata()).width, 64)
  const blankMask = await sharp({
    create: { width: 16, height: 12, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer()
  await assert.rejects(removeMaskedObject(image, { mask: blankMask.toString('base64') }), { statusCode: 400 })
  await assert.rejects(removeMaskedObject(image, { mask: Buffer.from('not a PNG').toString('base64') }), { statusCode: 400 })
})

test('etkin maske önizlemesi işlem ölçeğinde ikili genişletilmiş maskeyi döndürür; feather ve LaMa inference kullanmaz', async () => {
  const image = await createImage(1600, 1200)
  const mask = await createBrushMask(100, 75, 12)
  const options = { mask: mask.toString('base64'), dilation: 4, feather: 0 }
  const output = await createEffectiveMaskPreview(image, options)
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
  const expectedScale = Math.sqrt(1_200_000 / (1600 * 1200))
  assert.equal(info.width, Math.floor(1600 * expectedScale))
  assert.equal(info.height, Math.floor(1200 * expectedScale))
  assert.ok(info.width * info.height <= 1_200_000)
  assert.deepEqual(new Set(data), new Set([0, 255]))

  const unexpanded = await createEffectiveMaskPreview(image, { ...options, dilation: 0 })
  const differentlyFeathered = await createEffectiveMaskPreview(image, { ...options, feather: 20 })
  const { data: unexpandedData } = await sharp(unexpanded).raw().toBuffer({ resolveWithObject: true })
  const { data: differentlyFeatheredData } = await sharp(differentlyFeathered).raw().toBuffer({ resolveWithObject: true })
  const countMasked = (pixels) => pixels.reduce((count, value) => count + Number(value === 255), 0)
  assert.ok(countMasked(data) > countMasked(unexpandedData))
  assert.deepEqual(data, differentlyFeatheredData)
  await assert.rejects(createEffectiveMaskPreview(image, { ...options, mask: '' }), { statusCode: 400 })
})

test('LaMa processor sends bounded PNG inputs and preserves original pixels outside its mask', async () => {
  const image = await createImage(160, 120)
  const mask = await createBrushMask()
  const options = {
    mask: mask.toString('base64'),
    dilation: 2,
    feather: 4,
  }
  let inferenceCalls = 0
  let inferenceMask
  const output = await removeObjectWithLama(image, {
    ...options,
  }, async (imageInput, maskInput, settings) => {
    inferenceCalls += 1
    inferenceMask = maskInput
    const imageMetadata = await sharp(imageInput).metadata()
    const maskMetadata = await sharp(maskInput).metadata()
    assert.equal(imageMetadata.width, 160)
    assert.equal(imageMetadata.height, 120)
    assert.equal(maskMetadata.width, 160)
    assert.equal(maskMetadata.height, 120)
    assert.deepEqual(settings, { dilation: 0, feather: 0 })
    return imageInput
  })
  assert.equal(inferenceCalls, 1)
  const effectiveMask = await createEffectiveMaskPreview(image, options)
  const { data: sentMaskPixels } = await sharp(inferenceMask).raw().toBuffer({ resolveWithObject: true })
  const { data: previewMaskPixels } = await sharp(effectiveMask).raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(previewMaskPixels, sentMaskPixels)
  const { data: original, info: originalInfo } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
  const { data: result, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 160)
  const outsideOffset = (10 * info.width + 10) * info.channels
  const originalOffset = (10 * originalInfo.width + 10) * originalInfo.channels
  assert.deepEqual([...result.subarray(outsideOffset, outsideOffset + 3)], [...original.subarray(originalOffset, originalOffset + 3)])
})

test('LaMa preview caps CPU inference to 1.2 megapixels and restores the original output size', async () => {
  const image = await createImage(1600, 1200)
  const mask = await createBrushMask(100, 75, 12)
  let inferencePixels = 0
  let inferenceMask
  const options = { mask: mask.toString('base64'), preview: true }
  const output = await removeObjectWithLama(image, options, async (imageInput, maskInput) => {
    const { width, height } = await sharp(imageInput).metadata()
    inferencePixels = width * height
    inferenceMask = maskInput
    return imageInput
  })

  assert.ok(inferencePixels <= 1_200_000)
  const effectiveMask = await createEffectiveMaskPreview(image, options)
  const { data: sentMaskPixels } = await sharp(inferenceMask).raw().toBuffer({ resolveWithObject: true })
  const { data: previewMaskPixels, info: previewMaskInfo } = await sharp(effectiveMask).raw().toBuffer({ resolveWithObject: true })
  assert.equal(previewMaskInfo.width * previewMaskInfo.height, inferencePixels)
  assert.deepEqual(previewMaskPixels, sentMaskPixels)
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.width, 1600)
  assert.equal(metadata.height, 1200)
})

test('LaMa processor refuses missing services and invalid service outputs', async () => {
  const image = await createImage()
  const mask = await createBrushMask()
  await assert.rejects(removeObjectWithLama(image, { mask: mask.toString('base64') }), { statusCode: 503 })
  await assert.rejects(
    removeObjectWithLama(image, { mask: mask.toString('base64') }, async () => Buffer.from('not an image')),
    /LaMa servisi geçersiz bir görsel sonucu döndürdü/,
  )
})

test('LaMa engine errors are not silently replaced with Telea', async () => {
  const image = await createImage()
  const mask = await createBrushMask()
  let inpaintCalls = 0
  await assert.rejects(processStudioTool('object-removal', image, {
    engine: 'lama',
    mask: mask.toString('base64'),
  }, {
    runLama: async () => {
      inpaintCalls += 1
      const error = new Error('model unavailable')
      error.statusCode = 503
      throw error
    },
  }), { statusCode: 503, message: 'model unavailable' })
  assert.equal(inpaintCalls, 1)
  await assert.rejects(processStudioTool('object-removal', image, {
    engine: 'invalid',
    mask: mask.toString('base64'),
  }), { statusCode: 400 })
})

test('akıllı kırpma 4:5 oranını üretir ve geçersiz oranı reddeder', async () => {
  const image = await createImage(160, 90)
  const output = await smartCrop(image, { width: 100, ratio: '4:5' })
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.width, 100)
  assert.equal(metadata.height, 125)
  await assert.rejects(smartCrop(image, { ratio: '2:1' }), { statusCode: 400 })
})

test('thumbnail gerçek ölçülerde metin katmanlı JPG oluşturur', async () => {
  const output = await createThumbnail(await createImage(), {
    width: 384,
    height: 216,
    text: 'Studio',
    format: 'jpg',
  })
  assert.equal(output.format, 'jpg')
  const metadata = await sharp(output.buffer).metadata()
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, 384)
  assert.equal(metadata.height, 216)
})

test('glow efekti piksel çıktısı üretir ve renk değerini doğrular', async () => {
  const image = await createImage()
  const output = await addGlow(image, { color: '#16d9e8', intensity: 30, blur: 20 })
  assert.equal((await sharp(output).metadata()).format, 'png')
  await assert.rejects(addGlow(image, { color: 'blue' }), { statusCode: 400 })
})
