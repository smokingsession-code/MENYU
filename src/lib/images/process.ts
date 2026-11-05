import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMAGE_WIDTHS, type ImageDescriptor, type ImageKind } from "./shared";

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

const QUALITY: Record<ImageKind, number> = { item: 72, cover: 70, logo: 85 };
/** Refuse decompression bombs: 40 megapixels is plenty for a phone photo. */
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Turns an uploaded photo into WebP variants: fixes rotation from EXIF,
 * applies the crop, strips metadata (including GPS), and resizes to each
 * width without enlarging.
 */
export async function renderVariants(input: Buffer, kind: ImageKind, crop?: Crop) {
  let pipeline = sharp(input, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  if (crop) {
    pipeline = pipeline.extract({
      left: Math.max(0, Math.round(crop.x)),
      top: Math.max(0, Math.round(crop.y)),
      width: Math.max(1, Math.round(crop.width)),
      height: Math.max(1, Math.round(crop.height)),
    });
  }
  const base = await pipeline.toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;

  const widths = IMAGE_WIDTHS[kind].filter((w, i) => i === 0 || w <= width);
  const variants = await Promise.all(
    widths.map(async (w) => ({
      width: w,
      buffer: await sharp(base.data)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: QUALITY[kind], effort: 4 })
        .toBuffer(),
    })),
  );

  const { dominant } = await sharp(base.data).stats();
  const color = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return { width, height, color, variants };
}

/** Processes and uploads an image; returns the descriptor to store. */
export async function storeImage(
  storage: SupabaseClient,
  restaurantId: string,
  kind: ImageKind,
  input: Buffer,
  crop?: Crop,
): Promise<ImageDescriptor> {
  const { width, height, color, variants } = await renderVariants(input, kind, crop);
  const path = `${restaurantId}/${kind}/${randomUUID()}`;
  for (const v of variants) {
    const { error } = await storage.storage.from("images").upload(`${path}-${v.width}.webp`, v.buffer, {
      contentType: "image/webp",
      // File names are unique per upload, so browsers may cache them forever.
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error(`Image upload failed: ${error.message}`);
  }
  return { path, w: width, h: height, widths: variants.map((v) => v.width), color };
}
