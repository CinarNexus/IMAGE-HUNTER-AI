export const STUDIO_UPLOAD_LIMITS = Object.freeze({
  maxFileBytes: 15 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxImageEdge: 10_000,
  maxStoredFiles: 100,
  maxStoredBytes: 256 * 1024 * 1024,
  retentionMs: 60 * 60 * 1000,
  cleanupIntervalMs: 5 * 60 * 1000,
})

export const STUDIO_JOB_RETENTION_MS = 60 * 60 * 1000
export const STUDIO_MAX_JOBS = 100
export const STUDIO_MAX_JOBS_PER_OWNER = 5

export function arePaidProvidersEnabled() {
  const configured = process.env.STUDIO_PAID_PROVIDERS_ENABLED
  if (configured === undefined || configured === 'false') return false
  if (configured === 'true') return true
  throw new Error('STUDIO_PAID_PROVIDERS_ENABLED yalnızca true veya false olabilir.')
}

export function getStudioDailyBudgetUsd() {
  const configured = process.env.STUDIO_DAILY_BUDGET_USD
  if (configured === undefined || configured.trim() === '') return 0
  const budget = Number(configured)
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error('STUDIO_DAILY_BUDGET_USD negatif olmayan geçerli bir sayı olmalı.')
  }
  return budget
}

export const STUDIO_TOOL_IDS = Object.freeze([
  'background-removal',
  'image-enhancement',
  'sharpening',
  'object-removal',
  'background-replacement',
  'smart-crop',
  'color-light-correction',
  'thumbnail',
  'glow-effects',
  'batch-editing',
  'image-to-video',
])

export const ALLOWED_UPLOAD_FORMATS = Object.freeze({
  jpeg: { extension: 'jpg', mimeType: 'image/jpeg' },
  png: { extension: 'png', mimeType: 'image/png' },
  webp: { extension: 'webp', mimeType: 'image/webp' },
  avif: { extension: 'avif', mimeType: 'image/avif' },
})
