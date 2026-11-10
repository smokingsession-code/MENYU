"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveOrderingAction, type OrderingInput } from "@/app/(site)/dashboard/[restaurantId]/ordering/actions";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { describedBy, Field, Input } from "@/components/ui/field";
import { formatUGX } from "@/lib/money";
import { parsePrice } from "@/lib/price";

type Strings = Record<string, string>;
type Mode = OrderingInput["mode"];

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function OrderingForm({
  restaurantId,
  branchId,
  initial,
  whatsapp,
  momoCodes,
  canKitchen,
  canLoyalty,
  loyaltyStats,
  modes,
  noModes,
  fallbackNote,
  showPayments,
  showLoyalty,
  s,
}: {
  restaurantId: string;
  branchId: string;
  initial: OrderingInput;
  /** The branch's WhatsApp number, formatted, or null. */
  whatsapp: string | null;
  /** "MTN 778899, Airtel 123456", or empty. */
  momoCodes: string;
  canKitchen: boolean;
  canLoyalty: boolean;
  loyaltyStats: string | null;
  /** Ways of ordering the admin has switched on (the others are not shown). */
  modes: Record<Mode, boolean>;
  /** Shown instead of the choices when none is switched on. */
  noModes: string | null;
  /** The saved choice is switched off: what the menu uses meanwhile. */
  fallbackNote: string | null;
  showPayments: boolean;
  showLoyalty: boolean;
  s: Strings;
}) {
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [acceptsCash, setAcceptsCash] = useState(initial.acceptsCash);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(initial.loyaltyEnabled);
  const [visits, setVisits] = useState(String(initial.loyaltyVisits));
  const [reward, setReward] = useState(initial.loyaltyReward);
  const [rewardLg, setRewardLg] = useState(initial.loyaltyRewardLg);
  const [min, setMin] = useState(initial.loyaltyMinUgx ? formatUGX(initial.loyaltyMinUgx).replace("UGX ", "") : "0");
  const [result, setResult] = useState<{ ok: boolean; field?: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  const base = `/dashboard/${restaurantId}`;

  const choices: { mode: Mode; disabled: boolean; hint: string; blocked?: React.ReactNode }[] = [
    { mode: "waiter", disabled: false, hint: s["modeHints.waiter"] },
    {
      mode: "whatsapp",
      disabled: !whatsapp,
      hint: fill(s["modeHints.whatsapp"], { phone: whatsapp ?? "" }),
      blocked: whatsapp ? null : (
        <Link href={`${base}/profile`} className="font-bold underline">
          {s.needsWhatsapp}
        </Link>
      ),
    },
    {
      mode: "kitchen",
      disabled: !canKitchen,
      hint: s["modeHints.kitchen"],
      blocked: canKitchen ? null : (
        <Link href={`${base}/billing`} className="font-bold underline">
          {s.kitchenPro}
        </Link>
      ),
    },
  ];

  function save() {
    setResult(null);
    const minValue = min.trim() === "" ? 0 : parsePrice(min).value;
    if (minValue === null) return setResult({ ok: false, field: "loyaltyMinUgx", text: s["errors.min"] });
    const visitCount = Number(visits);
    start(async () => {
      const r = await saveOrderingAction(restaurantId, branchId, {
        mode,
        acceptsCash,
        loyaltyEnabled,
        loyaltyVisits: Number.isInteger(visitCount) ? visitCount : 0,
        loyaltyReward: reward,
        loyaltyRewardLg: rewardLg,
        loyaltyMinUgx: minValue,
      });
      setResult(r.ok ? { ok: true, text: s.saved } : { ok: false, field: r.field, text: r.error });
    });
  }

  const err = (field: string) => (result && !result.ok && result.field === field ? result.text : undefined);

  return (
    <div className="space-y-4">
      {noModes ? (
        <Card>
          <p>{noModes}</p>
        </Card>
      ) : Object.values(modes).some(Boolean) ? (
      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{s.modeTitle}</h2>
        <div role="radiogroup" aria-label={s.modeTitle} className="space-y-2">
          {choices.filter((m) => modes[m.mode]).map((m) => (
            <label
              key={m.mode}
              className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft ${m.disabled ? "cursor-not-allowed opacity-70" : "border-line"}`}
            >
              <input
                type="radio"
                name="order-mode"
                value={m.mode}
                checked={mode === m.mode}
                disabled={m.disabled}
                onChange={() => setMode(m.mode)}
                className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]"
              />
              <span className="space-y-0.5">
                <span className="block font-extrabold">{s[`modes.${m.mode}`]}</span>
                <span className="block text-sm text-muted">{m.hint}</span>
                {m.blocked ? <span className="block text-sm">{m.blocked}</span> : null}
              </span>
            </label>
          ))}
        </div>
        {err("mode") ? <p role="alert" className="text-sm font-semibold text-danger">{err("mode")}</p> : null}
        {fallbackNote ? <p className="text-sm font-bold text-accent-dark">{fallbackNote}</p> : null}
        {modes.whatsapp ? <p className="text-sm text-muted">{s.deliveryNote}</p> : null}
      </Card>
      ) : null}

      {showPayments ? (
      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{s.payTitle}</h2>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" checked={acceptsCash} onChange={(e) => setAcceptsCash(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
          <span>
            <span className="block font-bold">{s.cash}</span>
            <span className="block text-sm text-muted">{s.cashHint}</span>
          </span>
        </label>
        <p className="text-sm">
          {momoCodes ? fill(s.momoCodes, { codes: momoCodes }) : s.momoNone}{" "}
          <Link href={`${base}/profile`} className="font-bold text-brand underline">
            {s.momoEdit}
          </Link>
        </p>
      </Card>
      ) : null}

      {showLoyalty ? (
      <Card className="space-y-3">
        <h2 className="text-lg font-extrabold">{s.loyaltyTitle}</h2>
        <p className="text-muted">{s.loyaltyIntro}</p>
        {canLoyalty ? (
          <>
            <label className="flex min-h-11 items-center gap-3 font-bold">
              <input type="checkbox" checked={loyaltyEnabled} onChange={(e) => setLoyaltyEnabled(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
              {s.loyaltyOn}
            </label>
            {loyaltyEnabled ? (
              <div className="space-y-3">
                <Field id="loyalty-visits" label={s.loyaltyVisits} error={err("loyaltyVisits")}>
                  <Input
                    id="loyalty-visits"
                    type="number"
                    inputMode="numeric"
                    min={2}
                    max={20}
                    value={visits}
                    onChange={(e) => setVisits(e.target.value)}
                    aria-invalid={Boolean(err("loyaltyVisits")) || undefined}
                    aria-describedby={describedBy("loyalty-visits", undefined, err("loyaltyVisits"))}
                    className="max-w-32"
                  />
                </Field>
                <Field id="loyalty-reward" label={s.loyaltyReward} hint={s.loyaltyRewardHint} error={err("loyaltyReward")}>
                  <Input
                    id="loyalty-reward"
                    value={reward}
                    maxLength={80}
                    placeholder={s.loyaltyRewardPlaceholder}
                    onChange={(e) => setReward(e.target.value)}
                    aria-invalid={Boolean(err("loyaltyReward")) || undefined}
                    aria-describedby={describedBy("loyalty-reward", s.loyaltyRewardHint, err("loyaltyReward"))}
                  />
                </Field>
                <Field id="loyalty-reward-lg" label={s.loyaltyRewardLg} optionalLabel={s.optional}>
                  <Input id="loyalty-reward-lg" value={rewardLg} maxLength={80} onChange={(e) => setRewardLg(e.target.value)} />
                </Field>
                <Field id="loyalty-min" label={s.loyaltyMin} hint={s.loyaltyMinHint} error={err("loyaltyMinUgx")}>
                  <Input
                    id="loyalty-min"
                    inputMode="numeric"
                    value={min}
                    onChange={(e) => setMin(e.target.value)}
                    aria-invalid={Boolean(err("loyaltyMinUgx")) || undefined}
                    aria-describedby={describedBy("loyalty-min", s.loyaltyMinHint, err("loyaltyMinUgx"))}
                    className="max-w-48"
                  />
                </Field>
              </div>
            ) : null}
            {loyaltyStats ? <p className="text-sm text-muted">{loyaltyStats}</p> : null}
          </>
        ) : (
          <p>
            <Link href={`${base}/billing`} className="font-bold text-brand underline">
              {s.loyaltyPro}
            </Link>
          </p>
        )}
      </Card>
      ) : null}

      {result ? <Alert tone={result.ok ? "success" : "error"}>{result.text}</Alert> : null}
      <Button onClick={save} disabled={pending} size="lg" className="w-full sm:w-auto">
        {pending ? s.saving : s.save}
      </Button>
    </div>
  );
}
