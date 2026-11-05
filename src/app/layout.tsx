import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BRAND } from "@/config/brand";
import { publicEnv } from "@/lib/env";
import "./globals.css";

const nunito = localFont({
  src: "../fonts/nunito-latin-wght-normal.woff2",
  weight: "200 1000",
  display: "swap",
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: `${BRAND.name}: ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.tagline,
  applicationName: BRAND.name,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: BRAND.colors.primary,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${nunito.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
