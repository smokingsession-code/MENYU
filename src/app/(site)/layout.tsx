import localFont from "next/font/local";

/**
 * Menyu's own pages (home, sign-in, dashboard, admin) use the brand font.
 * Diner menus (/r/...) are outside this group: they use the phone's own
 * font, which saves a 39 KB download on slow, costly mobile data.
 */
const nunito = localFont({
  src: "../../fonts/nunito-latin-wght-normal.woff2",
  weight: "200 1000",
  display: "swap",

});

export default function SiteLayout({ children }: LayoutProps<"/">) {
  // className (not a CSS variable): Tailwind resolves --font-sans on :root,
  // which cannot see a variable set on this element.
  return <div className={`${nunito.className} flex flex-1 flex-col`}>{children}</div>;
}
