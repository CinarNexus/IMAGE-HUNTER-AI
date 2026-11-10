import sharp from 'sharp'
import { boundedNumber, parseColor } from './common.js'

export async function addGlow(input, options = {}) {
  const color = parseColor(options.color || '#ffffff', 'Işık rengi')
  const intensity = boundedNumber(options.intensity, 'Işık yoğunluğu', 0, 100, 35)
  const radius = boundedNumber(options.blur ?? options.radius, 'Işık yayılımı', 1, 30, 12)
  const source = sharp(input).rotate().ensureAlpha()
  const { width, height } = await source.metadata()
  const glow = await sharp(input)
    .rotate()
    .blur(radius)
    .modulate({ saturation: 0 })
    .tint(color)
    .linear(intensity / 100, 0)
    .png()
    .toBuffer()
  return sharp(input)
    .rotate()
    .ensureAlpha()
    .composite([{ input: glow, blend: 'screen' }])
    .resize(width, height)
    .png()
    .toBuffer()
}
