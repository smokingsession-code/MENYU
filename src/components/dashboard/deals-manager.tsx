"use client";

import { useState, useTransition } from "react";
import { endDealAction, startDealAction } from "@/app/(site)/dashboard/[restaurantId]/deals/actions";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { describedBy, Field, Input, inputClass } from "@/components/ui/field";
import { dealPrice, endsAtKampala } from "@/lib/deals";
import { formatUGX } from "@/lib/money";

type Strings = Record<string, string>;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export interface DealDish {
  id: string;
  name: string;
  category: string;
  /** Base price, or the smallest size price; null when not priced. */
  price: number | null;
}

export interface LiveDeal {
  id: string;
  itemName: string;
  percent: number;
  price: number | null;
  /** "9pm", already in Kampala time. */
  until: string;
}

const PERCENTS = [10, 20, 30, 50] as const;
type Until = "h1" | "h3" | "close" | "time";

export function DealsManager({
  restaurantId,
  branchId,
  dishes,
  live,
  closingTime,
  closingLabel,
  s,
}: {
  restaurantId: string;
  branchId: string;
  dishes: DealDish[];
  live: LiveDeal[];
  /** "22:00" when the branch is open now and its closing time is known. */
  closingTime: string | null;
  /** The same time as diners see it, e.g. "10pm". */
  closingLabel?: string | null;
  s: Strings;
}) {
  const [itemId, setItemId] = useState("");
  const [percent, setPercent] = useState<number>(30);
  const [until, setUntil] = useState<Until>(closingTime ? "close" : "h3");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [noteLg, setNoteLg] = useState("");
  const [result, setResult] = useState<{ ok: boolean; field?: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [ending, setEnding] = useState<string | null>(null);

  const dish = dishes.find((d) => d.id === itemId);
  const categories = [...new Set(dishes.map((d) => d.category))];

  function endsAt(): Date | null {
    const now = new Date();
    if (until === "h1") return new Date(now.getTime() + 60 * 60_000);
    if (until === "h3") return new Date(now.getTime() + 3 * 60 * 60_000);
    if (until === "close") return closingTime ? endsAtKampala(closingTime, now) : null;
    return endsAtKampala(time, now);
  }

  function submit() {
    setResult(null);
    if (!itemId) return setResult({ ok: false, field: "itemId", text: s["errors.dish"] });
    const end = endsAt();
    if (!end) return setResult({ ok: false, field: "endsAt", text: s["errors.time"] });
    start(async () => {
      const r = await startDealAction(restaurantId, branchId, { itemId, percent, endsAt: end.toISOString(), note, noteLg });
      if (r.ok) {
        setResult({ ok: true, text: s.started });
        setItemId("");
        setNote("");
        setNoteLg("");
      } else {
        setResult({ ok: false, field: r.field, text: r.error });
      }
    });
  }

  function end(id: string) {
    setEnding(id);
    start(async () => {
      const r = await endDealAction(restaurantId, id);
      setEnding(null);
      setResult(r.ok ? { ok: true, text: s.ended } : { ok: false, text: r.error });
    });
  }

  const err = (field: string) => (result && !result.ok && result.field === field ? result.text : undefined);

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h2 className="text-lg font-extrabold">{s.live}</h2>
        {live.length === 0 ? (
          <p className="text-muted">{s.none}</p>
        ) : (
          <ul className="divide-y divide-line">
            {live.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-extrabold">
                    {d.itemName} <Badge tone="yellow">{fill(s.percent, { percent: d.percent })}</Badge>
                  </p>
                  <p className="text-sm text-muted">
                    {d.price !== null ? `${formatUGX(d.price)} → ${formatUGX(dealPrice(d.price, d.percent))} · ` : ""}
                    {fill(s.endsAt, { time: d.until })}
                  </p>
                </div>
                <Button variant="danger" size="sm" onClick={() => end(d.id)} disabled={pending}>
                  {ending === d.id ? s.ending : s.end}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <Field id="deal-dish" label={s.dish} error={err("itemId")}>
          <select
            id="deal-dish"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className={inputClass}
            aria-invalid={Boolean(err("itemId")) || undefined}
            aria-describedby={describedBy("deal-dish", undefined, err("itemId"))}
          >
            <option value="">{s.dishPlaceholder}</option>
            {categories.map((c) => (
              <optgroup key={c} label={c}>
                {dishes
                  .filter((d) => d.category === c)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.price !== null ? ` · ${formatUGX(d.price)}` : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <fieldset>
          <legend className="mb-2 font-bold">{s.discount}</legend>
          <div className="grid grid-cols-4 gap-2">
            {PERCENTS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={percent === p}
                onClick={() => setPercent(p)}
                className="min-h-12 rounded-xl border-2 border-line font-extrabold aria-pressed:border-brand aria-pressed:bg-brand-soft"
              >
                {p}%
              </button>
            ))}
          </div>
          {dish?.price != null ? (
            <p className="mt-2 font-bold" aria-live="polite">
              {formatUGX(dish.price)} → {formatUGX(dealPrice(dish.price, percent))}
            </p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-bold">{s.until}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(["h1", "h3", ...(closingTime ? (["close"] as const) : [])] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={until === u}
                onClick={() => setUntil(u)}
                className="min-h-12 rounded-xl border-2 border-line px-3 font-bold aria-pressed:border-brand aria-pressed:bg-brand-soft"
              >
                {u === "close" && closingTime ? `${s["presets.close"]} (${closingLabel ?? closingTime})` : s[`presets.${u}`]}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Field id="deal-time" label={s.untilTime} error={err("endsAt")}>
              <Input
                id="deal-time"
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setUntil(e.target.value ? "time" : closingTime ? "close" : "h3");
                }}
                aria-invalid={Boolean(err("endsAt")) || undefined}
                aria-describedby={describedBy("deal-time", undefined, err("endsAt"))}
                className="max-w-40"
              />
            </Field>
          </div>
        </fieldset>

        <Field id="deal-note" label={s.note} optionalLabel={s.optional}>
          <Input id="deal-note" value={note} maxLength={120} placeholder={s.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field id="deal-note-lg" label={s.noteLg} optionalLabel={s.optional}>
          <Input id="deal-note-lg" value={noteLg} maxLength={120} onChange={(e) => setNoteLg(e.target.value)} />
        </Field>

        {result ? <Alert tone={result.ok ? "success" : "error"}>{result.text}</Alert> : null}
        <Button onClick={submit} disabled={pending} size="lg" className="w-full">
          {pending && !ending ? s.starting : s.start}
        </Button>
      </Card>
    </div>
  );
}
