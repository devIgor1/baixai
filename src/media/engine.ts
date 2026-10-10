import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  exportArgs,
  validateFile,
  validateInfo,
  type VideoInfo,
  type Settings,
} from "./settings";
export type Stage = "loading" | "reading" | "encoding" | "finishing";
export type EngineUpdate = { stage: Stage; progress?: number };
type Probe = {
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string;
    side_data_list?: { rotation?: number }[];
  }[];
  format?: { duration?: string };
};
export function parseProbe(probe: Probe): VideoInfo {
  const stream = probe.streams?.find((item) => item.codec_type === "video");
  let width = Number(stream?.width || 0);
  let height = Number(stream?.height || 0);
  const rotation =
    stream?.side_data_list?.find((item) => item.rotation !== undefined)
      ?.rotation || 0;
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const info = {
    width,
    height,
    duration: Number(probe.format?.duration || stream?.duration || 0),
    hasAudio: !!probe.streams?.some((item) => item.codec_type === "audio"),
  };
  validateInfo(info);
  return info;
}
// One worker per operation. terminate() frees the virtual filesystem and wasm heap
// on success, error and cancellation, without retaining a growing wasm allocation.
export class VideoEngine {
  private ffmpeg: FFmpeg | null = null;
  private cancelled = false;
  private busy = false;
  cancel() {
    this.cancelled = true;
    this.ffmpeg?.terminate();
    this.ffmpeg = null;
  }
  private check() {
    if (this.cancelled)
      throw new DOMException("Operação cancelada.", "AbortError");
  }
  private async load(onUpdate: (update: EngineUpdate) => void) {
    this.check();
    if (typeof WebAssembly === "undefined" || typeof Worker === "undefined")
      throw new Error(
        "Este navegador não oferece os recursos necessários. Tente um navegador atualizado.",
      );
    const ffmpeg = new FFmpeg();
    this.ffmpeg = ffmpeg;
    onUpdate({ stage: "loading" });
    await ffmpeg.load({
      coreURL: new URL(
        `${import.meta.env.BASE_URL}engine/ffmpeg-core.js`,
        location.origin,
      ).href,
      wasmURL: new URL(
        `${import.meta.env.BASE_URL}engine/ffmpeg-core.wasm`,
        location.origin,
      ).href,
    });
    this.check();
    return ffmpeg;
  }
  private async probe(ffmpeg: FFmpeg, name: string): Promise<VideoInfo> {
    const code = await ffmpeg.ffprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height,duration:stream_side_data=rotation",
      "-of",
      "json",
      name,
      "-o",
      "probe.json",
    ]);
    this.check();
    // core 0.12.10 can return its initial -1 on a successful ffprobe call.
    // Require valid JSON and valid video fields below; positive codes are errors.
    if (code > 0)
      throw new Error(
        "Não foi possível ler este vídeo. O arquivo pode estar danificado ou usar um codec incompatível.",
      );
    const probeData = (await ffmpeg.readFile("probe.json", "utf8")) as string;
    return parseProbe(JSON.parse(probeData));
  }
  private async prepare(file: File, onUpdate: (update: EngineUpdate) => void) {
    validateFile(file);
    const ffmpeg = await this.load(onUpdate);
    onUpdate({ stage: "reading" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    this.check();
    await ffmpeg.writeFile("input", bytes);
    this.check();
    return { ffmpeg, info: await this.probe(ffmpeg, "input") };
  }
  private async operation<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Processe um arquivo por vez.");
    this.busy = true;
    this.cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              reject(
                new Error(
                  "O processamento demorou demais. Tente um trecho menor ou resolução mais baixa.",
                ),
              );
              this.cancel();
            },
            10 * 60 * 1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.ffmpeg?.terminate();
      this.ffmpeg = null;
      this.busy = false;
    }
  }
  inspect(file: File, onUpdate: (update: EngineUpdate) => void) {
    return this.operation(
      async () => (await this.prepare(file, onUpdate)).info,
    );
  }
  export(
    file: File,
    settings: Settings,
    onUpdate: (update: EngineUpdate) => void,
  ) {
    return this.operation(async () => {
      const started = performance.now();
      const { ffmpeg, info } = await this.prepare(file, onUpdate);
      let last = 0;
      ffmpeg.on("progress", ({ time }) => {
        // Ratio supplied by ffmpeg uses input duration. Use encoded output time
        // for trimmed exports, keep it monotonic and reserve completion for readback.
        const ratio = time / 1_000_000 / (settings.end - settings.start);
        if (Number.isFinite(ratio) && ratio >= 0)
          last = Math.max(last, Math.min(0.98, ratio));
        onUpdate({ stage: "encoding", progress: last });
      });
      onUpdate({ stage: "encoding" });
      const code = await ffmpeg.exec(exportArgs(info, settings));
      this.check();
      if (code !== 0)
        throw new Error(
          "Não foi possível converter este vídeo. Tente outro arquivo ou um trecho menor.",
        );
      onUpdate({ stage: "finishing" });
      const resultInfo = await this.probe(ffmpeg, "output.mp4");
      const data = await ffmpeg.readFile("output.mp4");
      if (typeof data === "string" || data.byteLength === 0)
        throw new Error("O vídeo exportado está vazio.");
      const blob = new Blob([data as Uint8Array<ArrayBuffer>], {
        type: "video/mp4",
      });
      return {
        blob,
        info: resultInfo,
        elapsed: (performance.now() - started) / 1000,
      };
    });
  }
}
