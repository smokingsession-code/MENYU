/**
 * Image descriptors stored in the database (items.photo, restaurants.logo,
 * restaurants.cover). Every image is stored as a few WebP widths so phones
 * download only what they need:
 *   images/{path}-{width}.webp
 * Safe to import in the browser.
 */
export interface ImageDescriptor {
  /** "{restaurantId}/{kind}/{id}" without width or extension. */
  path: string;
  w: number;
  h: number;
  widths: number[];
  /** Dominant colour, shown while the image loads (no layout jumps). */
  color: string;
}

export const IMAGE_WIDTHS = {
  item: [160, 320, 640],
  cover: [480, 960, 1440],
  logo: [96, 192, 384],
} as const;

export type ImageKind = keyof typeof IMAGE_WIDTHS;

const BUCKET = "images";

function base(): string {
  return `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}`;
}

export function imageUrl(image: ImageDescriptor, width: number): string {
  return `${base()}/${image.path}-${width}.webp`;
}

export function imageSrcSet(image: ImageDescriptor): string {
  return image.widths.map((w) => `${imageUrl(image, w)} ${w}w`).join(", ");
}

/** The smallest stored width that covers `cssWidth` at 2x density. */
export function pickWidth(image: ImageDescriptor, cssWidth: number): number {
  const target = cssWidth * 2;
  return image.widths.find((w) => w >= target) ?? image.widths[image.widths.length - 1];
}

export function isImageDescriptor(value: unknown): value is ImageDescriptor {
  const v = value as ImageDescriptor | null;
  return !!v && typeof v.path === "string" && Array.isArray(v.widths) && v.widths.length > 0;
}
