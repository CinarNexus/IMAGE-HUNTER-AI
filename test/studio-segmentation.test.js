import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { replaceBackground, segmentForeground } from '../server/studio/processors/background-replacement.js'

async function createScene({ width = 128, height = 96, large = false } = {}) {
  const imageWidth = large ? width : width
  const imageHeight = large ? height : height
  const background = await sharp({
    create: { width: imageWidth, height: imageHeight, channels: 3, background: { r: 30, g: 110, b: 185 } },
  }).png().toBuffer()
  const objectWidth = Math.round(imageWidth * 0.34)
  const objectHeight = Math.round(imageHeight * 0.56)
  const left = Math.round((imageWidth - objectWidth) / 2)
  const top = Math.round((imageHeight - objectHeight) / 2)
  const object = await sharp({
    create: { width: objectWidth, height: objectHeight, channels: 3, background: { r: 220, g: 70, b: 28 } },
  }).png().toBuffer()
  const input = await sharp(background).composite([{ input: object, left, top }]).png().toBuffer()
  const maskScale = Math.min(1, 1024 / Math.max(imageWidth, imageHeight))
  const maskWidth = Math.max(1, Math.round(imageWidth * maskScale))
  const maskHeight = Math.max(1, Math.round(imageHeight * maskScale))
  const mask = Buffer.alloc(maskWidth * maskHeight * 3)
  const maskLeft = Math.round(left * maskScale)
  const maskTop = Math.round(top * maskScale)
  const maskObjectWidth = Math.round(objectWidth * maskScale)
  const maskObjectHeight = Math.round(objectHeight * maskScale)
  for (let y = maskTop + Math.round(maskObjectHeight * 0.3); y < maskTop + Math.round(maskObjectHeight * 0.7); y += 1) {
    for (let x = maskLeft + Math.round(maskObjectWidth * 0.3); x < maskLeft + Math.round(maskObjectWidth * 0.7); x += 1) {
      const offset = (y * maskWidth + x) * 3
      mask[offset + 1] = 255
    }
  }
  for (let y = 2; y < 9; y += 1) {
    for (let x = 2; x < 9; x += 1) {
      mask[(y * maskWidth + x) * 3] = 255
    }
  }
  const brushMap = await sharp(mask, {
    raw: { width: maskWidth, height: maskHeight, channels: 3 },
  }).png().toBuffer()
  return { input, brushMap, left, top, objectWidth, objectHeight, width: imageWidth, height: imageHeight }
}

test('GrabCut separates a user-marked general foreground object from its background', async () => {
  const scene = await createScene()
  const segmented = await segmentForeground(scene.input, {
    segmentationMask: scene.brushMap.toString('base64'),
    edgeSoftness: 0,
    maskExpansion: 0,
  })
  const { data: alpha } = await sharp(segmented.subject).extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  const center = (Math.floor(scene.height / 2) * scene.width) + Math.floor(scene.width / 2)
  assert.ok(alpha[center] > 200, `expected foreground alpha at center, got ${alpha[center]}`)
  assert.ok(alpha[0] < 30, `expected background alpha at corner, got ${alpha[0]}`)
  assert.equal(segmented.width, scene.width)
  assert.equal(segmented.height, scene.height)
})

test('GrabCut replacement supports a built-in backdrop and correct PNG/JPG exports', async () => {
  const scene = await createScene()
  const options = {
    segmentationMask: scene.brushMap.toString('base64'),
    backgroundColor: '#f0d020',
    edgeSoftness: 1,
  }
  const png = await replaceBackground(scene.input, { ...options, format: 'png' })
  const jpg = await replaceBackground(scene.input, { ...options, format: 'jpg' })
  assert.equal(png.format, 'png')
  assert.equal(jpg.format, 'jpg')
  assert.equal((await sharp(png.buffer).metadata()).format, 'png')
  assert.equal((await sharp(jpg.buffer).metadata()).format, 'jpeg')
  const { data, info } = await sharp(png.buffer).raw().toBuffer({ resolveWithObject: true })
  const backgroundOffset = 0
  assert.ok(data[backgroundOffset] > 200 && data[backgroundOffset + 1] > 150)
  const centerOffset = (Math.floor(scene.height / 2) * info.width + Math.floor(scene.width / 2)) * info.channels
  assert.ok(data[centerOffset] > data[centerOffset + 1] * 2)
})

