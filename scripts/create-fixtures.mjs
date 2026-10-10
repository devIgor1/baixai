import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
await mkdir(".fixtures", { recursive: true });
const cases = [
  ["landscape.mp4", "1280x720", "12", true, "libx264"],
  ["portrait.mp4", "360x640", "4", false, "libx264"],
  ["sample.webm", "640x360", "4", true, "libvpx"],
  ["sample.mov", "640x360", "4", true, "libx264"],
  ["fullhd.mp4", "1920x1080", "10", true, "libx264"],
];
for (const [name, size, duration, audio, codec] of cases) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${size}:rate=24`,
  ];
  if (audio)
    args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000");
  args.push("-t", duration, "-c:v", codec, "-pix_fmt", "yuv420p");
  if (codec === "libx264") args.push("-preset", "ultrafast", "-crf", "20");
  else args.push("-b:v", "700k");
  if (audio) args.push("-c:a", codec === "libvpx" ? "libvorbis" : "aac");
  args.push(`.fixtures/${name}`);
  execFileSync(ffmpeg, args, { stdio: "inherit" });
}
execFileSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-display_rotation:v:0",
    "90",
    "-i",
    ".fixtures/sample.mov",
    "-c",
    "copy",
    ".fixtures/rotated.mov",
  ],
  { stdio: "inherit" },
);
await writeFile(".fixtures/corrupt.mp4", "This is deliberately not a video.");
console.log("Vídeos sintéticos preparados; nenhum vídeo pessoal é usado.");
