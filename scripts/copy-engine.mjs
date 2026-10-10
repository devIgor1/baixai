import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(resolve(root, "public/engine"), { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await cp(
    resolve(root, "node_modules/@ffmpeg/core/dist/esm", file),
    resolve(root, "public/engine", file),
  );
}
await cp(
  resolve(root, "node_modules/@ffmpeg/core/package.json"),
  resolve(root, "public/engine/package.json"),
);
await mkdir(resolve(root, "public/licenses"), { recursive: true });
for (const [packageName, filename] of [
  ["react", "react-MIT.txt"],
  ["react-dom", "react-dom-MIT.txt"],
  ["scheduler", "scheduler-MIT.txt"],
  ["@fontsource/archivo-black", "archivo-black-OFL.txt"],
  ["@fontsource/dm-mono", "dm-mono-OFL.txt"],
]) {
  await cp(
    resolve(root, "node_modules", packageName, "LICENSE"),
    resolve(root, "public/licenses", filename),
  );
}
console.log("Motor local preparado em public/engine (sem CDN).");
