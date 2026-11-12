import express, { Router } from 'express'
import { PassThrough } from 'node:stream'
import sharp from 'sharp'
import { ZipFile } from 'yazl'
import {
  ALLOWED_UPLOAD_FORMATS,
  STUDIO_UPLOAD_LIMITS,
} from './config.js'
import { mimeForFormat, parseFormat, validJsonObject } from './processors/common.js'
import { createEffectiveMaskPreview } from './processors/object-removal.js'
import { processStudioTool } from './processors/registry.js'
import { TemporaryUploadStore } from './storage.js'
import { lamaService as defaultLamaService } from './lama-service.js'

function httpError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function setPrivateResponseHeaders(response) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
}

function createRequestCancellation(request, response) {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException('İstemci isteği iptal etti.', 'AbortError'))
    }
  }
  const onResponseClose = () => {
    if (!response.writableEnded) abort()
  }
  request.once('aborted', abort)
  response.once('close', onResponseClose)
  return {
    signal: controller.signal,
    dispose() {
      request.removeListener('aborted', abort)
      response.removeListener('close', onResponseClose)
    },
  }
}

function validateAdjustments(value) {
  const limits = {
    brightness: [-50, 50],
    contrast: [-50, 50],
    saturation: [-100, 100],
    temperature: [-100, 100],
    gamma: [1, 3],
    sharpness: [0, 100],
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError('Düzenleme ayarları geçersiz.', 400)
  }
  const adjustments = {}
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const setting = value[key]
    if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < minimum || setting > maximum) {
      throw httpError(`${key} değeri ${minimum} ile ${maximum} arasında olmalı.`, 400)
    }
    adjustments[key] = setting
  }
  if (Object.keys(value).length !== Object.keys(limits).length
    || Object.keys(value).some((key) => !Object.hasOwn(limits, key))) {
    throw httpError('Desteklenmeyen düzenleme ayarı gönderildi.', 400)
  }
  return adjustments
}

function createAdjustedImage(input, adjustments) {
  const contrast = 1 + adjustments.contrast / 100
  const temperature = adjustments.temperature / 100
  let pipeline = sharp(input, {
    limitInputPixels: STUDIO_UPLOAD_LIMITS.maxPixels,
    failOn: 'error',
  })
    .rotate()
    .modulate({
      brightness: 1 + adjustments.brightness / 100,
      saturation: 1 + adjustments.saturation / 100,
    })
    .linear(contrast, 128 * (1 - contrast))

  if (temperature !== 0) {
    pipeline = pipeline.linear([
      1 + Math.max(0, temperature) * 0.18,
      1 + Math.abs(temperature) * 0.025,
      1 + Math.min(0, temperature) * 0.18,
    ], [0, 0, 0])
  }
  if (adjustments.gamma !== 1) pipeline = pipeline.gamma(adjustments.gamma)
  if (adjustments.sharpness > 0) {
    pipeline = pipeline.sharpen({
      sigma: 0.3 + adjustments.sharpness / 35,
      m1: 0.5,
      m2: 1.5,
    })
  }
  return pipeline
}

function encodeImage(pipeline, format) {
  if (format === 'png') return pipeline.png({ compressionLevel: 9 }).toBuffer()
  if (format === 'webp') return pipeline.webp({ quality: 92, effort: 5 }).toBuffer()
  return pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
}

function zipImages(images) {
  return new Promise((resolve, reject) => {
    const archive = new ZipFile()
    const output = new PassThrough()
    const chunks = []
    output.on('data', (chunk) => chunks.push(chunk))
    output.on('error', reject)
    output.on('end', () => resolve(Buffer.concat(chunks)))
    archive.outputStream.on('error', reject)
    archive.outputStream.pipe(output)
    for (const { buffer, name } of images) archive.addBuffer(buffer, name)
    archive.end()
  })
}

const maxBatchPixels = 25_000_000
const maxBatchOutputBytes = 75 * 1024 * 1024

