import sharp from 'sharp'
import { boundedNumber } from './common.js'

export async function removeSolidBackground(input, options = {}) {
  const tolerance = boundedNumber(options.tolerance, 'Arka plan toleransı', 5, 120, 42)
  const softness = boundedNumber(options.softness, 'Kenar yumuşaklığı', 0, 60, 16)
  const { data, info } = await sharp(input, { limitInputPixels: 20_000_000 })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const borderSamples = []
  const addSample = (x, y) => {
    const offset = (y * width + x) * channels
    borderSamples.push([data[offset], data[offset + 1], data[offset + 2]])
  }
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 128))) {
    addSample(x, 0)
    addSample(x, height - 1)
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 128))) {
    addSample(0, y)
    addSample(width - 1, y)
  }
  const background = [0, 1, 2].map((channel) => (
    borderSamples.reduce((sum, sample) => sum + sample[channel], 0) / borderSamples.length
  ))
  const lower = tolerance * (1 - softness / 100)
  const upper = tolerance + softness
  for (let offset = 0; offset < data.length; offset += channels) {
    const distance = Math.hypot(
      data[offset] - background[0],
      data[offset + 1] - background[1],
      data[offset + 2] - background[2],
    ) / Math.sqrt(3)
    const alpha = distance <= lower
      ? 0
      : distance >= upper || upper === lower
        ? data[offset + 3]
        : Math.round(data[offset + 3] * (distance - lower) / (upper - lower))
    data[offset + 3] = alpha
  }
  return sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer()
}
