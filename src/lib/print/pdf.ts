import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { parseHex, textOn } from "@/lib/color";
import { qrModules } from "@/lib/qr";

/**
 * Print-ready PDFs of the restaurant's QR codes.
 *   tents:    one A4 page per code, folded in the middle into a table tent.
 *             The back half is the front turned 180°, so both sides read
 *             upright once folded.
 *   stickers: six 8.5 cm stickers per A4 sheet, with dashed cut lines.
 */
export interface PrintEntry {
  /** "Table 5", or null for the restaurant-wide code. */
  label: string | null;
  url: string;
}

export interface PrintWords {
  scanForMenu: string;
  tagline: string;
  foldHere: string;
}

export interface PrintOptions {
  restaurantName: string;
  brandColor: string;
  logoPng?: Buffer | null;
  entries: PrintEntry[];
  layout: "tents" | "stickers";
  words: PrintWords;
  /** Small credit line, used on Free plan prints. */
  credit?: string | null;
}

export const A4 = { width: 595.28, height: 841.89 };
const MM = 72 / 25.4;
const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.33, 0.31, 0.28);
const WHITE = rgb(1, 1, 1);
const LINE = rgb(0.75, 0.73, 0.69);

function pdfColor(hex: string) {
  const c = parseHex(hex) ?? [30, 91, 58];
  return rgb(c[0] / 255, c[1] / 255, c[2] / 255);
}

async function loadFonts(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  const dir = path.join(process.cwd(), "src", "fonts", "print");
  const [bold, extraBold] = await Promise.all([
    readFile(path.join(dir, "Nunito-Bold.ttf")),
    readFile(path.join(dir, "Nunito-ExtraBold.ttf")),
  ]);
  return { bold: await doc.embedFont(bold, { subset: true }), extraBold: await doc.embedFont(extraBold, { subset: true }) };
}
type Fonts = Awaited<ReturnType<typeof loadFonts>>;

/** Characters the embedded Latin font can draw; anything else is dropped. */
function printable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text].filter((ch) => supported.has(ch.codePointAt(0)!)).join("").replace(/\s+/g, " ").trim();
}

/** Largest size (down to `min`) at which the text fits; then clipped with "…". */
function fit(font: PDFFont, text: string, maxWidth: number, size: number, min: number): { text: string; size: number } {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  let t = text;
  if (font.widthOfTextAtSize(t, s) > maxWidth) {
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, s) > maxWidth) t = t.slice(0, -1);
    t = `${t.trimEnd()}…`;
  }
  return { text: t, size: s };
}

function centredText(page: PDFPage, text: string, cx: number, baseline: number, font: PDFFont, size: number, color = INK) {
  page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y: baseline, size, font, color });
}

/** QR code as vector squares; runs of dark modules become one rectangle. */
export function drawQr(page: PDFPage, url: string, x: number, y: number, size: number) {
  const { size: n, isDark } = qrModules(url);
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: WHITE });
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!isDark(col, row)) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && isDark(col, row)) col++;
      page.drawRectangle({
        x: x + (quiet + start) * cell,
        y: y + size - (quiet + row + 1) * cell,
        width: (col - start) * cell,
        // A hair taller than the cell so rows never show hairline gaps.
        height: cell + 0.15,
        color: INK,
      });
    }
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One printed face, laid out top to bottom: a band in the restaurant's
 * colour with its logo and name, "Scan for menu", the QR code, the table
 * name and a short tagline.
 */