export function createStudioRouter({
  uploadStore = new TemporaryUploadStore(),
  lamaService = defaultLamaService,
} = {}) {
  const router = Router()
  let initialized
  const ensureInitialized = () => {
    initialized ??= uploadStore.initialize()
    return initialized
  }
  const uploadParser = express.raw({
    type: 'application/octet-stream',
    limit: STUDIO_UPLOAD_LIMITS.maxFileBytes,
  })

  router.get('/lama/status', async (_request, response, next) => {
    try {
      response.setHeader('Cache-Control', 'no-store')
      const status = typeof lamaService.statusSnapshot === 'function'
        ? await lamaService.statusSnapshot()
        : lamaService.status()
      return response.json(status)
    } catch (error) {
      return next(error)
    }
  })

  router.post('/lama/start', async (request, response, next) => {
    try {
      await lamaService.start()
      response.setHeader('Cache-Control', 'no-store')
      return response.json(lamaService.status())
    } catch (error) {
      return next(error)
    }
  })

  router.post('/batch-export', async (request, response, next) => {
    try {
      await ensureInitialized()
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const { uploadIds, adjustments, format } = request.body || {}
      if (!Array.isArray(uploadIds) || uploadIds.length < 1 || uploadIds.length > 5
        || uploadIds.some((id) => typeof id !== 'string')
        || new Set(uploadIds).size !== uploadIds.length) {
        throw httpError('Toplu düzenleme için 1–5 farklı görsel seçin.', 400)
      }
      const validatedAdjustments = validateAdjustments(adjustments)
      if (!['png', 'jpg', 'webp'].includes(format)) {
        throw httpError('Dışa aktarma formatı PNG, JPG veya WebP olmalı.', 400)
      }
      const images = []
      let totalPixels = 0
      let totalBytes = 0
      for (let index = 0; index < uploadIds.length; index += 1) {
        const record = await uploadStore.get(uploadIds[index], ownerId)
        if (!record) throw httpError('Toplu düzenlemedeki görsellerden biri bulunamadı veya süresi doldu.', 404)
        totalPixels += record.width * record.height
        if (totalPixels > maxBatchPixels) {
          throw httpError('Toplu işlem toplam 25 megapiksel ile sınırlıdır. Daha az veya küçük görsel seçin.', 413)
        }
        const input = await uploadStore.getBuffer(uploadIds[index], ownerId)
        if (!input) throw httpError('Toplu düzenlemedeki görsellerden biri bulunamadı veya süresi doldu.', 404)
        const buffer = await encodeImage(createAdjustedImage(input, validatedAdjustments), format)
        totalBytes += buffer.length
        if (totalBytes > maxBatchOutputBytes) {
          throw httpError('Toplu çıktı 75 MB sınırını aştı. Daha küçük görseller veya daha sıkıştırılmış format seçin.', 413)
        }
        images.push({ buffer, name: `image-hunter-edited-${index + 1}.${format}` })
      }
      const archive = await zipImages(images)
      setPrivateResponseHeaders(response)
      response.setHeader('Content-Type', 'application/zip')
      response.setHeader('Content-Length', String(archive.length))
      response.setHeader('Content-Disposition', 'attachment; filename="image-hunter-batch.zip"')
      return response.send(archive)
    } catch (error) {
      return next(error)
    }
  })

  router.post('/uploads', uploadParser, async (request, response, next) => {
    try {
      await ensureInitialized()
      setPrivateResponseHeaders(response)
      if (!Buffer.isBuffer(request.body)) {
        throw httpError('Görsel yüklemeleri application/octet-stream olarak gönderilmelidir.', 415)
      }
      if (request.body.length === 0) {
        throw httpError('Yüklenecek görsel verisi gerekli.', 400)
      }

      let metadata
      try {
        metadata = await sharp(request.body, {
          limitInputPixels: STUDIO_UPLOAD_LIMITS.maxPixels,
          failOn: 'error',
        }).metadata()
      } catch (error) {
        if (/pixel limit/i.test(error.message)) {
          throw httpError('Görsel piksel sınırını aşıyor.', 413)
        }
        throw httpError('Dosya bozuk veya geçerli bir görsel değil.', 415)
      }
      const format = ALLOWED_UPLOAD_FORMATS[metadata.format]
      if (!format || metadata.pages > 1) {
        throw httpError('Yalnızca JPEG, PNG, WebP ve AVIF tek kare görseller desteklenir.', 415)
      }
      if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
        || metadata.width < 1 || metadata.height < 1
        || metadata.width > STUDIO_UPLOAD_LIMITS.maxImageEdge
        || metadata.height > STUDIO_UPLOAD_LIMITS.maxImageEdge
        || metadata.width * metadata.height > STUDIO_UPLOAD_LIMITS.maxPixels) {
        throw httpError('Görsel boyutları izin verilen sınırı aşıyor.', 413)
      }

      const upload = await uploadStore.save(request.body, {
        format,
        mimeType: format.mimeType,
        width: metadata.width,
        height: metadata.height,
        ownerId: request.socket.remoteAddress || 'anonymous',
      })
      response.status(201).json({
        upload: {
          id: upload.id,
          mimeType: upload.mimeType,
          size: upload.size,
          width: upload.width,
          height: upload.height,
          expiresAt: upload.expiresAt,
          previewUrl: `/api/studio/uploads/${upload.id}`,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/uploads/:id/preview', async (request, response, next) => {
    try {
      await ensureInitialized()
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const adjustments = validateAdjustments(request.body?.adjustments)
      const input = await uploadStore.getBuffer(request.params.id, ownerId)
      if (!input) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      const output = await createAdjustedImage(input, adjustments)
        .resize({
          width: 1200,
          height: 1200,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer()

      setPrivateResponseHeaders(response)
      response.setHeader('Content-Type', 'image/jpeg')
      response.setHeader('Content-Length', String(output.length))
      return response.send(output)
    } catch (error) {
      return next(error)
    }
  })

  router.post('/uploads/:id/export', async (request, response, next) => {
    try {
      await ensureInitialized()
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const adjustments = validateAdjustments(request.body?.adjustments)
      const format = request.body?.format
      if (!['png', 'jpg', 'webp'].includes(format)) {
        throw httpError('Dışa aktarma formatı PNG, JPG veya WebP olmalı.', 400)
      }
      const input = await uploadStore.getBuffer(request.params.id, ownerId)
      if (!input) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      const output = await encodeImage(createAdjustedImage(input, adjustments), format)
      const mimeType = format === 'jpg' ? 'image/jpeg' : `image/${format}`

      setPrivateResponseHeaders(response)
      response.setHeader('Content-Type', mimeType)
      response.setHeader('Content-Length', String(output.length))
      response.setHeader('Content-Disposition', `attachment; filename="image-hunter-edited.${format}"`)
      return response.send(output)
    } catch (error) {
      return next(error)
    }
  })

  router.post('/uploads//tools/:tool/preview', (_request, response) => {
    return response.status(400).json({ error: 'Önizleme için yükleme kimliği eksik. Görseli yeniden yükleyin.' })
  })

  router.post('/uploads/:id/tools/object-removal/mask-preview', async (request, response, next) => {
    try {
      await ensureInitialized()
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const payload = validJsonObject(request.body, 'Maske önizleme isteği')
      const options = validJsonObject(payload.options, 'Maske ayarları')
      const input = await uploadStore.getBuffer(request.params.id, ownerId)
      if (!input) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      const output = await createEffectiveMaskPreview(input, options)
      setPrivateResponseHeaders(response)
      response.setHeader('Content-Type', 'image/png')
      response.setHeader('Content-Length', String(output.length))
      return response.send(output)
    } catch (error) {
      return next(error)
    }
  })

  router.post('/uploads/:id/tools/:tool/preview', async (request, response, next) => {
    const cancellation = createRequestCancellation(request, response)
    try {
      await ensureInitialized()
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const payload = validJsonObject(request.body, 'Araç isteği')
      const options = validJsonObject(payload.options, 'Araç ayarları')
      if (Object.hasOwn(options, 'backgroundBuffer')) throw httpError('Arka plan görseli yalnızca yükleme kimliğiyle belirtilmelidir.', 400)
      const input = await uploadStore.getBuffer(request.params.id, ownerId)
      if (!input) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      const { backgroundUploadId, ...safeOptions } = options
      const backgroundBuffer = backgroundUploadId
        ? await uploadStore.getBuffer(backgroundUploadId, ownerId)
        : undefined
      if (backgroundUploadId && !backgroundBuffer) {
        return response.status(404).json({ error: 'Arka plan görseli bulunamadı veya süresi doldu.' })
      }
      const result = await processStudioTool(request.params.tool, input, {
        ...safeOptions,
        preview: true,
        ...(backgroundBuffer ? { backgroundBuffer } : {}),
        applyColor: (image) => encodeImage(
          createAdjustedImage(image, validateAdjustments(options.adjustments)),
          parseFormat(options.format || 'png'),
        ),
      }, {
        runLama: (image, mask, settings) => lamaService.inpaint(image, mask, {
          ...settings,
          signal: cancellation.signal,
        }),
      })
      const output = await sharp(result.buffer, {
        limitInputPixels: STUDIO_UPLOAD_LIMITS.maxPixels,
        failOn: 'error',
      }).resize({
        width: 1200,
        height: 1200,
        fit: 'inside',
        withoutEnlargement: true,
      }).toFormat(result.format).toBuffer()
      setPrivateResponseHeaders(response)
      response.setHeader('Content-Type', mimeForFormat(result.format))
      response.setHeader('Content-Length', String(output.length))
      return response.send(output)
    } catch (error) {
      if (!cancellation.signal.aborted) return next(error)
    } finally {
      cancellation.dispose()
    }
  })

  router.post('/uploads/:id/tools/:tool/export', async (request, response, next) => {
    try {
      await ensureInitialized()
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const payload = validJsonObject(request.body, 'Araç isteği')
      const options = validJsonObject(payload.options, 'Araç ayarları')
      if (Object.hasOwn(options, 'backgroundBuffer')) throw httpError('Arka plan görseli yalnızca yükleme kimliğiyle belirtilmelidir.', 400)
      const input = await uploadStore.getBuffer(request.params.id, ownerId)
      if (!input) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      const { backgroundUploadId, ...safeOptions } = options
      const backgroundBuffer = backgroundUploadId
        ? await uploadStore.getBuffer(backgroundUploadId, ownerId)
        : undefined
      if (backgroundUploadId && !backgroundBuffer) {
        return response.status(404).json({ error: 'Arka plan görseli bulunamadı veya süresi doldu.' })
      }
      const result = await processStudioTool(request.params.tool, input, {
        ...safeOptions,
        ...(backgroundBuffer ? { backgroundBuffer } : {}),
        applyColor: (image) => encodeImage(
          createAdjustedImage(image, validateAdjustments(options.adjustments)),
          parseFormat(options.format || 'png'),
        ),
      }, {
        runLama: (image, mask, settings) => lamaService.inpaint(image, mask, settings),
      })
      if (!Buffer.isBuffer(result.buffer) || result.buffer.length === 0) {
        throw httpError('Araç geçerli bir görsel çıktısı üretemedi.', 500)
      }
      const format = parseFormat(result.format)
      setPrivateResponseHeaders(response)
      response.setHeader('Content-Type', mimeForFormat(format))
      response.setHeader('Content-Length', String(result.buffer.length))
      response.setHeader('Content-Disposition', `attachment; filename="image-hunter-${request.params.tool}.${format}"`)
      return response.send(result.buffer)
    } catch (error) {
      return next(error)
    }
  })

  router.get('/uploads/:id', async (request, response, next) => {
    try {
      await ensureInitialized()
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const upload = await uploadStore.get(request.params.id, ownerId)
      if (!upload) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      setPrivateResponseHeaders(response)
      response.setHeader('Content-Type', upload.mimeType)
      response.setHeader('Content-Length', String(upload.size))
      const filePath = await uploadStore.getFilePath(request.params.id, ownerId)
      if (!filePath) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      response.sendFile(filePath)
    } catch (error) {
      next(error)
    }
  })

  router.delete('/uploads/:id', async (request, response, next) => {
    try {
      await ensureInitialized()
      setPrivateResponseHeaders(response)
      const ownerId = request.socket.remoteAddress || 'anonymous'
      const deleted = await uploadStore.delete(request.params.id, ownerId)
      if (!deleted) return response.status(404).json({ error: 'Yükleme bulunamadı veya süresi doldu.' })
      return response.status(204).end()
    } catch (error) {
      return next(error)
    }
  })

  return router
}
