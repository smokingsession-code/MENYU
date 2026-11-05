import "server-only";
import sharp from "sharp";
import type { ImportFile } from "./extract";

/**
 * Gets uploaded menu files ready for Claude. Photos are turned upright from
 * their EXIF data and scaled to the most detail the model can use (2576 px on
 * the long side, 3.75 megapixels); larger images are scaled down by the API
 * anyway, so sending more only costs upload time. PDFs go as they are.
 */
const MAX_SIDE = 2576;
const MAX_PIXELS = 3_750_000;
/** Refuse decompression bombs. Phone cameras produce 12 to 50 megapixels. */
const MAX_INPUT_PIXELS = 60_000_000;
const READABLE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "tiff", "heif"]);

export type PrepareResult = { ok: true; file: ImportFile } | { ok: false; reason: "unsupported" | "damaged" };

export function isPdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** iPhone HEIC photos. sharp's prebuilt binaries cannot decode the HEVC codec they use. */
export function isHeic(data: Buffer): boolean {
  if (data.subarray(4, 8).toString("latin1") !== "ftyp") return false;
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(data.subarray(8, 12).toString("latin1"));
}

/** Largest long side that keeps the image within both of the model's limits. */
export function targetLongSide(width: number, height: number): number {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  return Math.floor(Math.max(width, height) * scale);
}

export async function prepareFile(data: Buffer, declaredType: string): Promise<PrepareResult> {
  if (isPdf(data)) return { ok: true, file: { mime: "application/pdf", data } };
  if (declaredType === "application/pdf") return { ok: false, reason: "damaged" };
  try {
    const meta = await sharp(data, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!meta.format || !READABLE_FORMATS.has(meta.format) || !meta.width || !meta.height) {
      return { ok: false, reason: isHeic(data) ? "unsupported" : "damaged" };
    }
    const side = targetLongSide(meta.width, meta.height);
    const output = await sharp(data, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { ok: true, file: { mime: "image/jpeg", data: output } };
  } catch {
    return { ok: false, reason: isHeic(data) ? "unsupported" : "damaged" };
  }
}
