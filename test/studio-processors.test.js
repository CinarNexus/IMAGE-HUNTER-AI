import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { removeSolidBackground } from '../server/studio/processors/background-removal.js'
import { replaceSolidBackground } from '../server/studio/processors/background-replacement.js'
import { addGlow } from '../server/studio/processors/glow-effects.js'
import { enhanceImage } from '../server/studio/processors/image-enhancement.js'
import { removeMaskedObject } from '../server/studio/processors/object-removal.js'
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

test('maskeli nesne kaldırma işaretlenen alanı piksellerle doldurur ve boş maskeyi reddeder', async () => {
  const image = await createImage()
  const mask = await sharp({
    create: { width: 16, height: 12, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite([{
    input: { create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } },
    left: 6,
    top: 4,
  }]).png().toBuffer()
  const output = await removeMaskedObject(image, { mask: mask.toString('base64') })
  assert.equal((await sharp(output).metadata()).width, 64)
  const blankMask = await sharp({
    create: { width: 16, height: 12, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer()
  await assert.rejects(removeMaskedObject(image, { mask: blankMask.toString('base64') }), { statusCode: 400 })
  await assert.rejects(removeMaskedObject(image, { mask: Buffer.from('not a PNG').toString('base64') }), { statusCode: 400 })
})

test('arka plan değiştirme düz renk anahtarlamayla PNG oluşturur', async () => {
  const output = await replaceSolidBackground(await createImage(), { backgroundColor: '#ff0000' })
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
  assert.ok([3, 4].includes(info.channels))
  assert.ok(data[0] > data[1] * 2)
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