function drawFace(page: PDFPage, box: Box, entry: PrintEntry, o: PrintOptions, fonts: Fonts, logo: PDFImage | null, scale: number) {
  const brand = pdfColor(o.brandColor);
  const onBrand = textOn(o.brandColor) === "#ffffff" ? WHITE : INK;
  const cx = box.x + box.width / 2;
  const top = box.y + box.height;
  const pad = 20 * scale;
  const inner = box.width - pad * 2;

  // Band with logo and name.
  const band = 66 * scale;
  page.drawRectangle({ x: box.x, y: top - band, width: box.width, height: band, color: brand });
  const logoSize = logo ? band - 22 * scale : 0;
  const gap = logo ? 10 * scale : 0;
  const name = fit(fonts.extraBold, printable(fonts.extraBold, o.restaurantName), inner - logoSize - gap, 26 * scale, 11 * scale);
  const nameWidth = fonts.extraBold.widthOfTextAtSize(name.text, name.size);
  const groupLeft = cx - (logoSize + gap + nameWidth) / 2;
  if (logo) page.drawImage(logo, { x: groupLeft, y: top - band + 11 * scale, width: logoSize, height: logoSize });
  page.drawText(name.text, { x: groupLeft + logoSize + gap, y: top - band / 2 - name.size * 0.35, size: name.size, font: fonts.extraBold, color: onBrand });

  // Headline.
  const head = fit(fonts.extraBold, o.words.scanForMenu, inner, 34 * scale, 14 * scale);
  let cursor = top - band - 18 * scale - head.size;
  centredText(page, head.text, cx, cursor, fonts.extraBold, head.size);

  // QR code, as large as the remaining space allows.
  const reserveBelow = (entry.label ? 34 : 0) * scale + 34 * scale + (o.credit ? 12 * scale : 0);
  const qrSize = Math.min(inner - 20 * scale, cursor - 14 * scale - (box.y + reserveBelow));
  cursor -= 14 * scale + qrSize;
  drawQr(page, entry.url, cx - qrSize / 2, cursor, qrSize);

  // Table name.
  if (entry.label) {
    const label = fit(fonts.extraBold, printable(fonts.extraBold, entry.label), inner, 26 * scale, 11 * scale);
    cursor -= 8 * scale + label.size;
    centredText(page, label.text, cx, cursor, fonts.extraBold, label.size, brand);
  }

  const tagline = fit(fonts.bold, o.words.tagline, inner, 13 * scale, 7);
  cursor -= 10 * scale + tagline.size;
  centredText(page, tagline.text, cx, cursor, fonts.bold, tagline.size, MUTED);

  if (o.credit) centredText(page, o.credit, cx, box.y + 8 * scale, fonts.bold, Math.max(6, 8 * scale), MUTED);
}

/** Draws `draw` turned 180° around the centre of `box`. */
function upsideDown(page: PDFPage, box: Box, draw: () => void) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(-1, 0, 0, -1, 2 * cx, 2 * cy));
  draw();
  page.pushOperators(popGraphicsState());
}

export async function buildPrintPdf(o: PrintOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${o.restaurantName}: QR codes`);
  doc.setCreator("Menyu");
  doc.setProducer("Menyu");
  const fonts = await loadFonts(doc);
  const logo = o.logoPng ? await doc.embedPng(o.logoPng) : null;

  if (o.layout === "tents") {
    const half = A4.height / 2;
    for (const entry of o.entries) {
      const page = doc.addPage([A4.width, A4.height]);
      const front: Box = { x: 0, y: 0, width: A4.width, height: half };
      const back: Box = { x: 0, y: half, width: A4.width, height: half };
      drawFace(page, front, entry, o, fonts, logo, 1);
      upsideDown(page, back, () => drawFace(page, back, entry, o, fonts, logo, 1));
      page.drawLine({ start: { x: 0, y: half }, end: { x: A4.width, y: half }, thickness: 0.6, color: LINE, dashArray: [4, 4] });
      page.drawText(o.words.foldHere, { x: 12, y: half + 4, size: 7, font: fonts.bold, color: MUTED });
    }
  } else {
    const size = 85 * MM;
    const gap = 8 * MM;
    const cols = 2;
    const rows = 3;
    const marginX = (A4.width - cols * size - (cols - 1) * gap) / 2;
    const marginY = (A4.height - rows * size - (rows - 1) * gap) / 2;
    for (let i = 0; i < o.entries.length; i += cols * rows) {
      const page = doc.addPage([A4.width, A4.height]);
      o.entries.slice(i, i + cols * rows).forEach((entry, j) => {
        const col = j % cols;
        const row = Math.floor(j / cols);
        const box: Box = { x: marginX + col * (size + gap), y: A4.height - marginY - (row + 1) * size - row * gap, width: size, height: size };
        drawFace(page, box, entry, o, fonts, logo, 0.6);
        page.drawRectangle({ ...box, borderColor: LINE, borderWidth: 0.6, borderDashArray: [3, 3] });
      });
    }
  }
  return doc.save();
}
