const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
])

function parseYouTubeUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw new Error('Cole uma URL válida do YouTube.')
  }

  let parsed

  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Cole uma URL válida do YouTube.')
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Este link não parece ser do YouTube.')
  }

  return parsed.toString()
}

function safeFilename(value) {
  const cleaned = String(value || 'video')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 140)

  return cleaned || 'video'
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  return hours > 0
    ? [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
    : [minutes, remainingSeconds].map((part) => String(part).padStart(2, '0')).join(':')
}

module.exports = { formatDuration, parseYouTubeUrl, safeFilename }
