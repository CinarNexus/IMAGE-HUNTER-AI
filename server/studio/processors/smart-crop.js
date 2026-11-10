import { assertOutputDimensions, imagePipeline, invalid, positiveInteger } from './common.js'

const ratios = Object.freeze({
  '1:1': [1, 1],
  '4:5': [4, 5],
  '3:2': [3, 2],
  '16:9': [16, 9],
})

export async function smartCrop(input, options = {}) {
  const ratio = ratios[options.ratio || '1:1']
  if (!ratio) invalid('Kırpma oranı 1:1, 4:5, 3:2 veya 16:9 olmalı.')
  const width = positiveInteger(options.width || 1200, 'Genişlik', 10_000)
  const height = Math.round(width * ratio[1] / ratio[0])
  assertOutputDimensions(width, height)
  return imagePipeline(input)
    .resize(width, height, {
      fit: 'cover',
      position: 'attention',
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer()
}
