const test = require('node:test')
const assert = require('node:assert/strict')
const { formatDuration, parseYouTubeUrl, safeFilename } = require('../lib/youtube')

test('aceita URLs comuns do YouTube', () => {
  assert.equal(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ')
  assert.match(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), /youtube\.com/)
})

test('rejeita URLs externas e protocolos inseguros', () => {
  assert.throws(() => parseYouTubeUrl('https://example.com/video'), /YouTube/)
  assert.throws(() => parseYouTubeUrl('file:///etc/passwd'), /YouTube/)
})

test('gera nomes de arquivo seguros', () => {
  assert.equal(safeFilename(' Meu: vídeo? *legal* '), 'Meu vídeo legal')
  assert.equal(safeFilename('...'), 'video')
})

test('formata durações curtas e longas', () => {
  assert.equal(formatDuration(65), '01:05')
  assert.equal(formatDuration(3_661), '01:01:01')
})
