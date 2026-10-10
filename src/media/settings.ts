export const LIMITS = {
  bytes: 100 * 1024 * 1024,
  duration: 180,
  longSide: 1920,
  shortSide: 1080,
};
export const PRESETS = {
  quality: {
    name: "Maior qualidade",
    detail: "Mais detalhes, arquivo maior",
    crf: 20,
    audio: "160k",
  },
  balanced: {
    name: "Equilíbrio",
    detail: "Qualidade e tamanho na medida",
    crf: 26,
    audio: "128k",
  },
  small: {
    name: "Menor tamanho",
    detail: "Mais compressão, menos detalhes",
    crf: 32,
    audio: "96k",
  },
} as const;
export type Preset = keyof typeof PRESETS;
export type Resolution = "original" | "720" | "480";
export type VideoInfo = {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};
export type Settings = {
  start: number;
  end: number;
  preset: Preset;
  resolution: Resolution;
};
export function validateFile(file: Pick<File, "name" | "size">) {
  if (!/\.(mp4|mov|webm)$/i.test(file.name))
    throw new Error("Escolha um vídeo MP4, MOV ou WebM.");
  if (file.size === 0) throw new Error("Este arquivo está vazio.");
  if (file.size > LIMITS.bytes)
    throw new Error("O limite experimental é de 100 MB por vídeo.");
}
export function validateInfo(info: VideoInfo) {
  if (
    !Number.isFinite(info.duration) ||
    info.duration <= 0 ||
    !Number.isInteger(info.width) ||
    !Number.isInteger(info.height) ||
    info.width < 2 ||
    info.height < 2
  )
    throw new Error(
      "Não foi possível ler este vídeo. O arquivo pode estar danificado ou usar um codec incompatível.",
    );
  if (info.duration > LIMITS.duration + 0.05)
    throw new Error("O limite experimental é de três minutos por vídeo.");
  if (
    Math.max(info.width, info.height) > LIMITS.longSide ||
    Math.min(info.width, info.height) > LIMITS.shortSide
  )
    throw new Error(
      "O limite experimental é de 1080p (1920 × 1080 ou 1080 × 1920).",
    );
}
export function validateTrim(start: number, end: number, duration: number) {
  if (
    ![start, end, duration].every(Number.isFinite) ||
    start < 0 ||
    end > duration + 0.01 ||
    end - start < 0.1 - 1e-6
  )
    throw new Error(
      "Defina um trecho de pelo menos 0,1 segundo, dentro da duração do vídeo.",
    );
}
export function outputSize(info: VideoInfo, resolution: Resolution) {
  const factor =
    resolution === "original"
      ? 1
      : Math.min(
          1,
          Number(resolution) / Math.min(info.width, info.height),
          (Number(resolution) * 16) / 9 / Math.max(info.width, info.height),
        );
  return {
    width: Math.max(2, Math.floor((info.width * factor) / 2) * 2),
    height: Math.max(2, Math.floor((info.height * factor) / 2) * 2),
  };
}
export function exportArgs(info: VideoInfo, settings: Settings) {
  validateTrim(settings.start, settings.end, info.duration);
  const size = outputSize(info, settings.resolution);
  const preset = PRESETS[settings.preset];
  return [
    "-i",
    "input",
    "-ss",
    settings.start.toFixed(3),
    "-t",
    (settings.end - settings.start).toFixed(3),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-vf",
    `scale=${size.width}:${size.height},setsar=1`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    String(preset.crf),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    preset.audio,
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    "output.mp4",
  ];
}
export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function formatTime(seconds: number) {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const tenths = Math.round(value * 10);
  return `${Math.floor(tenths / 600)
    .toString()
    .padStart(2, "0")}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
}
export function parseTime(value: string) {
  const match = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(value.trim());
  if (!match) return NaN;
  const seconds = Number(match[2].replace(",", "."));
  return match[1] && seconds >= 60 ? NaN : Number(match[1] || 0) * 60 + seconds;
}
export function outputName(name: string) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return `${base || "video"}-baixai.mp4`;
}
