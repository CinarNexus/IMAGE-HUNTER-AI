import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pythonEnvironment = path.join(root, '.lama-venv')
const pythonPath = path.join(
  pythonEnvironment,
  process.platform === 'win32' ? 'Scripts' : 'bin',
  process.platform === 'win32' ? 'python.exe' : 'python',
)
const modelPath = path.join(root, '.models', 'lama', 'big-lama.pt')
const servicePath = path.join(root, 'server', 'studio', 'lama_service.py')
const startupTimeoutMs = 120_000
const inpaintTimeoutMs = 210_000

export class LamaService {
  constructor({
    spawnProcess = spawn,
    fetchImpl = fetch,
    startupTimeout = startupTimeoutMs,
    inpaintTimeout = inpaintTimeoutMs,
  } = {}) {
    this.spawnProcess = spawnProcess
    this.fetchImpl = fetchImpl
    this.startupTimeout = startupTimeout
    this.inpaintTimeout = inpaintTimeout
    this.child = null
    this.startPromise = null
    this.port = null
    this.token = null
    this.ready = false
    this.lastError = ''
    this.phase = 'idle'
    this.phaseStartedAt = 0
    this.activeTask = null
    this.stoppingPromise = null
    this.terminatingChild = null
  }

  setPhase(phase) {
    this.phase = phase
    this.phaseStartedAt = Date.now()
    if (this.activeTask && phase !== 'ready' && phase !== 'idle') {
      this.activeTask.phase = phase
    }
  }

  status() {
    const installed = existsSync(pythonPath) && existsSync(modelPath) && existsSync(servicePath)
    return {
      installed,
      running: Boolean(this.child),
      ready: this.ready,
      phase: this.phase,
      task: this.activeTask
        ? {
            phase: this.activeTask.phase,
            elapsedSeconds: Math.floor((Date.now() - this.activeTask.startedAt) / 1000),
          }
        : undefined,
      phaseElapsedSeconds: this.phaseStartedAt
        ? Math.floor((Date.now() - this.phaseStartedAt) / 1000)
        : 0,
      error: this.lastError || undefined,
      setupCommand: 'npm run setup:lama',
    }
  }

