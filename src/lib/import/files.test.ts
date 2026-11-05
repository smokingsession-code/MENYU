import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isHeic, isPdf, prepareFile, targetLongSide } from "./files";

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 240, g: 230, b: 200 } } });

describe("prepareFile", () => {
  it("scales big photos to what the model can use, as JPEG", async () => {
    const png = await image(4000, 3000).png().toBuffer();
    const result = await prepareFile(png, "image/png");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.mime).toBe("image/jpeg");
    const meta = await sharp(result.file.data).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2576);
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(3_750_000);
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 1);
  });

  it("keeps tall menus sharp: only the long side limit applies", () => {
    expect(targetLongSide(1000, 4000)).toBe(2576);
    expect(targetLongSide(3000, 4000)).toBe(2236);
    expect(targetLongSide(800, 600)).toBe(800);
  });

  it("turns photos upright from the camera's orientation and never enlarges", async () => {
    const sideways = await image(300, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await prepareFile(sideways, "image/jpeg");
    if (!result.ok) throw new Error("expected ok");
    const meta = await sharp(result.file.data).metadata();
    expect([meta.width, meta.height]).toEqual([100, 300]);
  });

  it("passes PDFs through and refuses files that are not what they claim", async () => {
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n");
    expect(await prepareFile(pdf, "application/pdf")).toEqual({ ok: true, file: { mime: "application/pdf", data: pdf } });
    expect(await prepareFile(Buffer.from("not a pdf"), "application/pdf")).toEqual({ ok: false, reason: "damaged" });
    expect(await prepareFile(Buffer.from("garbage bytes"), "image/jpeg")).toEqual({ ok: false, reason: "damaged" });
  });

  it("explains iPhone HEIC photos instead of calling them damaged", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
    expect(isHeic(heic)).toBe(true);
    expect(isPdf(heic)).toBe(false);
    expect(await prepareFile(heic, "image/heic")).toEqual({ ok: false, reason: "unsupported" });
  });
});
