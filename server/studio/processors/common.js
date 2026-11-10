import sharp from 'sharp'
import { STUDIO_UPLOAD_LIMITS } from '../config.js'

export function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  throw error
}

export function validJsonObject(value, label = 'Ayarlar') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} geçersiz.`)
  return value
}

export function imagePipeline(buffer) {
  return sharp(buffer, {
    limitInputPixels: STUDIO_UPLOAD_LIMITS.maxPixels,
    failOn: 'error',
  }).rotate()
}

export async function inspectImage(buffer) {
  return imagePipeline(buffer).metadata()
}

export function assertOutputDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1
    || width > STUDIO_UPLOAD_LIMITS.maxImageEdge
    || height > STUDIO_UPLOAD_LIMITS.maxImageEdge
    || width * height > STUDIO_UPLOAD_LIMITS.maxPixels) {
    invalid('Çıktı boyutları 20 megapiksel ve 10.000 px sınırını aşamaz.')
  }
}

export function parseColor(color, label = 'Renk') {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    invalid(`${label} #RRGGBB biçiminde olmalı.`)
  }
  return color
}

export function parseFormat(format) {
  if (!['png', 'jpg', 'webp'].includes(format)) invalid('Çıktı formatı PNG, JPG veya WebP olmalı.')
  return format
}

export function encode(pipeline, format) {
  if (format === 'png') return pipeline.png({ compressionLevel: 9 }).toBuffer()
  if (format === 'webp') return pipeline.webp({ quality: 92, effort: 5 }).toBuffer()
  return pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
}

export function mimeForFormat(format) {
  return format === 'jpg' ? 'image/jpeg' : `image/${format}`
}

export function boundedNumber(value, key, min, max, fallback = min) {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isFinite(result) || result < min || result > max) {
    invalid(`${key} ${min} ile ${max} arasında olmalı.`)
  }
  return result
}

export function positiveInteger(value, key, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    invalid(`${key} 1 ile ${max} arasında tam sayı olmalı.`)
  }
  return value
}
