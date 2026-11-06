import { Suspense } from "react";
import { BranchSwitcher } from "@/components/dashboard/branch-switcher";
import { NavBar, type NavItem } from "@/components/dashboard/nav-bar";
import { planHas } from "@/config/plans";
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
  } else if (planHas(ctx.plan, "feedback")) {
    // Staff see feedback; owners reach it from the home screen.
    items.push({ href: `${base}/feedback`, label: t("nav.feedback"), icon: "feedback" });
  }
  return <NavBar items={items} label={ctx.name} />;
}

/** Several branches: choose which one the dashboard shows. */
async function BranchBar({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const ctx = await getDashboardContext(restaurantId);
  if (ctx.branches.length < 2) return null;
  return (
    <BranchSwitcher
      restaurantId={restaurantId}
      branches={ctx.branches.map((b) => ({ id: b.id, label: b.name ?? [ctx.name, b.area].filter(Boolean).join(" · ") }))}
      current={ctx.branch.id}
      label={t("branches.switch")}
    />
  );
}

export default function RestaurantDashboardLayout({ children, params }: LayoutProps<"/dashboard/[restaurantId]">) {
  return (
    <>
      <Suspense fallback={null}>
        <BranchBar params={params} />
      </Suspense>
      <div className="pb-20">{children}</div>
      <Suspense fallback={null}>
        <DashboardNav params={params} />
      </Suspense>
    </>
  );
}
