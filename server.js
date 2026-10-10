const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const express = require('express')
const ffmpegPath = require('ffmpeg-static')
const youtubedl = require('youtube-dl-exec')
const { formatDuration, parseYouTubeUrl, safeFilename } = require('./lib/youtube')

const app = express()
const port = Number(process.env.PORT) || 3000
const publicDirectory = path.join(__dirname, 'public')
const downloadFormat = 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b'
const maxDurationSeconds = 20 * 60
const maxFileSizeBytes = 250 * 1024 * 1024

app.disable('x-powered-by')
app.use((request, response, next) => {
  response.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://i.ytimg.com data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  })
  next()
})
app.use(express.static(publicDirectory, {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}))

app.get('/api/info', rateLimit({ max: 30, windowMs: 10 * 60 * 1_000 }), async (request, response) => {
  try {
    const url = parseYouTubeUrl(request.query.url)
    const info = await getVideoInfo(url)

    response.json({
      title: info.title || 'Vídeo sem título',
      author: info.uploader || info.channel || 'YouTube',
      duration: formatDuration(info.duration),
      thumbnail: info.thumbnail || null
    })
  } catch (error) {
    console.error('[info]', error.message)
    response.status(400).json({ error: friendlyError(error) })
  }
})

app.get('/api/download', rateLimit({ max: 5, windowMs: 60 * 60 * 1_000 }), async (request, response) => {
  let tempDirectory

  try {
    const url = parseYouTubeUrl(request.query.url)
    const info = await getVideoInfo(url)
    assertWithinLimits(info)
    const filename = `${safeFilename(info.title)}.mp4`
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'baixai-'))
    const outputTemplate = path.join(tempDirectory, 'video.%(ext)s')

    await youtubedl(url, {
      ffmpegLocation: ffmpegPath,
      format: downloadFormat,
      mergeOutputFormat: 'mp4',
      noPlaylist: true,
      noWarnings: true,
      output: outputTemplate
    })

    const files = await fs.readdir(tempDirectory)
    const videoFile = files.find((file) => file.endsWith('.mp4'))

    if (!videoFile) {
      throw new Error('O arquivo final não foi gerado.')
    }

    response.download(path.join(tempDirectory, videoFile), filename, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    }, async (error) => {
      await removeTemporaryDirectory(tempDirectory)

      if (error && !response.headersSent) {
        response.status(500).json({ error: friendlyError(error) })
      }
    })
  } catch (error) {
    console.error('[download:prepare]', error.message)
    await removeTemporaryDirectory(tempDirectory)

    if (!response.headersSent) {
      response.status(400).json({ error: friendlyError(error) })
    }
  }
})

app.use((request, response) => {
  response.status(404).sendFile(path.join(publicDirectory, 'index.html'))
})

function getVideoInfo(url) {
  return youtubedl(url, {
    dumpSingleJson: true,
    ffmpegLocation: ffmpegPath,
    format: downloadFormat,
    noPlaylist: true,
    noWarnings: true,
    skipDownload: true,
    socketTimeout: 20
  })
}

function assertWithinLimits(info) {
  if (Number(info.duration) > maxDurationSeconds) {
    throw new Error('A duração máxima permitida é de 20 minutos.')
  }

  const selectedFormats = Array.isArray(info.requested_formats) ? info.requested_formats : []
  const estimatedBytes = selectedFormats.length
    ? selectedFormats.reduce((total, format) => total + Number(format.filesize || format.filesize_approx || 0), 0)
    : Number(info.filesize || info.filesize_approx || 0)

  if (estimatedBytes > maxFileSizeBytes) {
    throw new Error('Este vídeo é grande demais para o limite público de 250 MB.')
  }
}

function rateLimit({ max, windowMs }) {
  const clients = new Map()

  return (request, response, next) => {
    const now = Date.now()
    const client = request.get('cf-connecting-ip') || request.ip || request.socket.remoteAddress || 'unknown'
    const current = clients.get(client)

    if (!current || current.resetAt <= now) {
      clients.set(client, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    current.count += 1

    if (current.count > max) {
      response.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1_000)))
      response.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' })
      return
    }

    next()
  }
}

async function removeTemporaryDirectory(directory) {
  if (!directory) return

  try {
    await fs.rm(directory, { recursive: true, force: true })
  } catch (error) {
    console.error('[cleanup]', error.message)
  }
}

function friendlyError(error) {
  const message = String(error?.stderr || error?.message || '').toLowerCase()

  if (message.includes('private video')) return 'Este vídeo é privado.'
  if (message.includes('video unavailable')) return 'Este vídeo não está disponível.'
  if (message.includes('sign in') || message.includes('age')) return 'Este vídeo exige acesso ou confirmação de idade.'
  if (message.includes('url válida') || message.includes('não parece')) return error.message
  if (message.includes('duração máxima') || message.includes('grande demais')) return error.message

  return 'Não foi possível acessar esse vídeo. Confira o link e tente novamente.'
}

app.listen(port, () => {
  console.log(`Baixaí disponível em http://localhost:${port}`)
})
