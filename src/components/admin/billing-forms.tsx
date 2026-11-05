"use client";

import { useState, useTransition } from "react";
import {
  changePlanAction,
  markRemindedAction,
  recordPaymentAction,
  removePaymentAction,
  runBillingCheckAction,
} from "@/app/(site)/admin/billing/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { PLANS, type PlanCode } from "@/config/plans";
import { nextPeriod, priceFor, type BillingInterval, type SubscriptionState } from "@/lib/billing/status";
import { formatDate, fromDateInput, toDateInput } from "@/lib/dates";
import { formatUGX } from "@/lib/money";

type Strings = Record<string, string>;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const METHODS = ["mtn_momo", "airtel_money", "cash", "bank", "other"] as const;

function periodOptions(plan: PlanCode, a: Strings) {
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: `month:${i + 1}`,
    label: i === 0 ? a["detail.periodMonth"] : fill(a["detail.periodMonths"], { n: i + 1 }),
  }));
  const years =
    PLANS[plan].priceYearlyUgx !== null
      ? [1, 2, 3].map((n) => ({ value: `year:${n}`, label: n === 1 ? a["detail.periodYear"] : fill(a["detail.periodYears"], { n }) }))
      : [];
  return [...months, ...years];
}

export function RecordPaymentForm({
  restaurantId,
  subscription,
  branches,
  a,
  b,
}: {
  restaurantId: string;
  subscription: SubscriptionState;
  /** Active branches, for Pro's per-branch price. */
  branches: number;
  /** admin.* strings */
  a: Strings;
  /** billing.* strings */
  b: Strings;
}) {
  const startPlan = subscription.plan === "pro" ? "pro" : "standard";
  const [kind, setKind] = useState<"subscription" | "setup_fee" | "other">("subscription");
  const [plan, setPlan] = useState<"standard" | "pro">(startPlan);
  const [period, setPeriod] = useState(`${subscription.billing_interval === "year" && startPlan === "standard" ? "year" : "month"}:1`);
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("mtn_momo");
  const [transactionId, setTransactionId] = useState("");
  // Read the clock once, when the form opens.
  const [today] = useState(() => new Date());
  const [paidOn, setPaidOn] = useState(() => toDateInput(today));
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string; field?: string } | null>(null);
  const [pending, start] = useTransition();

  const [interval, periods] = period.split(":") as [BillingInterval, string];
  const suggested = kind === "subscription" ? (priceFor(plan, interval, branches) ?? 0) * Number(periods) : null;
  const amountValue = amount.trim() ? Number(amount.replace(/[,\s]/g, "")) : (suggested ?? NaN);
  const paidAt = fromDateInput(paidOn, "midday");
  const preview =
    kind === "subscription" && paidAt
      ? nextPeriod(subscription, { interval, periods: Number(periods), now: paidAt.getTime() > today.getTime() ? today : paidAt }).end
      : null;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await recordPaymentAction(restaurantId, {
            kind,
            amountUgx: Number.isFinite(amountValue) ? Math.round(amountValue) : 0,
            method,
            transactionId,
            paidOn,
            notes,
            ...(kind === "subscription" ? { plan, interval, periods: Number(periods) } : {}),
          });
          if (!r.ok) return setResult({ tone: "error", text: r.error, field: r.field });
          setResult({ tone: "success", text: r.paidUntil ? fill(a["detail.recorded"], { date: formatDate(r.paidUntil) }) : a["detail.recordedOther"] });
          setTransactionId("");
          setNotes("");
          setAmount("");
        });
      }}
    >
      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
      <Field id="pay-kind" label={a["detail.paymentKind"]}>
        <select id="pay-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputClass}>
          {(["subscription", "setup_fee", "other"] as const).map((k) => (
            <option key={k} value={k}>
              {b[`kind.${k}`]}
            </option>
          ))}
        </select>
      </Field>
      {kind === "subscription" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="pay-plan" label={a["detail.paymentPlan"]}>
            <select
              id="pay-plan"
              value={plan}
              onChange={(e) => {
                const next = e.target.value as "standard" | "pro";
                setPlan(next);
                if (next === "pro" && interval === "year") setPeriod("month:12");
              }}
              className={inputClass}
            >
              <option value="standard">{PLANS.standard.name}</option>
              <option value="pro">{PLANS.pro.name}</option>
            </select>
          </Field>
          <Field id="pay-period" label={a["detail.paysFor"]}>
            <select id="pay-period" value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass}>
              {periodOptions(plan, a).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="pay-amount" label={a["detail.amount"]} error={result?.field === "amountUgx" ? result.text : undefined}>
          <Input
            id="pay-amount"
            inputMode="numeric"
            value={amount}
            placeholder={suggested ? String(suggested) : ""}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field id="pay-method" label={a["detail.method"]}>
          <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputClass}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {b[`method.${m}`]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="pay-transaction"
          label={a["detail.transactionId"]}
          hint={a["detail.transactionHint"]}
          error={result?.field === "transactionId" ? result.text : undefined}
        >
          <Input id="pay-transaction" value={transactionId} maxLength={80} autoComplete="off" onChange={(e) => setTransactionId(e.target.value)} />
        </Field>
        <Field id="pay-date" label={a["detail.paidOn"]} error={result?.field === "paidOn" ? result.text : undefined}>
          <Input id="pay-date" type="date" value={paidOn} max={toDateInput(today)} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
      </div>
      <Field id="pay-notes" label={a["detail.note"]}>
        <Input id="pay-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {preview ? <p className="font-bold">{fill(a["detail.paidUntilPreview"], { date: formatDate(preview) })}</p> : null}
      <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
        {pending ? a["detail.recording"] : `${a["detail.record"]}${Number.isFinite(amountValue) && amountValue > 0 ? ` · ${formatUGX(amountValue)}` : ""}`}
      </Button>
    </form>
  );
}

