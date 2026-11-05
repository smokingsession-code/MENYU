"use client";

import { useState, useTransition } from "react";
import { saveSettingsAction, type SettingsFormInput } from "@/app/(site)/admin/billing/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

type Values = { [K in keyof SettingsFormInput]: string };

export function SettingsForm({ initial, s }: { initial: Values; s: Record<string, string> }) {
  const [values, setValues] = useState<Values>(initial);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [key]: e.target.value });
  const error = (key: keyof Values) => (result?.tone === "error" && result.field === key ? result.text : undefined);

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await saveSettingsAction({
            ...values,
            trialDays: Number(values.trialDays),
            graceDays: Number(values.graceDays),
            agentCommissionUgx: Number(values.agentCommissionUgx.replace(/[,\s]/g, "")),
            referralMonths: Number(values.referralMonths),
          } as SettingsFormInput);
          setResult(r.ok ? { tone: "success", text: s["settings.saved"] } : { tone: "error", text: r.error, field: r.field });
        });
      }}
    >
      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="set-trial" label={s["settings.trialDays"]} hint={s["settings.trialDaysHint"]} error={error("trialDays")}>
          <Input id="set-trial" inputMode="numeric" value={values.trialDays} onChange={set("trialDays")} />
        </Field>
        <Field id="set-grace" label={s["settings.graceDays"]} hint={s["settings.graceDaysHint"]} error={error("graceDays")}>
          <Input id="set-grace" inputMode="numeric" value={values.graceDays} onChange={set("graceDays")} />
        </Field>
      </div>
      <fieldset className="space-y-4">
        <legend className="text-lg font-extrabold">{s["settings.momoTitle"]}</legend>
        <p className="text-sm text-muted">{s["settings.momoHint"]}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="set-mtn-code" label={s["settings.mtnCode"]} error={error("mtnCode")}>
            <Input id="set-mtn-code" inputMode="numeric" value={values.mtnCode} onChange={set("mtnCode")} />
          </Field>
          <Field id="set-mtn-name" label={s["settings.mtnName"]}>
            <Input id="set-mtn-name" value={values.mtnName} onChange={set("mtnName")} />
          </Field>
          <Field id="set-airtel-code" label={s["settings.airtelCode"]} error={error("airtelCode")}>
            <Input id="set-airtel-code" inputMode="numeric" value={values.airtelCode} onChange={set("airtelCode")} />
          </Field>
          <Field id="set-airtel-name" label={s["settings.airtelName"]}>
            <Input id="set-airtel-name" value={values.airtelName} onChange={set("airtelName")} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="text-lg font-extrabold">{s["settings.growthTitle"]}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="set-commission" label={s["settings.agentCommission"]} error={error("agentCommissionUgx")}>
            <Input id="set-commission" inputMode="numeric" value={values.agentCommissionUgx} onChange={set("agentCommissionUgx")} />
          </Field>
          <Field id="set-referral" label={s["settings.referralMonths"]} error={error("referralMonths")}>
            <Input id="set-referral" inputMode="numeric" value={values.referralMonths} onChange={set("referralMonths")} />
          </Field>
        </div>
      </fieldset>
      <Field id="set-support" label={s["settings.supportWhatsapp"]} hint={s["settings.supportWhatsappHint"]} error={error("supportWhatsapp")}>
        <Input id="set-support" type="tel" inputMode="tel" value={values.supportWhatsapp} onChange={set("supportWhatsapp")} />
      </Field>
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {s["settings.save"]}
      </Button>
    </form>
  );
}
