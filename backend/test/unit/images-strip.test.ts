import { describe, expect, it } from "vitest";

import { inspectRaster, jpegSegments, pngChunks, webpChunks } from "../../src/images/sniff";
import { stripMetadata } from "../../src/images/strip";
import {
  concat,
  iccp,
  includes,
  jpeg,
  jpegComment,
  jpegExif,
  jpegIcc,
  jpegIptc,
  jpegXmp,
  png,
  pngChunk,
  webpExif,
  webpExtended,
  WEBP_FLAGS,
  webpHeader,
  webpIcc,
  webpXmp,
} from "../harness/images";

const text = (s: string) => new TextEncoder().encode(s);

describe("stripMetadata", () => {
  it("removes the text, Exif and time chunks of a PNG and keeps its ICC profile", () => {
    const source = png({
      before: [iccp(), pngChunk("tEXt", text("Author\0Jane")), pngChunk("eXIf", text("GPS")), pngChunk("tIME", [7, 0xe9, 1, 1, 0, 0, 0])],
      after: [pngChunk("zTXt", text("Comment\0\0x")), pngChunk("iTXt", text("XML:com.adobe.xmp\0\0\0\0\0secret"))],
    });
    const out = stripMetadata(source, "image/png")!;
    expect(pngChunks(out)!.map((c) => c.type)).toEqual(["IHDR", "iCCP", "IDAT", "IEND"]);
    for (const secret of ["Jane", "GPS", "secret", "Comment"]) expect(includes(out, secret)).toBe(false);
    expect(inspectRaster(out, "image/png")).toEqual({ ok: true, width: 16, height: 16 });
  });

  it("drops what follows IEND", () => {
    const out = stripMetadata(concat(png(), text("appended secret")), "image/png")!;
    expect(out).toEqual(png());
  });

  it("removes APP1, APP13 and COM from a JPEG and keeps APP0, the ICC profile and every scan", () => {
    const source = jpeg({ progressive: true, extra: [jpegExif(), jpegXmp(), jpegIcc(), jpegIptc(), jpegComment()], trailing: [...text("tail")] });
    const out = stripMetadata(source, "image/jpeg")!;
    const types = jpegSegments(out)!.map((s) => s.type);
    expect(types).toEqual(["d8", "e0", "e2", "db", "c2", "c4", "da", "c4", "da", "d9"]);
    for (const secret of ["GPS", "xmpmeta", "IPTC", "taken at home", "tail"]) expect(includes(out, secret)).toBe(false);
    expect(includes(out, "ICC_PROFILE")).toBe(true);
    expect(out).toEqual(jpeg({ progressive: true, extra: [jpegIcc()] }));
  });

  it("removes EXIF and XMP from a WebP, clears their VP8X flags and fixes the RIFF size", () => {
    const flags = WEBP_FLAGS.icc | WEBP_FLAGS.exif | WEBP_FLAGS.xmp | WEBP_FLAGS.alpha;
    const source = webpExtended({ flags, chunks: [webpIcc(), webpExif(), webpXmp()] });
    const out = stripMetadata(source, "image/webp")!;
    expect(webpChunks(out)!.map((c) => c.type)).toEqual(["VP8X", "ICCP", "VP8 "]);
    expect(webpHeader(out)).toEqual({ flags: WEBP_FLAGS.icc | WEBP_FLAGS.alpha, riffSize: out.length - 8 });
    for (const secret of ["GPS", "secret"]) expect(includes(out, secret)).toBe(false);
    expect(out).toEqual(webpExtended({ flags: WEBP_FLAGS.icc | WEBP_FLAGS.alpha, chunks: [webpIcc()] }));
  });

  it("leaves an image without metadata unchanged", () => {
    for (const [bytes, type] of [
      [png(), "image/png"],
      [jpeg(), "image/jpeg"],
      [webpExtended(), "image/webp"],
    ] as const) {
      expect(stripMetadata(bytes, type)).toEqual(bytes);
    }
  });
});
