import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rmdir, rm, stat, unlink, writeFile, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { STUDIO_UPLOAD_LIMITS } from './config.js'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const uploadFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|avif)$/i
const instanceDirectoryPattern = /^instance-[a-zA-Z0-9_-]+$/

function throwStorageError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  throw error
}

async function removeAbandonedInstances(baseDirectory, now, retentionMs) {
  await mkdir(baseDirectory, { recursive: true })
  const entries = await readdir(baseDirectory, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !instanceDirectoryPattern.test(entry.name)) continue
    const directory = path.join(baseDirectory, entry.name)
    const files = await readdir(directory, { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile() || !uploadFilePattern.test(file.name)) continue
      const filePath = path.join(directory, file.name)
      const fileInfo = await stat(filePath)
      if (now - fileInfo.mtimeMs >= retentionMs) await unlink(filePath)
    }
    const remaining = await readdir(directory)
    if (remaining.length === 0) {
      const directoryInfo = await stat(directory)
      if (now - directoryInfo.mtimeMs >= retentionMs) await rmdir(directory)
    }
  }
}

export class TemporaryUploadStore {
  #baseDirectory
  #directory = null
  #initialization = null
  #entries = new Map()
  #pendingByOwner = new Map()
  #pendingFiles = 0
  #pendingBytes = 0
  #timer = null
  #limits

  constructor({
    baseDirectory = path.join(os.tmpdir(), 'image-hunter-ai-studio'),
    limits = STUDIO_UPLOAD_LIMITS,
    now = Date.now,
    maxFilesPerOwner = 5,
  } = {}) {
    this.#baseDirectory = baseDirectory
    this.#limits = limits
    this.now = now
    this.maxFilesPerOwner = maxFilesPerOwner
  }

  async initialize() {
    if (this.#directory) return
    if (!this.#initialization) {
      this.#initialization = (async () => {
        const now = this.now()
        await removeAbandonedInstances(this.#baseDirectory, now, this.#limits.retentionMs)
        this.#directory = await mkdtemp(path.join(this.#baseDirectory, 'instance-'))
        this.#timer = setInterval(() => {
          this.cleanup().catch((error) => console.error('Studio upload cleanup failed:', error))
        }, this.#limits.cleanupIntervalMs)
        this.#timer.unref()
      })()
    }
    try {
      await this.#initialization
    } catch (error) {
      this.#initialization = null
      throw error
    }
  }

  async save(buffer, { format, mimeType, width, height, ownerId = 'anonymous' }) {
    await this.initialize()
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > this.#limits.maxFileBytes) {
      throwStorageError('Yükleme dosyası boş veya boyut sınırını aşıyor.', 413)
    }
    const activeBytes = [...this.#entries.values()].reduce((total, entry) => total + entry.size, 0)
    const ownerFileCount = [...this.#entries.values()].filter((entry) => entry.ownerId === ownerId).length
    const ownerPendingFiles = this.#pendingByOwner.get(ownerId) || 0
    if (ownerFileCount + ownerPendingFiles >= this.maxFilesPerOwner
      || this.#entries.size + this.#pendingFiles >= this.#limits.maxStoredFiles
      || activeBytes + this.#pendingBytes + buffer.length > this.#limits.maxStoredBytes) {
      throwStorageError('Geçici stüdyo depolama kapasitesi dolu. Daha sonra tekrar deneyin.', 429)
    }

    const id = randomUUID()
    const fileName = `${id}.${format.extension}`
    const filePath = path.join(this.#directory, fileName)
    const partialPath = path.join(this.#directory, `.${id}.part`)
    this.#pendingFiles += 1
    this.#pendingBytes += buffer.length
    this.#pendingByOwner.set(ownerId, ownerPendingFiles + 1)
    try {
      await writeFile(partialPath, buffer, { flag: 'wx', mode: 0o600 })
      await rename(partialPath, filePath)
      const record = {
        id,
        fileName,
        filePath,
        ownerId,
        mimeType,
        size: buffer.length,
        width,
        height,
        createdAt: this.now(),
        expiresAt: this.now() + this.#limits.retentionMs,
      }
      this.#entries.set(id, record)
      return this.#publicRecord(record)
    } catch (error) {
      try {
        await unlink(partialPath)
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') throw cleanupError
      }
      throw error
    } finally {
      this.#pendingFiles -= 1
      this.#pendingBytes -= buffer.length
      const ownerPending = (this.#pendingByOwner.get(ownerId) || 1) - 1
      if (ownerPending === 0) this.#pendingByOwner.delete(ownerId)
      else this.#pendingByOwner.set(ownerId, ownerPending)
    }
  }

  async get(id, ownerId) {
    await this.initialize()
    if (typeof id !== 'string' || !idPattern.test(id)) return null
    const record = this.#entries.get(id)
    if (!record) return null
    if (ownerId !== undefined && record.ownerId !== ownerId) return null
    if (record.expiresAt <= this.now()) {
      await this.delete(id)
      return null
    }
    return this.#publicRecord(record)
  }

  async getFilePath(id, ownerId) {
    await this.initialize()
    if (typeof id !== 'string' || !idPattern.test(id)) return null
    const record = this.#entries.get(id)
    if (!record) return null
    if (ownerId !== undefined && record.ownerId !== ownerId) return null
    if (record.expiresAt <= this.now()) {
      await this.delete(id)
      return null
    }
    return record.filePath
  }

  async getBuffer(id, ownerId) {
    const filePath = await this.getFilePath(id, ownerId)
    if (!filePath) return null
    return readFile(filePath)
  }

  async delete(id, ownerId) {
    await this.initialize()
    if (typeof id !== 'string' || !idPattern.test(id)) return false
    const record = this.#entries.get(id)
    if (!record) return false
    if (ownerId !== undefined && record.ownerId !== ownerId) return false
    try {
      await unlink(record.filePath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    this.#entries.delete(id)
    return true
  }

  async cleanup() {
    await this.initialize()
    const now = this.now()
    for (const [id, record] of this.#entries) {
      if (record.expiresAt <= now) await this.delete(id)
    }

    const files = await readdir(this.#directory, { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile() || !uploadFilePattern.test(file.name)) continue
      const filePath = path.join(this.#directory, file.name)
      const fileInfo = await stat(filePath)
      if (now - fileInfo.mtimeMs < this.#limits.retentionMs) continue
      await unlink(filePath)
      const id = file.name.slice(0, file.name.lastIndexOf('.'))
      this.#entries.delete(id)
    }
  }

  async close() {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    if (!this.#directory) {
      this.#initialization = null
      return
    }
    const directory = this.#directory
    this.#directory = null
    this.#initialization = null
    this.#entries.clear()
    await rm(directory, { recursive: true, force: false })
  }

  #publicRecord(record) {
    const { filePath: _filePath, ownerId: _ownerId, ...publicRecord } = record
    return publicRecord
  }
}
