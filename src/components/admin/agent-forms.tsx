"use client";

import { useState, useTransition } from "react";
import { createAgentAction, recordPayoutAction, setAgentActiveAction } from "@/app/(site)/admin/agents/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { toDateInput } from "@/lib/dates";

type Strings = Record<string, string>;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function NewAgentForm({ s, defaultCommission }: { s: Strings; defaultCommission: string }) {
  const [values, setValues] = useState({ name: "", phone: "", code: "", commission: "" });
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [k]: e.target.value });
  const err = (k: string) => (result?.tone === "error" && result.field === k ? result.text : undefined);
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await createAgentAction(values);
          if (!r.ok) return setResult({ tone: "error", text: r.error, field: r.field });
          setResult({ tone: "success", text: fill(s["agents.created"], { code: r.code }) });
          setValues({ name: "", phone: "", code: "", commission: "" });
        });
      }}
    >
      {result?.tone === "success" ? <Alert tone="success">{result.text}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="agent-name" label={s["agents.name"]} error={err("name")}>
          <Input id="agent-name" value={values.name} maxLength={120} onChange={set("name")} />
        </Field>
        <Field id="agent-phone" label={s["agents.phone"]} error={err("phone")}>
          <Input id="agent-phone" type="tel" inputMode="tel" value={values.phone} onChange={set("phone")} />
        </Field>
        <Field id="agent-code" label={s["agents.code"]} hint={s["agents.codeHint"]} error={err("code")}>
          <Input id="agent-code" value={values.code} maxLength={12} autoCapitalize="characters" onChange={set("code")} />
        </Field>
        <Field id="agent-commission" label={s["agents.commission"]} hint={fill(s["agents.commissionHint"], { amount: defaultCommission })} error={err("commission")}>
          <Input id="agent-commission" inputMode="numeric" value={values.commission} onChange={set("commission")} />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {s["agents.create"]}
      </Button>
    </form>
  );
}

export function PayoutForm({ agentId, owed, s, methods }: { agentId: string; owed: number; s: Strings; methods: Record<string, string> }) {
  const [today] = useState(() => toDateInput(new Date()));
  const [amount, setAmount] = useState(owed > 0 ? String(owed) : "");
  const [method, setMethod] = useState("mtn_momo");
  const [transactionId, setTransactionId] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await recordPayoutAction(agentId, { amount: Number(amount.replace(/[,\s]/g, "")), method: method as "mtn_momo", transactionId, paidOn });
          setResult(r.ok ? { tone: "success", text: s["agents.payoutSaved"] } : { tone: "error", text: r.error });
        });
      }}
    >
      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={`payout-amount-${agentId}`} label={s["agents.amount"]}>
          <Input id={`payout-amount-${agentId}`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id={`payout-method-${agentId}`} label={s["agents.method"]}>
          <select id={`payout-method-${agentId}`} value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {["mtn_momo", "airtel_money", "cash", "bank", "other"].map((m) => (
              <option key={m} value={m}>
                {methods[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`payout-tx-${agentId}`} label={s["agents.transactionId"]}>
          <Input id={`payout-tx-${agentId}`} value={transactionId} maxLength={80} onChange={(e) => setTransactionId(e.target.value)} />
        </Field>
        <Field id={`payout-date-${agentId}`} label={s["agents.paidOn"]}>
          <Input id={`payout-date-${agentId}`} type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
      </div>
      <Button type="submit" variant="brand" size="sm" disabled={pending}>
        {s["agents.savePayout"]}
      </Button>
    </form>
  );
}

export function AgentActiveToggle({ agentId, active, s }: { agentId: string; active: boolean; s: Strings }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => void (await setAgentActiveAction(agentId, !active)))}>
      {active ? s["agents.deactivate"] : s["agents.activate"]}
    </Button>
  );
}
