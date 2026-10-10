import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";

async function select(page: Page, filename: string) {
  await page
    .getByLabel("Selecionar vídeo", { exact: true })
    .setInputFiles(`.fixtures/${filename}`);
  await expect(
    page.getByRole("button", { name: "Exportar vídeo" }),
  ).toBeEnabled({ timeout: 30_000 });
}
async function trim(page: Page, start: string, end: string) {
  await page.getByRole("textbox", { name: "Início", exact: true }).fill(start);
  await page.getByRole("textbox", { name: "Fim", exact: true }).fill(end);
  await page.getByRole("textbox", { name: "Fim", exact: true }).press("Tab");
}
async function exportFile(page: Page, testInfo: TestInfo) {
  await page.getByRole("button", { name: "Exportar vídeo" }).click();
  await expect(page.getByRole("link", { name: "Baixar MP4" })).toBeVisible({
    timeout: 90_000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar MP4" }).click();
  const download = await downloadPromise;
  const destination = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(destination);
  // Native ffmpeg is a test-only independent decoder, never part of the application.
  const probe = spawnSync(
    ffmpeg!,
    [
      "-hide_banner",
      "-i",
      destination,
      "-vf",
      "showinfo",
      "-af",
      "ashowinfo",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  expect(probe.status, probe.stderr).toBe(0);
  expect(probe.stderr).toMatch(/Video: h264/);
  const video = [
    ...probe.stderr.matchAll(/Parsed_showinfo[^\n]*pts_time:([\d.-]+)/g),
  ].map((match) => Number(match[1]));
  const audio = [
    ...probe.stderr.matchAll(/Parsed_ashowinfo[^\n]*pts_time:([\d.-]+)/g),
  ].map((match) => Number(match[1]));
  expect(video.length).toBeGreaterThan(0);
  expect(video[0]).toBeCloseTo(0, 1);
  if (audio.length) {
    expect(probe.stderr).toMatch(/Audio: aac/);
    expect(Math.abs(audio[0] - video[0])).toBeLessThan(0.1);
    expect(Math.abs(audio.at(-1)! - video.at(-1)!)).toBeLessThan(0.15);
  }
  await expect.poll(() => page.workers().length).toBe(0);
  return { destination, video, audio, probe: probe.stderr };
}

test("MP4 export trims/scales with audio, stays responsive and sends no video over the network", async ({
  page,
  context,
}, testInfo) => {
  const requests: { url: string; method: string; bytes: number }[] = [];
  context.on("request", (req) =>
    requests.push({
      url: req.url(),
      method: req.method(),
      bytes: req.postDataBuffer()?.length || 0,
    }),
  );
  await page.goto("/");
  expect(requests.some((req) => req.url.includes("/engine/"))).toBe(false);
  await select(page, "landscape.mp4");
  await trim(page, "1", "3");
  await page.getByLabel("Resolução", { exact: true }).selectOption("480");
  const result = await exportFile(page, testInfo);
  expect(result.audio.length).toBeGreaterThan(0);
  expect(result.video.at(-1)).toBeCloseTo(2 - 1 / 24, 2);
  // Compare decoded frames with the exact source interval, independently of timestamps.
  const comparison = spawnSync(
    ffmpeg!,
    [
      "-hide_banner",
      "-i",
      ".fixtures/landscape.mp4",
      "-i",
      result.destination,
      "-filter_complex",
      "[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS,scale=852:480,setsar=1[ref];[1:v]setpts=PTS-STARTPTS[out];[ref][out]ssim",
      "-an",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  expect(comparison.status, comparison.stderr).toBe(0);
  expect(Number(comparison.stderr.match(/All:([\d.]+)/)?.[1])).toBeGreaterThan(
    0.97,
  );
  await expect(page.getByLabel("Configurações de exportação")).toContainText(
    "00:02.0 · 852 × 480",
  );
  expect(
    requests.filter((req) => req.method !== "GET" || req.bytes > 0),
  ).toEqual([]);
  expect(
    requests.filter(
      (req) =>
        !req.url.startsWith("blob:") &&
        // The browser's own download panel makes local edge:// requests. These
        // are not application traffic; every HTTP(S) request is still checked.
        !req.url.startsWith("edge://") &&
        !req.url.startsWith("http://127.0.0.1:4176/"),
    ),
  ).toEqual([]);
  console.log(
    JSON.stringify({
      browser: testInfo.project.name,
      export: await page.locator(".result").innerText(),
      downloaded: result.destination,
      requests: requests.length,
    }),
  );
});

for (const [name, text] of [
  ["portrait.mp4", "360 × 640"],
  ["sample.webm", "640 × 360"],
  ["sample.mov", "640 × 360"],
  ["rotated.mov", "360 × 640"],
] as const) {
  test(`converts ${name}, preserving orientation and audio presence`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await select(page, name);
    if (name === "portrait.mp4")
      await expect(page.locator(".file-strip")).toContainText("Sem áudio");
    const result = await exportFile(page, testInfo);
    expect(result.audio.length > 0).toBe(name !== "portrait.mp4");
    const dimensions = text.replace(" × ", "x");
    expect(result.probe).toContain(dimensions);
    await expect(page.locator(".result")).toContainText(text);
    if (name === "portrait.mp4")
      await expect(page.locator(".file-strip")).toContainText("Sem áudio");
  });
}

test("cancel during encode releases the worker and permits another export", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await select(page, "fullhd.mp4");
  await page.getByLabel("Resolução", { exact: true }).selectOption("original");
  await page.getByRole("button", { name: "Exportar vídeo" }).click();
  await expect(
    page.getByText("Processando seu vídeo…", { exact: true }),
  ).toBeVisible();
  const before = Date.now();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(Date.now() - before).toBeLessThan(3000);
  await expect(
    page.getByRole("button", { name: "Exportar vídeo" }),
  ).toBeEnabled();
  await expect.poll(() => page.workers().length).toBe(0);
  await trim(page, "0", "1");
  await page.getByLabel("Resolução", { exact: true }).selectOption("480");
  await exportFile(page, testInfo);
  await expect(page.locator(".result")).toContainText("00:01.0");
});

test("bad files and invalid trims are recoverable; keyboard controls work", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Selecionar vídeo", { exact: true })
    .setInputFiles(".fixtures/corrupt.mp4");
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });
  await select(page, "portrait.mp4");
  await trim(page, "3", "1");
  await expect(
    page.getByRole("button", { name: "Exportar vídeo" }),
  ).toBeDisabled();
  await trim(page, "0", "3");
  await page.getByLabel("Marcador de início").press("ArrowRight");
  await expect(
    page.getByRole("textbox", { name: "Início", exact: true }),
  ).toHaveValue("00:00.1");
  await expect(
    page.getByRole("button", { name: "Exportar vídeo" }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Início", exact: true })
    .fill("inválido");
  await expect(
    page.getByRole("button", { name: "Exportar vídeo" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Começar novamente" }).click();
  await select(page, "portrait.mp4");
  await expect(
    page.getByRole("textbox", { name: "Início", exact: true }),
  ).toHaveValue("00:00.0");
});

test("cancel during lazy loading does not leave a stale operation", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/engine/ffmpeg-core.wasm", async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto("/");
  const blockedRequest = page.waitForRequest("**/engine/ffmpeg-core.wasm");
  await page
    .getByLabel("Selecionar vídeo", { exact: true })
    .setInputFiles(".fixtures/portrait.mp4");
  await blockedRequest;
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  release();
  await page.unroute("**/engine/ffmpeg-core.wasm");
  await expect.poll(() => page.workers().length).toBe(0);
  await expect(page.locator("button.select-button")).toBeVisible();
  await select(page, "portrait.mp4");
  await expect.poll(() => page.workers().length).toBe(0);
});

test("mobile layout fits 390px and remains usable at 200% text size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/mobile-empty.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Text-only enlargement, distinct from physical device performance testing.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("button.select-button")).toBeVisible();
});
