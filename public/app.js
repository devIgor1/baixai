const form = document.querySelector('#download-form')
const input = document.querySelector('#video-url')
const inputRow = document.querySelector('.input-row')
const message = document.querySelector('#form-message')
const card = document.querySelector('#video-card')
const thumbnail = document.querySelector('#video-thumbnail')
const title = document.querySelector('#video-title')
const author = document.querySelector('#video-author')
const duration = document.querySelector('#video-duration')
const buttonLabel = document.querySelector('.button-label')

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  resetFeedback()

  const url = input.value.trim()

  if (!isYouTubeUrl(url)) {
    showError('Cole uma URL válida do YouTube.')
    return
  }

  setLoading(true)
  message.textContent = 'Conferindo o vídeo…'

  try {
    const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível acessar esse vídeo.')
    }

    showVideo(data)
    startDownload(url)
    message.textContent = 'Preparando o arquivo — o download começará sozinho.'
    message.className = 'message success'
    buttonLabel.textContent = 'BAIXAR DE NOVO'
  } catch (error) {
    showError(error.message)
  } finally {
    setLoading(false)
  }
})

input.addEventListener('input', () => {
  inputRow.classList.remove('invalid')
  message.className = 'message'
  message.textContent = input.value ? 'Tudo certo? Agora é só baixar.' : 'Cole um link para começar.'
})

function isYouTubeUrl(value) {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()

    return ['http:', 'https:'].includes(parsed.protocol) && (
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com')
    )
  } catch {
    return false
  }
}

function showVideo(video) {
  title.textContent = video.title
  author.textContent = video.author
  duration.textContent = video.duration

  if (video.thumbnail) {
    thumbnail.src = video.thumbnail
    thumbnail.alt = `Miniatura de ${video.title}`
  } else {
    thumbnail.removeAttribute('src')
    thumbnail.alt = ''
  }

  card.hidden = false
}

function startDownload(url) {
  const link = document.createElement('a')
  link.href = `/api/download?url=${encodeURIComponent(url)}`
  link.download = ''
  document.body.append(link)
  link.click()
  link.remove()
}

function setLoading(isLoading) {
  form.classList.toggle('is-loading', isLoading)
  form.querySelector('button').disabled = isLoading
  buttonLabel.textContent = isLoading ? 'PREPARANDO…' : (card.hidden ? 'BAIXAR VÍDEO' : 'BAIXAR DE NOVO')
}

function showError(text) {
  inputRow.classList.add('invalid')
  message.textContent = text
  message.className = 'message error'
  card.hidden = true
  input.focus()
}

function resetFeedback() {
  inputRow.classList.remove('invalid')
  message.className = 'message'
}
