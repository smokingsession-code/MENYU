import "server-only";
import QRCode from "qrcode";
import { publicEnv } from "@/lib/env";

/**
 * QR codes for menus. Level "Q" error correction (25%) keeps printed codes
 * scannable when a table card gets scratched, stained or folded.
 */
const OPTIONS = { errorCorrectionLevel: "Q" as const, margin: 2 };

/** The link a QR code opens: the menu, plus ?t=<table code> for a table. */
export function menuLink(slug: string, tableCode?: string | null): string {
  const base = `${publicEnv.siteUrl}/r/${slug}`;
  return tableCode ? `${base}?t=${encodeURIComponent(tableCode)}` : base;
}

export async function qrPng(text: string, size = 1024): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...OPTIONS, type: "png", width: Math.min(4096, Math.max(128, size)), color: { dark: "#111111", light: "#ffffff" } });
}

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { ...OPTIONS, type: "svg", color: { dark: "#111111", light: "#ffffff" } });
}

/** Module grid for drawing the code as vector shapes (crisp in print). */
export function qrModules(text: string): { size: number; isDark: (x: number, y: number) => boolean } {
  const qr = QRCode.create(text, { errorCorrectionLevel: OPTIONS.errorCorrectionLevel });
  const { size, data } = qr.modules;
  return { size, isDark: (x, y) => Boolean(data[y * size + x]) };
}

/** Safe download names: "kijani-cafe-ntinda-table-5.png". */
export function downloadName(slug: string, tableCode: string | null, ext: string): string {
  return `${slug}${tableCode ? `-table-${tableCode}` : ""}.${ext}`;
}
