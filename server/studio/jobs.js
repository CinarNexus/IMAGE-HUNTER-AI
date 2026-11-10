import { randomUUID } from 'node:crypto'
import {
  STUDIO_JOB_RETENTION_MS,
  STUDIO_MAX_JOBS,
  STUDIO_MAX_JOBS_PER_OWNER,
  STUDIO_TOOL_IDS,
} from './config.js'

const transitions = Object.freeze({
  queued: new Set(['processing', 'cancelled', 'failed']),
  processing: new Set(['completed', 'cancelled', 'failed']),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
})

export class StudioJobStore {
  #jobs = new Map()
  #now
  #maxJobs
  #retentionMs

  constructor({
    now = Date.now,
    maxJobs = STUDIO_MAX_JOBS,
    maxJobsPerOwner = STUDIO_MAX_JOBS_PER_OWNER,
    retentionMs = STUDIO_JOB_RETENTION_MS,
  } = {}) {
    this.#now = now
    this.#maxJobs = maxJobs
    this.maxJobsPerOwner = maxJobsPerOwner
    this.#retentionMs = retentionMs
  }

  create({ tool, uploadIds, ownerId }) {
    if (!STUDIO_TOOL_IDS.includes(tool)) throw new Error('Bilinmeyen stüdyo aracı.')
    if (!Array.isArray(uploadIds) || uploadIds.length < 1 || uploadIds.length > 10
      || uploadIds.some((id) => typeof id !== 'string')
      || new Set(uploadIds).size !== uploadIds.length) {
      throw new Error('Stüdyo işi için 1-10 benzersiz yükleme gerekli.')
    }
    if (typeof ownerId !== 'string' || ownerId.length < 16 || ownerId.length > 200) {
      throw new Error('Geçerli stüdyo iş sahibi gerekli.')
    }

    this.cleanup()
    if (this.#jobs.size >= this.#maxJobs) {
      const error = new Error('Çok sayıda stüdyo işi var. Biraz sonra tekrar deneyin.')
      error.statusCode = 429
      throw error
    }
    const ownerJobs = [...this.#jobs.values()].filter((job) => job.ownerId === ownerId).length
    if (ownerJobs >= this.maxJobsPerOwner) {
      const error = new Error('Bu kullanıcı için stüdyo işi saklama sınırı dolu.')
      error.statusCode = 429
      throw error
    }
    const now = this.#now()
    const job = {
      id: randomUUID(),
      tool,
      uploadIds: [...uploadIds],
      ownerId,
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.#retentionMs,
    }
    this.#jobs.set(job.id, job)
    return this.#publicJob(job)
  }

  get(id, ownerId) {
    this.cleanup()
    const job = this.#jobs.get(id)
    if (!job || job.ownerId !== ownerId) return null
    return this.#publicJob(job)
  }

  transition(id, status, { progress, resultUploadIds, error } = {}) {
    const job = this.#jobs.get(id)
    if (!job) throw new Error('Stüdyo işi bulunamadı veya süresi doldu.')
    if (!transitions[job.status]?.has(status)) {
      throw new Error(`Stüdyo işi ${job.status} durumundan ${status} durumuna geçemez.`)
    }
    if (progress !== undefined && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
      throw new Error('İş ilerlemesi 0-100 arasında tam sayı olmalı.')
    }
    if (status === 'completed'
      && (!Array.isArray(resultUploadIds) || resultUploadIds.some((id) => typeof id !== 'string'))) {
      throw new Error('Tamamlanan iş için geçerli sonuç yüklemeleri gerekli.')
    }
    if (status === 'failed' && (typeof error !== 'string' || !error.trim())) {
      throw new Error('Başarısız iş için hata açıklaması gerekli.')
    }

    job.status = status
    job.updatedAt = this.#now()
    job.expiresAt = job.updatedAt + this.#retentionMs
    if (progress !== undefined) job.progress = progress
    if (resultUploadIds) job.resultUploadIds = [...resultUploadIds]
    if (status === 'failed') job.error = error.trim().slice(0, 300)
    return this.#publicJob(job)
  }

  cleanup() {
    const now = this.#now()
    for (const [id, job] of this.#jobs) {
      if (job.expiresAt <= now) this.#jobs.delete(id)
    }
  }

  #publicJob(job) {
    const { ownerId: _ownerId, ...publicJob } = job
    return structuredClone(publicJob)
  }
}
