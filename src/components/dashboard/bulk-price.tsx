"use client";

import { useState, useTransition } from "react";
import { bulkPriceAction } from "@/app/(site)/dashboard/[restaurantId]/menu/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { adjustPrice, formatUGX } from "@/lib/money";
import type { EditorItem } from "./item-editor";

type Strings = Record<string, string>;

export function BulkPriceSheet({
  restaurantId,
  open,
  onClose,
  categories,
  s,
}: {
  restaurantId: string;
  open: boolean;
  onClose: () => void;
  categories: { id: string; name: string; items: EditorItem[] }[];
  s: Strings;
}) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [percent, setPercent] = useState("10");
  const [round, setRound] = useState(500);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const chosen = categories.filter((c) => selected === null || selected.includes(c.id));
  const prices = chosen.flatMap((c) => c.items.flatMap((i) => [i.price_ugx, ...i.options.map((o) => o.price_ugx)])).filter((p): p is number => p !== null);
  const pct = Number(percent.replace(",", "."));
  const valid = Number.isFinite(pct) && pct !== 0 && pct >= -90 && pct <= 300;
  const sample = prices.find((p) => p > 0);

  function apply() {
    setMessage(null);
    start(async () => {
      const result = await bulkPriceAction(restaurantId, selected, pct, round);
      if (!result.ok) setMessage({ tone: "error", text: result.error });
      else setMessage({ tone: "success", text: s.bulkDone.replace("{count}", String(result.count ?? 0)) });
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={s.bulkTitle} closeLabel={s.close}>
      <div className="space-y-5 p-4">
        <p className="text-muted">{s.bulkIntro}</p>
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <fieldset className="space-y-2">
          <legend className="mb-1 font-bold">{s.bulkWhich}</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5 accent-[#1e5b3a]" checked={selected === null} onChange={(e) => setSelected(e.target.checked ? null : [])} />
            {s.bulkAll}
          </label>
          {categories.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-[#1e5b3a]"
                checked={selected === null || selected.includes(c.id)}
                onChange={(e) => {
                  const base = selected ?? categories.map((x) => x.id);
                  setSelected(e.target.checked ? [...base, c.id] : base.filter((x) => x !== c.id));
                }}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        <Field id="bulk-percent" label={s.bulkPercent} hint={s.bulkPercentHint}>
          <Input id="bulk-percent" value={percent} inputMode="decimal" onChange={(e) => setPercent(e.target.value)} />
        </Field>
        <Field id="bulk-round" label={s.bulkRound}>
          <select id="bulk-round" value={round} onChange={(e) => setRound(Number(e.target.value))} className={inputClass}>
            <option value={1}>{s.bulkRoundNone}</option>
            <option value={100}>UGX 100</option>
            <option value={500}>UGX 500</option>
            <option value={1000}>UGX 1,000</option>
          </select>
        </Field>
        {valid && sample ? (
          <p className="rounded-xl bg-paper p-3 font-bold">
            {s.bulkPreview.replace("{before}", formatUGX(sample)).replace("{after}", formatUGX(adjustPrice(sample, pct, round)))}
          </p>
        ) : null}
        <Button size="lg" className="w-full" disabled={!valid || prices.length === 0 || pending} onClick={apply}>
          {s.bulkApply.replace("{count}", String(prices.length))}
        </Button>
      </div>
    </Sheet>
  );
}
