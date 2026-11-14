import { describe, expect, it } from "vitest";

import { inspectRaster, sniffType } from "../../src/images/sniff";
import { apng, concat, jpeg, png, pngChunk, PNG_SIGNATURE, vp8, webpExtended, WEBP_FLAGS, webpLossless, webpLossy } from "../harness/images";

const text = (s: string) => new TextEncoder().encode(s);

describe("sniffType", () => {
  it("reads the type from the signature", () => {
    expect(sniffType(png())).toBe("image/png");
    expect(sniffType(jpeg())).toBe("image/jpeg");
    expect(sniffType(webpLossy())).toBe("image/webp");
    expect(sniffType(text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
  });

  it("refuses misleading or unknown signatures", () => {
    expect(sniffType(text("<html><body>hi</body></html>"))).toBeNull();
    expect(sniffType(text("GIF89a"))).toBeNull();
    expect(sniffType(concat(text("RIFF"), [0, 0, 0, 0], text("WAVE")))).toBeNull();
    expect(sniffType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffType(Uint8Array.from([0xff, 0xfe, 0x3c, 0x00, 0x73, 0x00]))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe("inspectRaster", () => {
  it("reads the size of a PNG from IHDR", () => {
    expect(inspectRaster(png({ width: 300, height: 120 }), "image/png")).toEqual({ ok: true, width: 300, height: 120 });
  });

  it("refuses an animated PNG", () => {
    expect(inspectRaster(apng(), "image/png")).toEqual({ ok: false, reason: "animated" });
  });

  it("refuses a PNG without IHDR first, without IDAT or cut short", () => {
    const noIhdr = concat(PNG_SIGNATURE, pngChunk("IDAT", [1]), pngChunk("IEND"));
    expect(inspectRaster(noIhdr, "image/png")).toEqual({ ok: false, reason: "unreadable" });
    const full = png();
    expect(inspectRaster(full.subarray(0, full.length - 6), "image/png")).toEqual({ ok: false, reason: "unreadable" });
    expect(inspectRaster(full.subarray(0, 20), "image/png")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("reads the size of baseline and progressive JPEGs from SOF", () => {
    expect(inspectRaster(jpeg({ width: 640, height: 480 }), "image/jpeg")).toEqual({ ok: true, width: 640, height: 480 });
    expect(inspectRaster(jpeg({ width: 33, height: 44, progressive: true }), "image/jpeg")).toEqual({ ok: true, width: 33, height: 44 });
  });

  it("refuses a JPEG cut short", () => {
    const full = jpeg();
    expect(inspectRaster(full.subarray(0, full.length - 2), "image/jpeg")).toEqual({ ok: false, reason: "unreadable" });
    expect(inspectRaster(full.subarray(0, 30), "image/jpeg")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("reads the size of each WebP variant", () => {
    expect(inspectRaster(webpLossy(100, 50), "image/webp")).toEqual({ ok: true, width: 100, height: 50 });
    expect(inspectRaster(webpLossless(2048, 1), "image/webp")).toEqual({ ok: true, width: 2048, height: 1 });
    expect(inspectRaster(webpExtended({ width: 1000, height: 700 }), "image/webp")).toEqual({ ok: true, width: 1000, height: 700 });
  });

  it("refuses an animated WebP, by its flag or its chunks", () => {
    expect(inspectRaster(webpExtended({ flags: WEBP_FLAGS.animation }), "image/webp")).toEqual({ ok: false, reason: "animated" });
    const anim = concat(text("ANIM"), [6, 0, 0, 0], [0, 0, 0, 0, 0, 0]);
    expect(inspectRaster(webpExtended({ chunks: [anim] }), "image/webp")).toEqual({ ok: false, reason: "animated" });
  });

  it("refuses a WebP cut short or without bitstream", () => {
    const full = webpLossy();
    expect(inspectRaster(full.subarray(0, full.length - 3), "image/webp")).toEqual({ ok: false, reason: "unreadable" });
    expect(inspectRaster(webpExtended({ bitstream: new Uint8Array() }), "image/webp")).toEqual({ ok: false, reason: "unreadable" });
    const badStart = vp8();
    badStart[8 + 3] = 0;
    const riff = concat(text("RIFF"), [badStart.length + 4, 0, 0, 0], text("WEBP"), badStart);
    expect(inspectRaster(riff, "image/webp")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses a side over 2048 px, and an empty side", () => {
    expect(inspectRaster(png({ width: 2049, height: 10 }), "image/png")).toEqual({ ok: false, reason: "dimensions" });
    expect(inspectRaster(jpeg({ width: 10, height: 2049 }), "image/jpeg")).toEqual({ ok: false, reason: "dimensions" });
    expect(inspectRaster(webpExtended({ width: 4000, height: 10 }), "image/webp")).toEqual({ ok: false, reason: "dimensions" });
    expect(inspectRaster(png({ width: 2048, height: 2048 }), "image/png")).toEqual({ ok: true, width: 2048, height: 2048 });
    expect(inspectRaster(png({ width: 0, height: 10 }), "image/png")).toEqual({ ok: false, reason: "unreadable" });
  });
});
