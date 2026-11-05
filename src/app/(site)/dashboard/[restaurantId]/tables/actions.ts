"use server";

import { refresh } from "next/cache";
import { requireRestaurantAccess } from "@/lib/auth";
import { getTranslator } from "@/lib/i18n";
import { expireMenu } from "@/lib/menu/expire";
import { createClient } from "@/lib/supabase/server";
import { parseTableLabels } from "@/lib/tables";

const t = getTranslator("en");

export type TablesResult = { ok: true; count?: number } | { ok: false; error: string };

function denied(code?: string): TablesResult {
  return { ok: false, error: code === "42501" ? t("tables.freePlan") : t("common.errorGeneric") };
}

export async function addTablesAction(restaurantId: string, branchId: string, input: string): Promise<TablesResult> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const { labels, tooMany } = parseTableLabels(input);
  if (tooMany) return { ok: false, error: t("tables.errors.tooMany") };
  if (labels.length === 0) return { ok: false, error: t("tables.errors.empty") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_tables", { p_branch_id: branchId, p_labels: labels });
  if (error) return denied(error.code);
  expireMenu(restaurantId);
  refresh();
  return { ok: true, count: data as number };
}

export async function renameTableAction(restaurantId: string, tableId: string, label: string): Promise<TablesResult> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const clean = label.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!clean) return { ok: false, error: t("tables.errors.empty") };
  const supabase = await createClient();
  // The code in the QR link stays the same, so printed codes keep working.
  const { error } = await supabase.from("tables").update({ label: clean }).eq("id", tableId).eq("restaurant_id", restaurantId);
  if (error) return denied(error.code);
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}

export async function deleteTableAction(restaurantId: string, tableId: string): Promise<TablesResult> {
  await requireRestaurantAccess(restaurantId, ["owner"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("tables")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId);
  if (error) return denied(error.code);
  expireMenu(restaurantId);
  refresh();
  return { ok: true };
}
