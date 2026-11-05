import { Suspense } from "react";
import { NavBar, type NavItem } from "@/components/dashboard/nav-bar";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator } from "@/lib/i18n";

const t = getTranslator("en");

async function DashboardNav({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  const base = `/dashboard/${restaurantId}`;
  const items: NavItem[] = [
    { href: base, label: t("nav.home"), icon: "home" },
    { href: `${base}/menu`, label: t("nav.menu"), icon: "menu" },
  ];
  if (ctx.role !== "staff") {
    items.push({ href: `${base}/tables`, label: t("nav.tables"), icon: "tables" });
    items.push({ href: `${base}/profile`, label: t("nav.profile"), icon: "profile" });
  }
  return <NavBar items={items} label={ctx.name} />;
}

export default function RestaurantDashboardLayout({ children, params }: LayoutProps<"/dashboard/[restaurantId]">) {
  return (
    <>
      <div className="pb-20">{children}</div>
      <Suspense fallback={null}>
        <DashboardNav params={params} />
      </Suspense>
    </>
  );
}
