import "server-only";
import sharp from "sharp";

/**
 * Photo enhancement for Pro menus. The built-in auto-fix needs no outside
 * service; an AI enhancer can implement the same interface later and be
 * chosen with PHOTO_ENHANCER, without changing the screens that use it.
 */
export interface PhotoEnhancer {
  id: string;
  /** Takes an image and returns the improved image (any format sharp reads). */
  enhance(input: Buffer): Promise<Buffer>;
}

/**
 * What most phone photos of food need: exposure and contrast evened out
 * (ignoring the darkest and brightest 1%), a little more colour, and a light
 * sharpen. Gentle on purpose: food should still look like the real dish.
 */
export const autoFix: PhotoEnhancer = {
  id: "auto-fix",
  async enhance(input) {
    return sharp(input, { failOn: "error", limitInputPixels: 40_000_000 })
      .rotate()
      .normalise({ lower: 1, upper: 99 })
      .modulate({ brightness: 1.04, saturation: 1.15 })
      .sharpen({ sigma: 0.8 })
      .png()
      .toBuffer();
  },
};

const enhancers: Record<string, PhotoEnhancer> = { [autoFix.id]: autoFix };

export function photoEnhancer(): PhotoEnhancer {
  return enhancers[process.env.PHOTO_ENHANCER ?? autoFix.id] ?? autoFix;
}
