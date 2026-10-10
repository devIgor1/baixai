import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  PRESETS,
  formatBytes,
  formatTime,
  parseTime,
  outputName,
  outputSize,
  validateFile,
  validateTrim,
  type Preset,
  type Resolution,
  type VideoInfo,
} from "./media/settings";
import type { EngineUpdate, VideoEngine } from "./media/engine";

const stageLabels = {
  loading: "Carregando o motor de vídeo…",
  reading: "Lendo o vídeo no seu dispositivo…",
  encoding: "Processando seu vídeo…",
  finishing: "Conferindo o arquivo final…",
};
type Result = { blob: Blob; info: VideoInfo; elapsed: number };
function Icon({
  name,
  size = 22,
}: {
  name:
    | "arrow"
    | "upload"
    | "video"
    | "play"
    | "cut"
    | "check"
    | "close";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />,
    video: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="m10 9 5 3-5 3Z" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8Z" />,
    cut: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="m8 8 12 12M8 16 20 4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
function TimeField({
  label,
  value,
  disabled,
  onChange,
  onValidity,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [text, setText] = useState(formatTime(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(formatTime(value));
      setInvalid(false);
      onValidity(true);
    }
  }, [value]);
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        aria-invalid={invalid}
        aria-describedby="time-help"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseTime(event.target.value);
          setInvalid(!Number.isFinite(parsed));
          onValidity(Number.isFinite(parsed));
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => {
          focused.current = false;
          if (!invalid) setText(formatTime(value));
        }}
      />
    </label>
  );
}
export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<EngineUpdate | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [preset, setPreset] = useState<Preset>("balanced");
  const [resolution, setResolution] = useState<Resolution>("720");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [current, setCurrent] = useState(0);
  const [startValid, setStartValid] = useState(true);
  const [endValid, setEndValid] = useState(true);
  const [previewError, setPreviewError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [selectionId, setSelectionId] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const job = useRef<{ id: number; engine: VideoEngine | null }>({
    id: 0,
    engine: null,
  });
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const sourceUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result?.blob || null);
  const selectedSize = info ? outputSize(info, resolution) : null;
  let trimError = "";
  if (info) {
    try {
      validateTrim(start, end, info.duration);
    } catch (err) {
      trimError = (err as Error).message;
    }
  }
  const controlsDisabled = busy || !info || !!result;
  const canExport =
    !!info &&
    !!file &&
    !busy &&
    !result &&
    !trimError &&
    startValid &&
    endValid;

  useEffect(
    () => () => {
      job.current.id++;
      job.current.engine?.cancel();
    },
    [],
  );
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function run<T>(
    action: (
      engine: VideoEngine,
      report: (u: EngineUpdate) => void,
    ) => Promise<T>,
    done: (value: T) => void,
    failed?: () => void,
  ) {
    const id = ++job.current.id;
    setBusy(true);
    setError("");
    setNotice("");
    setUpdate({ stage: "loading" });
    try {
      const { VideoEngine } = await import("./media/engine");
      if (job.current.id !== id) return;
      const engine = new VideoEngine();
      job.current.engine = engine;
      const value = await action(engine, (u) => {
        if (job.current.id === id) setUpdate(u);
      });
      if (job.current.id === id) done(value);
    } catch (err) {
      if (job.current.id === id) {
        const text = err instanceof Error ? err.message : String(err);
        setError(
          /memory|out of bounds|allocation/i.test(text)
            ? "O navegador ficou sem memória. Tente um arquivo menor, feche outras abas e tente novamente."
            : /fetch|import|load|network/i.test(text)
              ? "Não foi possível carregar o motor. Confira a conexão e tente novamente."
              : /FS error|JSON/i.test(text)
                ? "Não foi possível ler este vídeo. O arquivo pode estar danificado ou usar um codec incompatível."
                : text,
        );
        failed?.();
      }
    } finally {
      if (job.current.id === id) {
        setBusy(false);
        setUpdate(null);
        job.current.engine = null;
      }
    }
  }
  function cancel() {
    job.current.id++;
    job.current.engine?.cancel();
    job.current.engine = null;
    setBusy(false);
    setUpdate(null);
    setNotice("Operação cancelada. A memória do processamento foi liberada.");
    if (!info) setFile(null);
  }
  function reset() {
    cancel();
    setSelectionId((value) => value + 1);
    video.current?.pause();
    setFile(null);
    setInfo(null);
    setResult(null);
    setError("");
    setNotice("");
    setPreviewError(false);
    setStart(0);
    setEnd(0);
    setCurrent(0);
    setPlaying(false);
    setStartValid(true);
    setEndValid(true);
    if (input.current) input.current.value = "";
  }
  function selectFiles(files: FileList | File[]) {
    if (busy) return;
    if (files.length !== 1) {
      setError("Selecione um único vídeo por vez.");
      return;
    }
    const selected = files[0];
    try {
      validateFile(selected);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    reset();
    setFile(selected);
    void run(
      (engine, report) => engine.inspect(selected, report),
      (metadata) => {
        setInfo(metadata);
        setEnd(metadata.duration);
        setStart(0);
      },
      () => {
        setFile(null);
        setInfo(null);
      },
    );
  }
  function previewTrim() {
    if (!video.current || !info || trimError) return;
    if (playing) {
      video.current.pause();
      return;
    }
    video.current.currentTime = start;
    void video.current
      .play()
      .catch(() =>
        setNotice(
          "Use o botão de reprodução do player para visualizar o trecho.",
        ),
      );
  }
  function exportVideo() {
    if (!canExport || !file) return;
    video.current?.pause();
    void run(
      (engine, report) =>
        engine.export(file, { start, end, preset, resolution }, report),
      setResult,
    );
  }
  return (
    <>
      <a className="skip-link" href="#editor">
        Ir para o editor
      </a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Baixaí, início">
          <span className="brand-mark">
            b<span>↓</span>
          </span>
          <span>BAIXAÍ</span>
        </a>
      </header>
      <main id="editor">
        <div className="page-heading">
          <div>
            <p className="kicker">SEU EDITOR DE BOLSO</p>
            <h1>
              Menos peso.
              <br />
              <span>Mais possibilidades.</span>
            </h1>
          </div>
          <p className="heading-note">
            Comprima, converta e corte.
            <br />
            Tudo no seu navegador.
          </p>
        </div>
        <nav className="steps" aria-label="Etapas">
          <span aria-current={!file ? "step" : undefined}>
            <b>01</b> Selecionar
          </span>
          <i />
          <span aria-current={file && !busy && !result ? "step" : undefined}>
            <b>02</b> Ajustar
          </span>
          <i />
          <span aria-current={busy ? "step" : undefined}>
            <b>03</b> Processar
          </span>
          <i />
          <span aria-current={result ? "step" : undefined}>
            <b>04</b> Baixar
          </span>
        </nav>
        <div className="workspace">
          <section className="media-panel" aria-label="Vídeo e corte">
            <div className="section-bar">
              <span>
                <Icon name="video" size={17} />{" "}
                {result ? "VÍDEO FINAL" : "SEU VÍDEO"}
              </span>
              {file && (
                <button className="text-button" onClick={reset} disabled={busy}>
                  Começar novamente <Icon name="close" size={15} />
                </button>
              )}
            </div>
            <input
              ref={input}
              className="sr-only"
              id="video-input"
              type="file"
              tabIndex={-1}
              accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
              aria-label="Selecionar vídeo"
              disabled={busy}
              onChange={(event) => {
                if (event.target.files?.length) selectFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {!file ? (
              <div
                className={`dropzone ${dragging ? "dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  selectFiles(event.dataTransfer.files);
                }}
              >
                <div className="upload-mark">
                  <Icon name="upload" size={32} />
                </div>
                <h2>
                  Seu próximo vídeo
                  <br />
                  começa aqui.
                </h2>
                <p>Arraste um arquivo para esta área</p>
                <button
                  className="primary select-button"
                  onClick={() => input.current?.click()}
                >
                  Selecionar vídeo <Icon name="arrow" />
                </button>
                <span className="formats">MP4 · MOV · WEBM</span>
              </div>
            ) : (
              <>
                <div
                  className={`player-wrap ${info && info.height > info.width ? "portrait" : ""}`}
                >
                  <video
                    key={result ? "result" : sourceUrl}
                    ref={video}
                    src={result ? resultUrl : sourceUrl}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={
                      result
                        ? "Prévia do vídeo final"
                        : "Prévia do vídeo original"
                    }
                    onError={() => setPreviewError(true)}
                    onLoadedMetadata={() => setPreviewError(false)}
                    onPlay={() => {
                      setPlaying(true);
                      if (
                        !result &&
                        video.current &&
                        (video.current.currentTime < start ||
                          video.current.currentTime >= end)
                      )
                        video.current.currentTime = start;
                    }}
                    onPause={() => setPlaying(false)}
                    onTimeUpdate={(event) => {
                      const player = event.currentTarget;
                      setCurrent(player.currentTime);
                      if (
                        !result &&
                        info &&
                        player.currentTime >= end &&
                        !player.paused
                      ) {
                        player.pause();
                        player.currentTime = end;
                      }
                    }}
                  />
                  {previewError && (
                    <p className="preview-unavailable">
                      A prévia deste codec não está disponível neste navegador.
                      Você ainda pode tentar converter o arquivo para MP4.
                    </p>
                  )}
                  {busy && (
                    <span className="player-badge">Processamento local</span>
                  )}
                </div>
                <div className="file-strip">
                  <Icon name="video" />
                  <div>
                    <strong title={file.name}>
                      {result ? outputName(file.name) : file.name}
                    </strong>
                    <p>
                      {formatBytes(result?.blob.size || file.size)}
                      {(result?.info || info) && (
                        <>
                          {" "}
                          <span>·</span> {(result?.info || info)!.width} ×{" "}
                          {(result?.info || info)!.height} <span>·</span>{" "}
                          {formatTime((result?.info || info)!.duration)}
                          {!(result?.info || info)!.hasAudio && " · Sem áudio"}
                        </>
                      )}
                    </p>
                  </div>
                  <span className="file-tag">
                    {result ? "MP4" : file.name.split(".").pop()?.toUpperCase()}
                  </span>
                </div>
              </>
            )}
            <div className={`trim-section ${!info ? "inactive" : ""}`}>
              <div className="trim-title">
                <h2>
                  <Icon name="cut" size={19} /> Corte na medida
                </h2>
                <span>
                  {info
                    ? `${formatTime(Math.max(0, end - start))} selecionados`
                    : "Selecione um vídeo para ajustar"}
                </span>
              </div>
              <div
                className="timeline"
                style={
                  {
                    "--start": `${info ? (start / info.duration) * 100 : 0}%`,
                    "--end": `${info ? (end / info.duration) * 100 : 100}%`,
                    "--head": `${info ? (current / info.duration) * 100 : 0}%`,
                  } as CSSProperties
                }
              >
                <div className="timeline-track">
                  <div className="timeline-selection" />
                  {info && <div className="playhead" />}
                </div>
                <div className="range-row">
                  <label>
                    Início
                    <input
                      aria-label="Marcador de início"
                      type="range"
                      min="0"
                      max={info?.duration || 1}
                      step="0.1"
                      value={start}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setStart(
                          Math.min(
                            Number(event.target.value),
                            Math.max(0, end - 0.1),
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      aria-label="Marcador de fim"
                      type="range"
                      min="0"
                      max={info?.duration || 1}
                      step="0.1"
                      value={end}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setEnd(
                          Math.max(Number(event.target.value), start + 0.1),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="timeline-labels">
                  <span>00:00.0</span>
                  <span>{info ? formatTime(info.duration) : "--:--"}</span>
                </div>
              </div>
              <div className="time-controls" key={selectionId}>
                <TimeField
                  label="Início"
                  value={start}
                  disabled={controlsDisabled}
                  onChange={setStart}
                  onValidity={setStartValid}
                />
                <span className="time-separator">→</span>
                <TimeField
                  label="Fim"
                  value={end}
                  disabled={controlsDisabled}
                  onChange={setEnd}
                  onValidity={setEndValid}
                />
                <button
                  className="secondary preview-button"
                  disabled={
                    controlsDisabled ||
                    !!trimError ||
                    !startValid ||
                    !endValid ||
                    previewError
                  }
                  onClick={previewTrim}
                >
                  <Icon name="play" size={16} />{" "}
                  {playing ? "Pausar" : "Ver trecho"}
                </button>
              </div>
              <p id="time-help" className="fine-print">
                Tempo em mm:ss.d. Use as setas do teclado nos marcadores.
              </p>
              {trimError && (
                <p className="inline-error" role="alert">
                  {trimError}
                </p>
              )}
            </div>
          </section>
          <aside
            className="settings-panel"
            aria-label="Configurações de exportação"
          >
            <div className="section-bar">
              <span>AJUSTES DE EXPORTAÇÃO</span>
              <span className="small-dot" />
            </div>
            {result ? (
              <section className="result">
                <span className="success-icon">
                  <Icon name="check" size={30} />
                </span>
                <p className="kicker">TUDO PRONTO</p>
                <h2 ref={resultHeading} tabIndex={-1}>
                  Um novo vídeo.
                  <br />
                  Todo seu.
                </h2>
                <dl className="comparison">
                  <div>
                    <dt>Original</dt>
                    <dd>{formatBytes(file!.size)}</dd>
                  </div>
                  <div>
                    <dt>Final</dt>
                    <dd>{formatBytes(result.blob.size)}</dd>
                  </div>
                </dl>
                <p className="size-change">
                  {result.blob.size < file!.size
                    ? `${((1 - result.blob.size / file!.size) * 100).toFixed(1)}% menor que o original`
                    : "O resultado não ficou menor que o original."}
                </p>
                <p>
                  {formatTime(result.info.duration)} · {result.info.width} ×{" "}
                  {result.info.height}
                  <br />
                  MP4 · {formatTime(result.elapsed)} para processar
                </p>
                <a
                  className="primary"
                  href={resultUrl || undefined}
                  download={outputName(file!.name)}
                >
                  Baixar MP4 <Icon name="arrow" />
                </a>
                <button
                  className="secondary"
                  onClick={() => {
                    setResult(null);
                    setCurrent(0);
                    setNotice("");
                    setPreviewError(false);
                  }}
                >
                  Ajustar novamente
                </button>
              </section>
            ) : (
              <div className="settings-body">
                <fieldset disabled={controlsDisabled}>
                  <legend>
                    01 <span>Compressão</span>
                  </legend>
                  <div className="preset-options">
                    {Object.entries(PRESETS).map(([key, item], index) => (
                      <label
                        className={`preset ${preset === key ? "selected" : ""}`}
                        key={key}
                      >
                        <input
                          type="radio"
                          name="preset"
                          value={key}
                          checked={preset === key}
                          onChange={() => setPreset(key as Preset)}
                        />
                        <span className="preset-icon" aria-hidden="true">
                          {Array.from({ length: 3 }, (_, i) => (
                            <i className={i <= index ? "filled" : ""} key={i} />
                          ))}
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <span className="radio-visual" />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="resolution">
                  <label htmlFor="resolution">
                    <b>02</b> Resolução
                  </label>
                  <select
                    id="resolution"
                    aria-label="Resolução"
                    disabled={controlsDisabled}
                    value={resolution}
                    onChange={(event) =>
                      setResolution(event.target.value as Resolution)
                    }
                  >
                    <option value="original">Manter a original</option>
                    <option value="720">Até 720p</option>
                    <option value="480">Até 480p</option>
                  </select>
                  <p className="fine-print">
                    {selectedSize
                      ? `${selectedSize.width} × ${selectedSize.height} px · proporção preservada`
                      : "A orientação do vídeo é preservada."}
                  </p>
                </div>
                <div className="output-format">
                  <span>Formato de saída</span>
                  <strong>
                    MP4 <Icon name="check" size={16} />
                  </strong>
                </div>
                <p className="fine-print codec-note">Vídeo H.264 · áudio AAC</p>
                {busy && update ? (
                  <div className="processing" role="status" aria-live="polite">
                    <span className="processing-dot" />
                    <strong>{stageLabels[update.stage]}</strong>
                    <progress
                      aria-label="Progresso da exportação"
                      max="1"
                      value={update.progress}
                    />
                    <span>
                      {update.progress === undefined
                        ? "Esta etapa pode levar alguns instantes."
                        : `${Math.round(update.progress * 100)}% · estimativa`}
                    </span>
                    <button className="secondary" onClick={cancel}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    className="primary export-button"
                    onClick={exportVideo}
                    disabled={!canExport}
                  >
                    Exportar vídeo <Icon name="arrow" />
                  </button>
                )}
                <p className="size-note">
                  Um vídeo já comprimido pode não ficar menor. Você confere o
                  tamanho final antes de baixar.
                </p>
              </div>
            )}
          </aside>
        </div>
        {error && (
          <div className="feedback error" role="alert">
            <strong>Não deu para continuar.</strong> {error}
            <button aria-label="Fechar mensagem" onClick={() => setError("")}>
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {notice && (
          <p className="feedback" role="status">
            {notice}
          </p>
        )}
        <p className="limits">
          Versão experimental · até 100 MB, 3 minutos e 1080p · um arquivo por
          vez.
          <br />O desempenho depende do dispositivo. Compatibilidade em
          celulares ainda em validação.
        </p>
      </main>
      <footer>
        <span>BAIXAÍ © {new Date().getFullYear()}</span>
        <a href="/licenses.html">
          Tecnologia e licenças <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </>
  );
}
