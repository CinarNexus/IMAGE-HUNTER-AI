import { encode, imagePipeline, invalid, parseColor, parseFormat, positiveInteger } from './common.js'

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[character])
}

export async function createThumbnail(input, options = {}) {
  const width = positiveInteger(options.width || 1280, 'Thumbnail genişliği', 3840)
  const height = positiveInteger(options.height || 720, 'Thumbnail yüksekliği', 2160)
  const background = parseColor(options.backgroundColor || '#17243a', 'Arka plan rengi')
  const text = options.text === undefined ? '' : options.text
  if (typeof text !== 'string' || text.length > 100) invalid('Thumbnail metni en fazla 100 karakter olabilir.')
  const format = parseFormat(options.format || 'png')
  const { width: sourceWidth, height: sourceHeight } = await imagePipeline(input).metadata()
  const fontSize = Math.round(Math.min(width, height) * 0.09)
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="shade" x1="0" x2="0" y1="0" y2="1"><stop offset="45%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".76"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="${background}" opacity=".28"/>
    <rect width="100%" height="100%" fill="url(#shade)"/>
    ${text ? `<text x="6%" y="88%" fill="#fff" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" stroke="#10141d" stroke-width="${Math.round(fontSize * 0.08)}" paint-order="stroke">${escapeXml(text)}</text>` : ''}
  </svg>`)
  return encode(
    imagePipeline(input)
      .resize(width, height, { fit: 'cover', position: 'attention' })
      .composite([{ input: overlay }]),
    format,
  ).then(async (output) => ({
    buffer: output,
    width,
    height,
    sourceWidth,
    sourceHeight,
    format,
  }))
}
