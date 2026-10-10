import { describe, it, expect } from "vitest";
import {
  formatTime,
  parseTime,
  outputSize,
  outputName,
  validateFile,
  validateInfo,
  validateTrim,
  LIMITS,
  exportArgs,
} from "./settings";
const landscape = { width: 1920, height: 1080, duration: 180, hasAudio: true };
describe("input limits and dimensions", () => {
  it("accepts full-HD portrait and rejects 4K, excessive duration and invalid metadata", () => {
    expect(() =>
      validateInfo({ ...landscape, width: 1080, height: 1920 }),
    ).not.toThrow();
    expect(() =>
      validateInfo({ ...landscape, width: 3840, height: 2160 }),
    ).toThrow("1080p");
    expect(() => validateInfo({ ...landscape, duration: 181 })).toThrow(
      "três minutos",
    );
    expect(() => validateInfo({ ...landscape, duration: Infinity })).toThrow();
    expect(() => validateInfo({ ...landscape, width: 0 })).toThrow();
    expect(() => validateInfo({ ...landscape, width: -10 })).toThrow();
    expect(() => validateInfo({ ...landscape, width: NaN })).toThrow();
  });
  it("rejects oversized, empty and unsupported files before allocating media memory", () => {
    expect(() =>
      validateFile({ name: "video.MOV", size: LIMITS.bytes }),
    ).not.toThrow();
    expect(() =>
      validateFile({ name: "video.mp4", size: LIMITS.bytes + 1 }),
    ).toThrow("100 MB");
    expect(() => validateFile({ name: "video.mp4", size: 0 })).toThrow("vazio");
    expect(() => validateFile({ name: "script.html", size: 1 })).toThrow("MP4");
  });
  it("scales without upscaling or changing orientation and produces even pixels", () => {
    expect(outputSize(landscape, "720")).toEqual({ width: 1280, height: 720 });
    expect(
      outputSize({ ...landscape, width: 1080, height: 1920 }, "720"),
    ).toEqual({ width: 720, height: 1280 });
    expect(
      outputSize({ ...landscape, width: 321, height: 181 }, "720"),
    ).toEqual({ width: 320, height: 180 });
    expect(
      outputSize({ ...landscape, width: 1080, height: 1080 }, "480"),
    ).toEqual({ width: 480, height: 480 });
  });
});
describe("trim controls and names", () => {
  it("rejects reversed, empty, out-of-range and nonfinite cuts", () => {
    for (const [start, end] of [
      [5, 2],
      [1, 1],
      [-1, 2],
      [0, 20],
      [NaN, 2],
    ])
      expect(() => validateTrim(start, end, 10)).toThrow();
    expect(() => validateTrim(1.5, 2.5, 10)).not.toThrow();
    expect(() => validateTrim(0.2, 0.3, 10)).not.toThrow();
  });
  it("parses decimal seconds and clock times, including rounding at minute boundaries", () => {
    expect(parseTime("01:02,5")).toBe(62.5);
    expect(parseTime("1.5")).toBe(1.5);
    expect(parseTime("01:99")).toBeNaN();
    expect(parseTime("")).toBeNaN();
    expect(formatTime(59.99)).toBe("01:00.0");
  });
  it("preserves a usable file name without path separators", () => {
    expect(outputName("Meu vídeo.MOV")).toBe("Meu vídeo-baixai.mp4");
    expect(outputName("../teste?.mp4")).not.toContain("/");
  });
  it("combines precise output seeking, scaling and the selected compression profile", () => {
    const settings = {
      start: 1.2,
      end: 3.5,
      resolution: "480" as const,
      preset: "small" as const,
    };
    const args = exportArgs(landscape, settings);
    expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
    expect(args[args.indexOf("-ss") + 1]).toBe("1.200");
    expect(args[args.indexOf("-t") + 1]).toBe("2.300");
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=852:480,setsar=1");
    expect(args[args.indexOf("-crf") + 1]).toBe("32");
    expect(args).toContain("0:a:0?");
    expect(args).toContain("+faststart");
    expect(args.at(-1)).toBe("output.mp4");
  });
});
