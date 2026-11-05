"use server";

import { randomInt } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fromDateInput } from "@/lib/dates";
import { getTranslator } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";

const t = getTranslator("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Fail = { ok: false; error: string; field?: string };

/** "Sarah Nakato" -> "SARA" + three digits. */
function makeCode(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "AGNT";
  return `${letters}${randomInt(100, 1000)}`;
}

const agentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30),
  code: z.string().trim().toUpperCase().max(12),
  commission: z.string().trim().max(15),
});

export type AgentInput = z.input<typeof agentSchema>;

export async function createAgentAction(input: AgentInput): Promise<{ ok: true; code: string } | Fail> {
  await requireAdmin();
  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("admin.agents.errors.name"), field: "name" };
  const v = parsed.data;
  const phone = v.phone ? normalizePhone(v.phone) : null;
  if (v.phone && !phone) return { ok: false, error: t("admin.agents.errors.phone"), field: "phone" };
  if (v.code && !/^[A-Z0-9]{3,12}$/.test(v.code)) return { ok: false, error: t("admin.agents.errors.code"), field: "code" };
  const commission = v.commission ? Number(v.commission.replace(/[,\s]/g, "")) : null;
  if (commission !== null && (!Number.isInteger(commission) || commission < 0 || commission > 10_000_000)) {
    return { ok: false, error: t("admin.agents.errors.amount"), field: "commission" };
  }

  const db = createAdminClient();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = v.code || makeCode(v.name);
    const { error } = await db.from("agents").insert({ name: v.name, phone, code, commission_ugx: commission });
    if (!error) {
      refresh();
      return { ok: true, code };
    }
    // A chosen code that is taken is the admin's to change; a generated one is tried again.
    if (error.code !== "23505" || v.code) return { ok: false, error: t("admin.agents.errors.code"), field: "code" };
  }
  return { ok: false, error: t("admin.agents.errors.failed") };
}

export async function setAgentActiveAction(agentId: string, active: boolean): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  if (!UUID.test(agentId)) return { ok: false, error: t("admin.agents.errors.failed") };
  const { error } = await createAdminClient().from("agents").update({ is_active: active }).eq("id", agentId);
  if (error) return { ok: false, error: t("admin.agents.errors.failed") };
  refresh();
  return { ok: true };
}

const payoutSchema = z.object({
  amount: z.number().int().min(1).max(100_000_000),
  method: z.enum(["mtn_momo", "airtel_money", "cash", "bank", "other"]),
  transactionId: z.string().trim().max(80),
  paidOn: z.string(),
});

export type PayoutInput = z.input<typeof payoutSchema>;

export async function recordPayoutAction(agentId: string, input: PayoutInput): Promise<{ ok: true } | Fail> {
  const admin = await requireAdmin();
  if (!UUID.test(agentId)) return { ok: false, error: t("admin.agents.errors.failed") };
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("admin.agents.errors.amount"), field: "amount" };
  const paidAt = fromDateInput(parsed.data.paidOn, "midday");
  if (!paidAt) return { ok: false, error: t("admin.errors.date"), field: "paidOn" };
  const db = createAdminClient();
  const { error } = await db.from("agent_payouts").insert({
    agent_id: agentId,
    amount_ugx: parsed.data.amount,
    method: parsed.data.method,
    transaction_id: parsed.data.transactionId || null,
    paid_at: paidAt.toISOString(),
    recorded_by: admin.id,
  });
  if (error) return { ok: false, error: t("admin.agents.errors.failed") };
  await db.from("audit_log").insert({ actor_id: admin.id, action: "agent.payout", details: { agent_id: agentId, amount_ugx: parsed.data.amount } });
  refresh();
  return { ok: true };
}
