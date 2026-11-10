import { boundedNumber, imagePipeline } from './common.js'

export async function sharpenImage(input, options = {}) {
  const amount = boundedNumber(options.amount, 'Keskinlik', 0, 100, 50)
  const sigma = boundedNumber(options.sigma ?? options.radius, 'Yarıçap', 0.3, 5, 1)
  const pipeline = imagePipeline(input)
  if (amount === 0) return pipeline.png().toBuffer()
  return pipeline.sharpen({
    sigma,
    m1: 0.3 + amount / 100,
    m2: 1 + amount / 50,
  }).png().toBuffer()
}
