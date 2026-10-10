# Baixaí

Aplicação local com um único campo para baixar vídeos do YouTube pelo navegador.

## Rodar

Requer Node.js 20 ou mais recente.

```powershell
$env:YOUTUBE_DL_SKIP_PYTHON_CHECK='true'
npm install
npm start
```

Depois, abra `http://localhost:3000`.

O projeto usa as versões autônomas do `yt-dlp` e do FFmpeg por meio de pacotes npm, sem exigir Python instalado. O arquivo temporário é removido automaticamente após ser enviado ao navegador.

> Use apenas com vídeos próprios, em domínio público ou para os quais você tenha autorização de download.
