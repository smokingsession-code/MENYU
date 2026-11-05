import "server-only";
import { GRACE_DAYS_DEFAULT, TRIAL } from "@/config/plans";
import { EMPTY_MOMO, type BusinessMomo } from "@/lib/billing/reminder";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Admin-editable settings that billing needs. The settings table is admin
 * only, so these are read with the service client; callers decide who may
 * see them (the merchant codes and support number are shown to owners).
 */
export interface BillingSettings {
  trialDays: number;
  graceDays: number;
  momo: BusinessMomo;
  /** International digits, or "" when not set. */
  supportWhatsapp: string;
}

const KEYS = ["trial_days", "grace_days", "business_momo", "support_whatsapp"] as const;

function int(value: Json | undefined, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) ? n : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getBillingSettings(): Promise<BillingSettings> {
  const { data, error } = await createAdminClient().from("settings").select("key, value").in("key", [...KEYS]);
  if (error) console.error("[settings] read failed", { message: error.message });
  const values = new Map((data ?? []).map((row) => [row.key, row.value]));
  const momo = values.get("business_momo");
  const m = momo && typeof momo === "object" && !Array.isArray(momo) ? (momo as Record<string, unknown>) : {};
  return {
    trialDays: int(values.get("trial_days"), TRIAL.defaultDays),
    graceDays: int(values.get("grace_days"), GRACE_DAYS_DEFAULT),
    momo: {
      ...EMPTY_MOMO,
      mtn_code: text(m.mtn_code),
      mtn_name: text(m.mtn_name),
      airtel_code: text(m.airtel_code),
      airtel_name: text(m.airtel_name),
    },
    supportWhatsapp: text(values.get("support_whatsapp")),
  };
}

export async function saveBillingSettings(values: BillingSettings, actorId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const rows: { key: string; value: NonNullable<Json>; updated_at: string; updated_by: string }[] = [
    { key: "trial_days", value: values.trialDays, updated_at: now, updated_by: actorId },
    { key: "grace_days", value: values.graceDays, updated_at: now, updated_by: actorId },
    { key: "business_momo", value: { ...values.momo }, updated_at: now, updated_by: actorId },
    { key: "support_whatsapp", value: values.supportWhatsapp, updated_at: now, updated_by: actorId },
  ];
  const db = createAdminClient();
  const { error } = await db.from("settings").upsert(rows, { onConflict: "key" });
  if (error) {
    console.error("[settings] save failed", { message: error.message });
    return false;
  }
  await db.from("audit_log").insert({ actor_id: actorId, action: "settings.billing_changed", details: { ...values, momo: { ...values.momo } } });
  return true;
}
