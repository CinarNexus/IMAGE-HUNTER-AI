import sharp from 'sharp'
import { assertOutputDimensions, boundedNumber, imagePipeline, invalid } from './common.js'

export async function enhanceImage(input, options = {}) {
  const scale = options.scale === undefined ? 2 : options.scale
  if (![2, 4].includes(scale)) invalid('Büyütme oranı 2 veya 4 olmalı.')
  const metadata = await imagePipeline(input).metadata()
  const width = metadata.width * scale
  const height = metadata.height * scale
  assertOutputDimensions(width, height)
  const sharpness = boundedNumber(options.sharpness, 'Keskinlik', 0, 100, 35)
  let pipeline = imagePipeline(input)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  if (sharpness > 0) {
    pipeline = pipeline.sharpen({ sigma: 0.3 + sharpness / 40, m1: 0.5, m2: 1.5 })
  }
  return pipeline.png().toBuffer()
}
