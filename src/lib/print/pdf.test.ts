import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import jsQR from "jsqr";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildPrintPdf, type PrintEntry } from "./pdf";

const OUT = path.join(process.cwd(), "test-results", "print");
const entries: PrintEntry[] = [
  { label: null, url: "https://menyu.example/r/kijani-cafe-ntinda" },
  { label: "Table 5", url: "https://menyu.example/r/kijani-cafe-ntinda?t=5" },
  { label: "Garden 1", url: "https://menyu.example/r/kijani-cafe-ntinda?t=garden-1" },
];
const words = { scanForMenu: "Scan for menu", tagline: "No app needed · Order on WhatsApp", foldHere: "Fold here" };

function hasPdftoppm() {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Renders every page to PNG and returns the QR texts found in each. */
interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate?: boolean;
}

async function decodePages(pdf: Uint8Array, name: string, crops: (w: number, h: number) => Crop[]) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.pdf`);
  writeFileSync(file, pdf);
  execFileSync("pdftoppm", ["-r", "110", "-png", file, path.join(OUT, name)]);
  const pages = readdirSync(OUT).filter((f) => f.startsWith(`${name}-`) && f.endsWith(".png")).sort();
  const found: string[][] = [];
  for (const page of pages) {
    const image = readFileSync(path.join(OUT, page));
    const meta = await sharp(image).metadata();
    const texts: string[] = [];
    for (const crop of crops(meta.width!, meta.height!)) {
      let region = sharp(image).extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height });
      if (crop.rotate) region = region.rotate(180);
      const { data, info } = await region.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      if (code) texts.push(code.data);
    }
    found.push(texts);
  }
  return found;
}

describe("print PDFs", () => {
  it("makes one table tent page per code", async () => {
    const pdf = await buildPrintPdf({ restaurantName: "Kijani Café", brandColor: "#2F7A3E", entries, layout: "tents", words });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getTitle()).toBe("Kijani Café: QR codes");
  });

  it("fits six stickers on each A4 sheet", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ label: `Table ${i + 1}`, url: `https://menyu.example/r/x?t=${i + 1}` }));
    const pdf = await buildPrintPdf({ restaurantName: "Kijani Café", brandColor: "#2F7A3E", entries: many, layout: "stickers", words });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  it("copes with long names, light brand colours and characters the font lacks", async () => {
    const pdf = await buildPrintPdf({
      restaurantName: "The Very Long Name Rooftop Lounge, Bar & Grill of Kampala 🍖",
      brandColor: "#F4F400",
      entries: [{ label: "VIP Terrace Table Number Fourteen", url: "https://menyu.example/r/x" }],
      layout: "tents",
      words,
    });
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it.skipIf(!hasPdftoppm())("prints QR codes that scan to the right menu and table, on both sides of the tent", async () => {
    const pdf = await buildPrintPdf({ restaurantName: "Kijani Café", brandColor: "#2F7A3E", entries, layout: "tents", words, credit: "Made with Menyu" });
    // Front = bottom half (upright); back = top half (printed upside down).
    const pages = await decodePages(pdf, "tents", (w, h) => [
      { left: 0, top: Math.floor(h / 2), width: w, height: h - Math.floor(h / 2) },
      { left: 0, top: 0, width: w, height: Math.floor(h / 2), rotate: true },
    ]);
    expect(pages).toEqual(entries.map((e) => [e.url, e.url]));
  });

  it.skipIf(!hasPdftoppm())("prints scannable stickers", async () => {
    const pdf = await buildPrintPdf({ restaurantName: "Kijani Café", brandColor: "#2F7A3E", entries, layout: "stickers", words });
    const [page] = await decodePages(pdf, "stickers", (w, h) => {
      const cellW = Math.round(w / 2);
      const cellH = Math.round(h / 3);
      return [0, 1, 2].map((i) => ({ left: (i % 2) * cellW, top: Math.floor(i / 2) * cellH, width: cellW, height: cellH }));
    });
    expect(page).toEqual(entries.map((e) => e.url));
  });
});
