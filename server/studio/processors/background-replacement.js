import sharp from 'sharp'
import { parseColor } from './common.js'
import { removeSolidBackground } from './background-removal.js'

export async function replaceSolidBackground(input, options = {}) {
  const color = parseColor(options.backgroundColor, 'Yeni arka plan rengi')
  const subject = await removeSolidBackground(input, options)
  const { width, height } = await sharp(subject).metadata()
  const background = Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`,
  )
  return sharp(background)
    .composite([{ input: subject }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}
