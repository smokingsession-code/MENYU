import sharp, { type Stats } from "sharp";
import { describe, expect, it } from "vitest";
import { autoFix, photoEnhancer } from "./enhance";

describe("photo auto-fix", () => {
  it("stretches a dull, low-contrast photo without changing its size", async () => {
    // A grey, washed-out gradient, like a photo taken under a dim bulb.
    const width = 200;
    const height = 120;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = 100 + Math.round((x / width) * 40);
        raw.set([v + 10, v, v - 10], (y * width + x) * 3);
      }
    }
    const dull = await sharp(raw, { raw: { width, height, channels: 3 } }).webp().toBuffer();
    const fixed = await autoFix.enhance(dull);

    const [before, after] = await Promise.all([sharp(dull).stats(), sharp(fixed).stats()]);
    const spread = (s: Stats) => s.channels[1].max - s.channels[1].min;
    expect(spread(after)).toBeGreaterThan(spread(before) * 2);
    const meta = await sharp(fixed).metadata();
    expect([meta.width, meta.height]).toEqual([width, height]);
  });

  it("uses the built-in auto-fix unless another enhancer is configured", () => {
    expect(photoEnhancer().id).toBe("auto-fix");
  });
});