  async statusSnapshot() {
    const snapshot = this.status()
    if (!this.ready || !this.port || !this.token) return snapshot
    try {
      const response = await this.fetchImpl(`http://127.0.0.1:${this.port}/health`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(1_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const health = await response.json()
      if (health.task) {
        snapshot.task = {
          phase: health.task.phase,
          elapsedSeconds: health.task.elapsed_seconds,
        }
      }
    } catch (error) {
      snapshot.error = `LaMa durum bilgisi alınamadı: ${error.message}`
    }
    return snapshot
  }

  async start() {
    if (this.stoppingPromise) {
      await this.stoppingPromise
      if (this.startPromise) await this.startPromise.catch(() => {})
      this.stoppingPromise = null
      this.terminatingChild = null
    }
    if (this.startPromise) return this.startPromise
    if (this.child && this.port && this.ready) return this.port
    if (!existsSync(pythonPath) || !existsSync(modelPath)) {
      const error = new Error('LaMa kurulu değil. Kurmak için npm run setup:lama çalıştırın veya Klasik Telea seçeneğini belirleyin.')
      error.statusCode = 503
      throw error
    }

    this.lastError = ''
    this.setPhase('starting-python')
    this.startPromise = this.launch()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async launch() {
    this.token = randomBytes(32).toString('hex')
    this.lastError = ''
    const child = this.spawnProcess(pythonPath, [servicePath], {
      cwd: root,
      env: {
        ...process.env,
        LAMA_MODEL_PATH: modelPath,
        LAMA_SERVICE_TOKEN: this.token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    let standardOutput = ''
    let standardError = ''
    let readyPort
    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const timer = setTimeout(() => rejectReady(new Error('LaMa başlatma zaman aşımına uğradı.')), this.startupTimeout)
    const fail = (error) => {
      if (this.child === child) {
        this.child = null
        this.port = null
        this.ready = false
        this.lastError = error.message
      }
      rejectReady(error)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      standardError = `${standardError}${chunk}`.slice(-2048)
      process.stderr.write(`[LaMa Python] ${chunk}`)
    })
    child.stdout.on('data', (chunk) => {
      standardOutput = `${standardOutput}${chunk}`.slice(-4096)
      const phases = [...standardOutput.matchAll(/LAMA_STATUS:([a-z-]+)/g)]
      const tasks = [...standardOutput.matchAll(/LAMA_TASK:([a-z-]+)/g)]
      if (phases.length) this.setPhase(phases.at(-1)[1])
      if (tasks.length && this.activeTask) this.activeTask.phase = tasks.at(-1)[1]
      const match = standardOutput.match(/LAMA_READY:(\d+)/)
      if (match) {
        readyPort = Number(match[1])
        this.port = readyPort
        this.setPhase('ready')
        resolveReady(readyPort)
      }
    })
    child.once('error', (error) => fail(new Error(`LaMa Python süreci başlatılamadı: ${error.message}`)))
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null
        this.port = null
        this.token = null
        this.ready = false
        this.lastError = this.terminatingChild === child
          ? 'LaMa işlemi iptal edildi; servis sonraki istekte yeniden başlatılacak.'
          : `LaMa Python süreci durdu (${signal || code}).`
        this.setPhase(this.terminatingChild === child ? 'stopped' : 'error')
      }
      if (!readyPort) {
        const detail = standardError.trim().split(/\r?\n/).at(-1)
        fail(new Error(this.lastError || `LaMa servisi başlatılamadı${detail ? `: ${detail}` : ''}.`))
      }
    })
    try {
      await ready
      const deadline = Date.now() + 10_000
      let healthError
      while (Date.now() < deadline) {
        try {
          const response = await this.fetchImpl(`http://127.0.0.1:${readyPort}/health`, {
            headers: { Authorization: `Bearer ${this.token}` },
            signal: AbortSignal.timeout(1_000),
          })
          if (response.ok && (await response.json()).ready) {
            this.ready = true
            this.setPhase('ready')
            return readyPort
          }
          healthError = new Error('LaMa servisi başladı ancak model henüz hazır değil.')
        } catch (error) {
          healthError = error
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw healthError || new Error('LaMa servisi sağlık kontrolünü geçemedi.')
    } catch (error) {
      const serviceError = new Error(`LaMa başlatılamadı: ${error.message}. Telea klasik yöntemini seçerek devam edebilirsiniz.`)
      serviceError.statusCode = 503
      this.lastError = serviceError.message
      child.kill()
      this.child = null
      this.port = null
      this.token = null
      this.ready = false
      throw serviceError
    } finally {
      clearTimeout(timer)
    }
  }

  async inpaint(image, mask, { dilation = 4, feather = 5, signal } = {}) {
    if (this.activeTask) {
      const error = new Error('LaMa şu anda başka bir görseli işliyor. Mevcut işlemin tamamlanmasını bekleyin.')
      error.statusCode = 409
      throw error
    }

    const task = { phase: 'preparing', startedAt: Date.now() }
    this.activeTask = task
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('LaMa işlemi zaman aşımına uğradı.', 'TimeoutError'))
    }, this.inpaintTimeout)
    const abortFromCaller = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abortFromCaller, { once: true })
    if (signal?.aborted) abortFromCaller()

    try {
      const port = await waitForAbort(this.start(), controller.signal)
      task.phase = 'sending-image'
      const body = new FormData()
      body.append('image', new Blob([image], { type: 'image/png' }), 'image.png')
      body.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png')
      body.append('dilation', String(dilation))
      body.append('feather', String(feather))
      let response
      try {
        response = await this.fetchImpl(`http://127.0.0.1:${port}/inpaint`, {
          method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
          body,
          signal: controller.signal,
        })
      } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') throw error
        const serviceError = new Error(`LaMa servisine bağlanılamadı. ${error.message} Telea klasik yöntemini seçerek devam edebilirsiniz.`)
        serviceError.statusCode = 502
        throw serviceError
      }
      if (!response.ok) {
        const body = await response.text()
        let detail = ''
        try {
          const data = JSON.parse(body)
          detail = data.detail || data.error || ''
        } catch {
          detail = body
            .replace(/<[^>]*>/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim()
        }
        const message = detail || response.statusText || 'Yanıt gövdesi boş.'
        const error = new Error(`LaMa servisi HTTP ${response.status}: ${message.slice(0, 1000)}`)
        error.statusCode = response.status >= 500 ? 502 : response.status
        throw error
      }
      task.phase = 'receiving-result'
      const output = Buffer.from(await response.arrayBuffer())
      if (!output.length || response.headers.get('content-type') !== 'image/png') {
        throw new Error('LaMa geçerli bir görsel çıktısı döndürmedi.')
      }
      return output
    } catch (error) {
      if (timedOut) {
        this.terminateForCancellation()
        const timeoutError = new Error('LaMa işlemi 3,5 dakika içinde tamamlanmadı. Daha küçük bir maske veya görsel deneyin.')
        timeoutError.statusCode = 504
        throw timeoutError
      }
      if (signal?.aborted) {
        this.terminateForCancellation()
        throw error
      }
      if (error.name === 'TimeoutError') {
        const timeoutError = new Error('LaMa servisi başlatılırken zaman aşımına uğradı.')
        timeoutError.statusCode = 504
        throw timeoutError
      }
      if (error.statusCode) throw error
      const serviceError = new Error(`LaMa servisine bağlanılamadı. ${error.message}`)
      serviceError.statusCode = 502
      throw serviceError
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
      this.activeTask = null
      if (this.ready) this.setPhase('ready')
    }
  }

  terminateForCancellation() {
    const child = this.child
    if (!child || this.stoppingPromise) return
    this.terminatingChild = child
    this.ready = false
    this.setPhase('stopping')
    this.stoppingPromise = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
  }

  stop() {
    if (this.child) this.child.kill()
    this.child = null
    this.port = null
    this.token = null
    this.ready = false
    this.activeTask = null
    this.setPhase('idle')
  }
}

function waitForAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', onAbort))
}

export const lamaService = new LamaService()
process.once('exit', () => lamaService.stop())