export function PlanForm({
  restaurantId,
  subscription,
  updatedAt,
  a,
}: {
  restaurantId: string;
  subscription: SubscriptionState;
  updatedAt: string;
  a: Strings;
}) {
  // Start from what is stored, so saving an unrelated change (grace days)
  // reproduces the current state: a lapsed Standard restaurant stays a
  // lapsed Standard restaurant rather than becoming a Free one.
  const initialMode = subscription.status === "trial" || (!subscription.paid_until && subscription.trial_ends_at) ? "trial" : "paid";
  const [plan, setPlan] = useState<PlanCode>(subscription.plan as PlanCode);
  const [mode, setMode] = useState<"trial" | "paid">(initialMode);
  const [until, setUntil] = useState(toDateInput(initialMode === "trial" ? subscription.trial_ends_at : subscription.paid_until));
  const [interval, setInterval] = useState<BillingInterval>(subscription.billing_interval === "year" ? "year" : "month");
  const [grace, setGrace] = useState(String(subscription.grace_days));
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string; field?: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await changePlanAction(restaurantId, {
            plan,
            mode: plan === "free" ? "free" : mode,
            interval,
            until,
            graceDays: Number(grace),
            expectedUpdatedAt: updatedAt,
          });
          setResult(r.ok ? { tone: "success", text: a["detail.planSaved"] } : { tone: "error", text: r.error, field: r.field });
        });
      }}
    >
      <p className="text-sm text-muted">{a["detail.planHint"]}</p>
      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="plan-plan" label={a["detail.paymentPlan"]}>
          <select id="plan-plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)} className={inputClass}>
            {(["free", "standard", "pro"] as const).map((code) => (
              <option key={code} value={code}>
                {PLANS[code].name}
              </option>
            ))}
          </select>
        </Field>
        {plan === "standard" ? (
          <Field id="plan-interval" label={a["detail.interval"]}>
            <select id="plan-interval" value={interval} onChange={(e) => setInterval(e.target.value as BillingInterval)} className={inputClass}>
              <option value="month">{a["detail.intervalMonth"]}</option>
              <option value="year">{a["detail.intervalYear"]}</option>
            </select>
          </Field>
        ) : null}
      </div>
      {plan !== "free" ? (
        <fieldset className="space-y-2">
          <legend className="font-bold">{a["detail.mode"]}</legend>
          <div className="flex flex-wrap gap-2">
            {(["trial", "paid"] as const).map((m) => (
              <label key={m} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 ${mode === m ? "border-brand bg-brand-soft" : "border-line"}`}>
                <input type="radio" name="plan-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="size-5 accent-[var(--color-brand)]" />
                {m === "trial" ? a["detail.modeTrial"] : a["detail.modePaid"]}
              </label>
            ))}
          </div>
          <Field id="plan-until" label={a["detail.date"]} error={result?.field === "until" ? result.text : undefined}>
            <Input id="plan-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        </fieldset>
      ) : null}
      <Field id="plan-grace" label={a["detail.grace"]} error={result?.field === "graceDays" ? result.text : undefined}>
        <Input id="plan-grace" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} className="max-w-32" />
      </Field>
      <Button type="submit" variant="brand" disabled={pending}>
        {a["detail.savePlan"]}
      </Button>
    </form>
  );
}

export interface PaymentRow {
  id: string;
  kind: string;
  amount_ugx: number;
  method: string;
  transaction_id: string | null;
  paid_at: string;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
}

export function PaymentList({ payments, a, b }: { payments: PaymentRow[]; a: Strings; b: Strings }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (payments.length === 0) return <p className="text-muted">{a["detail.noPayments"]}</p>;
  return (
    <div className="space-y-2">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="divide-y divide-line">
        {payments.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block font-bold">
                {formatUGX(p.amount_ugx)} · {b[`kind.${p.kind}`] ?? p.kind}
              </span>
              <span className="block text-sm text-muted">
                {formatDate(p.paid_at)} · {b[`method.${p.method}`] ?? p.method}
                {p.transaction_id ? ` · ${p.transaction_id}` : ""}
              </span>
              {p.period_start && p.period_end ? (
                <span className="block text-sm text-muted">{fill(b.paidFor, { from: formatDate(p.period_start), to: formatDate(p.period_end) })}</span>
              ) : null}
              {p.notes ? <span className="block text-sm">{p.notes}</span> : null}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(fill(a["detail.removeConfirm"], { amount: formatUGX(p.amount_ugx) }))) return;
                setError(null);
                start(async () => {
                  const r = await removePaymentAction(p.id);
                  if (!r.ok) setError(r.error);
                });
              }}
            >
              {a["detail.removePayment"]}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Opens WhatsApp with the reminder and notes that it was sent. */
export function ReminderButton({ restaurantId, href, label }: { restaurantId: string; href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass("brand", "sm")}
      onClick={() => {
        void markRemindedAction(restaurantId);
      }}
    >
      {label}
    </a>
  );
}

export function RunCheckButton({ label, doneLabel }: { label: string; doneLabel: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runBillingCheckAction();
            setMessage(r.ok ? fill(doneLabel, { count: r.changed }) : r.error);
          })
        }
      >
        {label}
      </Button>
      {message ? (
        <p role="status" className="text-sm font-bold">
          {message}
        </p>
      ) : null}
    </div>
  );
}
