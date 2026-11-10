import { removeSolidBackground } from './background-removal.js'
import { replaceSolidBackground } from './background-replacement.js'
import { addGlow } from './glow-effects.js'
import { enhanceImage } from './image-enhancement.js'
import { removeMaskedObject } from './object-removal.js'
import { sharpenImage } from './sharpening.js'
import { smartCrop } from './smart-crop.js'
import { createThumbnail } from './thumbnail.js'
import { invalid } from './common.js'

const imageTools = Object.freeze({
  'background-removal': async (input, options) => ({
    buffer: await removeSolidBackground(input, options),
    format: 'png',
  }),
  'image-enhancement': async (input, options) => ({
    buffer: await enhanceImage(input, options),
    format: 'png',
  }),
  sharpening: async (input, options) => ({
    buffer: await sharpenImage(input, options),
    format: 'png',
  }),
  'object-removal': async (input, options) => ({
    buffer: await removeMaskedObject(input, options),
    format: 'png',
  }),
  'background-replacement': async (input, options) => ({
    buffer: await replaceSolidBackground(input, options),
    format: 'png',
  }),
  'smart-crop': async (input, options) => ({
    buffer: await smartCrop(input, options),
    format: 'png',
  }),
  'color-light-correction': async (input, options) => ({
    buffer: await options.applyColor(input),
    format: options.format || 'png',
  }),
  thumbnail: createThumbnail,
  'glow-effects': async (input, options) => ({
    buffer: await addGlow(input, options),
    format: 'png',
  }),
})

export async function processStudioTool(tool, input, options = {}) {
  const processor = imageTools[tool]
  if (!processor) invalid('Bu araç henüz etkin değil.')
  return processor(input, options)
}
