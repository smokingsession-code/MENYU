import "server-only";
import { planHas, type PlanCode } from "@/config/plans";
import { getMemberships, getSessionUser, isAdmin } from "@/lib/auth";
import { effectivePlan } from "@/lib/billing/plan";
import { getTranslator } from "@/lib/i18n";
import type { ImageDescriptor } from "@/lib/images/shared";
import { createClient } from "@/lib/supabase/server";

export interface PrintableTable {
  id: string;
  label: string;
  code: string;
}

export interface PrintableBranch {
  id: string;
  slug: string;
  name: string | null;
  isMain: boolean;
  tables: PrintableTable[];
}

export interface PrintableRestaurant {
  id: string;
  name: string;
  brandColor: string;
  logo: ImageDescriptor | null;
  plan: PlanCode;
  tableCodes: boolean;
  branches: PrintableBranch[];
}

/**
 * Loads what QR downloads need, for the restaurant's owners and the Menyu
 * team only (staff do not manage QR codes). Null means "not found" to the
 * caller, whether the restaurant is missing or off limits.
 */
export async function loadPrintableRestaurant(restaurantId: string): Promise<PrintableRestaurant | null> {
  if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) return null;
  const user = await getSessionUser();
  if (!user) return null;
  const admin = await isAdmin();
  if (!admin) {
    const membership = (await getMemberships()).find((m) => m.restaurantId === restaurantId);
    if (membership?.role !== "owner") return null;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("restaurants")
    .select("id, name, brand_color, logo, subscriptions(plan, status), branches(id, slug, name, is_main, sort_order, deleted_at, tables(id, label, code, sort_order, deleted_at))")
    .eq("id", restaurantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;

  const plan = effectivePlan(data.subscriptions);
  const tableCodes = planHas(plan, "table_qr");
  return {
    id: data.id,
    name: data.name,
    brandColor: data.brand_color,
    logo: (data.logo as unknown as ImageDescriptor | null) ?? null,
    plan,
    tableCodes,
    branches: data.branches
      .filter((b) => !b.deleted_at)
      .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.sort_order - b.sort_order)
      .map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        isMain: b.is_main,
        // Free plan: one restaurant-wide code only, so no table codes.
        tables: tableCodes
          ? b.tables
              .filter((t) => !t.deleted_at)
              .sort((x, y) => x.sort_order - y.sort_order || x.label.localeCompare(y.label, undefined, { numeric: true }))
              .map((t) => ({ id: t.id, label: t.label, code: t.code }))
          : [],
      })),
  };
}

/** "5" -> "Table 5"; named tables ("Garden 1", "VIP") keep their own name. */
export function printedTableLabel(label: string): string {
  return /^\d+$/.test(label.trim()) ? getTranslator("en")("print.table", { table: label.trim() }) : label.trim();
}