test('GrabCut supports a user background image, gradient preset, subject scaling, and strict invalid inputs', async () => {
  const scene = await createScene()
  const userBackground = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 30, g: 220, b: 45 } },
  }).png().toBuffer()
  const photoBackground = await replaceBackground(scene.input, {
    segmentationMask: scene.brushMap.toString('base64'),
    backgroundBuffer: userBackground,
    subjectScale: 1.15,
    positionX: 0.05,
    positionY: -0.03,
  })
  const { data, info } = await sharp(photoBackground.buffer).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, scene.width)
  assert.ok(data[1] > data[0] * 2)

  const preset = await replaceBackground(scene.input, {
    segmentationMask: scene.brushMap.toString('base64'),
    backgroundMode: 'preset',
  })
  assert.equal((await sharp(preset.buffer).metadata()).width, scene.width)
  const colorOverridesStaleSettings = await replaceBackground(scene.input, {
    segmentationMask: scene.brushMap.toString('base64'),
    backgroundMode: 'color',
    backgroundColor: '#f0d020',
    backgroundPreset: 'dark-graphite',
    backgroundBuffer: userBackground,
  })
  const { data: colorPixels, info: colorInfo } = await sharp(colorOverridesStaleSettings.buffer).raw().toBuffer({ resolveWithObject: true })
  assert.ok(colorPixels[0] > 200 && colorPixels[1] > 150 && colorPixels[2] < 80)
  assert.equal(colorInfo.width, scene.width)
  await assert.rejects(replaceBackground(scene.input, {
    segmentationMask: scene.brushMap.toString('base64'),
    backgroundMode: 'upload',
  }), { statusCode: 400 })
  await assert.rejects(replaceBackground(scene.input, {
    segmentationMask: scene.brushMap.toString('base64'),
    subjectScale: 4,
  }), { statusCode: 400 })
  await assert.rejects(segmentForeground(scene.input, {
    segmentationMask: Buffer.from('not a mask').toString('base64'),
  }), (error) => error.statusCode === 400 && /Fırça maskesi/.test(error.message))
})

test('GrabCut uses brush seeds to separate overlapping foreground shapes from a patterned background', async () => {
  const width = 160
  const height = 128
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shade = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) ? 70 : 150
      const offset = (y * width + x) * 3
      pixels[offset] = shade
      pixels[offset + 1] = Math.round(shade * 0.8)
      pixels[offset + 2] = 190
    }
  }
  const background = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
  const firstShape = await sharp({
    create: { width: 60, height: 80, channels: 3, background: { r: 220, g: 55, b: 35 } },
  }).png().toBuffer()
  const overlappingShape = await sharp({
    create: { width: 25, height: 45, channels: 3, background: { r: 245, g: 190, b: 35 } },
  }).png().toBuffer()
  const input = await sharp(background).composite([
    { input: firstShape, left: 50, top: 24 },
    { input: overlappingShape, left: 90, top: 50 },
  ]).png().toBuffer()
  const markers = Buffer.alloc(width * height * 3)
  for (const [x, y] of [[72, 60], [101, 72]]) {
    const offset = (y * width + x) * 3
    markers[offset + 1] = 255
  }
  for (const [x, y] of [[4, 4], [150, 8]]) markers[(y * width + x) * 3] = 255
  const brushMap = await sharp(markers, { raw: { width, height, channels: 3 } }).png().toBuffer()
  const segmented = await segmentForeground(input, {
    segmentationMask: brushMap.toString('base64'),
    edgeSoftness: 0,
  })
  const { data: alpha } = await sharp(segmented.subject).extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  assert.ok(alpha[60 * width + 72] > 200)
  assert.ok(alpha[72 * width + 101] > 200)
  assert.ok(alpha[4 * width + 4] < 30)
  assert.ok(alpha[8 * width + 150] < 30)
})

test('GrabCut bounds a large photo mask operation and returns the original dimensions', async () => {
  const scene = await createScene({ width: 3000, height: 2000, large: true })
  const result = await replaceBackground(scene.input, {
    segmentationMask: scene.brushMap.toString('base64'),
    backgroundColor: '#f0f0f0',
    edgeSoftness: 2,
  })
  const metadata = await sharp(result.buffer).metadata()
  assert.equal(metadata.width, 3000)
  assert.equal(metadata.height, 2000)
})

test('GrabCut fails clearly when the image contains no foreground/background distinction', async () => {
  const uniformImage = await sharp({
    create: { width: 96, height: 96, channels: 3, background: { r: 100, g: 100, b: 100 } },
  }).png().toBuffer()
  await assert.rejects(segmentForeground(uniformImage), (error) => (
    error.statusCode === 400 && /Ön planı ve arka planı fırçayla işaretleyip/.test(error.message)
  ))
})
