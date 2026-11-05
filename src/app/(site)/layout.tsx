import "../site.css";

/**
 * Menyu's own pages (home, sign-in, dashboard, admin) use the brand font,
 * declared in site.css. Diner menus (/r/...) are outside this group and use
 * the phone's own font, which saves a 39 KB download on costly data.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}
