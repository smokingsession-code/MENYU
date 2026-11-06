"use client";

import { useState, useTransition } from "react";
import { deleteSpecialAction, saveSpecialAction, setSpecialActiveAction, type SpecialInput } from "@/app/(site)/dashboard/[restaurantId]/specials/actions";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { formatClock, parseTime } from "@/lib/hours";
import { formatUGX } from "@/lib/money";
import { parsePrice } from "@/lib/price";
import { matchesQuery } from "@/lib/text";

type Strings = Record<string, string>;

export interface SpecialRow {
  id: string;
  title: string;
  title_lg: string | null;
  description: string | null;
  description_lg: string | null;
  price_ugx: number | null;
  days: number[];
  start_time: string;
  end_time: string;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  item_ids: string[];
}

export interface DishOption {
  id: string;
  name: string;
  category: string;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const hhmm = (value: string) => value.slice(0, 5);

function whenText(row: SpecialRow, s: Strings, dayNames: string[]): string {
  const days = row.days.length === 7 ? s.everyDay : row.days.map((d) => dayNames[d - 1]).join(", ");
  const start = parseTime(hhmm(row.start_time)) ?? 0;
  const end = parseTime(hhmm(row.end_time)) ?? 0;
  return `${days} · ${start === end ? s.timeAllDay : `${formatClock(start)} – ${formatClock(end)}`}`;
}

function SpecialForm({
  restaurantId,
  initial,
  dishes,
  dayNames,
  s,
  onDone,
}: {
  restaurantId: string;
  initial: SpecialRow | null;
  dishes: DishOption[];
  dayNames: string[];
  s: Strings;
  onDone: () => void;
}) {
  const allDayInitial = initial ? hhmm(initial.start_time) === hhmm(initial.end_time) : false;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [titleLg, setTitleLg] = useState(initial?.title_lg ?? "");
  const [descriptionLg, setDescriptionLg] = useState(initial?.description_lg ?? "");
  const [price, setPrice] = useState(initial?.price_ugx != null ? String(initial.price_ugx) : "");
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 2, 3, 4, 5]);
  const [allDay, setAllDay] = useState(allDayInitial);
  const [start, setStart] = useState(initial && !allDayInitial ? hhmm(initial.start_time) : "16:00");
  const [end, setEnd] = useState(initial && !allDayInitial ? hhmm(initial.end_time) : "19:00");
  const [startsOn, setStartsOn] = useState(initial?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(initial?.ends_on ?? "");
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [itemIds, setItemIds] = useState<string[]>(initial?.item_ids ?? []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [pending, start_] = useTransition();

  const shown = query.trim() ? dishes.filter((d) => matchesQuery(`${d.name} ${d.category}`, query)) : dishes.filter((d) => itemIds.includes(d.id));
  const err = (field: string) => (error?.field === field ? error.text : undefined);

  function submit() {
    setError(null);
    const parsed = price.trim() ? parsePrice(price) : null;
    if (price.trim() && parsed?.value == null) return setError({ text: s["errors.price"], field: "priceUgx" });
    const input: SpecialInput = {
      id: initial?.id,
      title,
      description,
      titleLg,
      descriptionLg,
      priceUgx: parsed?.value ?? null,
      days,
      allDay,
      start,
      end,
      startsOn,
      endsOn,
      isActive: active,
      itemIds,
    };
    start_(async () => {
      const r = await saveSpecialAction(restaurantId, input);
      if (!r.ok) return setError({ text: r.error, field: r.field });
      onDone();
    });
  }

  return (
    <div className="space-y-4">
      {error && !error.field ? <Alert tone="error">{error.text}</Alert> : null}
      <Field id="sp-title" label={s.name} error={err("title")}>
        <Input id="sp-title" value={title} maxLength={80} placeholder={s.namePlaceholder} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id="sp-desc" label={s.description}>
        <textarea id="sp-desc" value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} py-2`} />
      </Field>
      <Field id="sp-price" label={s.price} hint={s.priceHint} error={err("priceUgx")}>
        <Input id="sp-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="font-bold">{s.days}</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d].sort())}
                className={`min-h-11 min-w-12 rounded-full border-2 px-3 font-bold ${on ? "border-brand bg-brand text-white" : "border-line bg-card"}`}
              >
                {dayNames[d - 1]}
              </button>
            );
          })}
        </div>
        {err("days") ? <p className="text-sm font-semibold text-danger">{err("days")}</p> : null}
      </fieldset>

      <label className="flex min-h-11 items-center gap-3 font-bold">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
        {s.allDay}
      </label>
      {allDay ? null : (
        <div className="grid grid-cols-2 gap-3">
          <Field id="sp-start" label={s.from} error={err("start")}>
            <Input id="sp-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field id="sp-end" label={s.to} error={err("end")}>
            <Input id="sp-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      )}

      <details className="rounded-xl border border-line p-3" open={Boolean(startsOn || endsOn)}>
        <summary className="min-h-8 cursor-pointer font-bold">{s.dates}</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field id="sp-starts" label={s.startsOn}>
            <Input id="sp-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field id="sp-ends" label={s.endsOn} error={err("endsOn")}>
            <Input id="sp-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
      </details>

      <fieldset className="space-y-2">
        <legend className="font-bold">{s.dishes}</legend>
        <p className="text-sm text-muted">{s.dishesHint}</p>
        <label htmlFor="sp-search" className="sr-only">
          {s.searchDishes}
        </label>
        <Input id="sp-search" type="search" value={query} placeholder={s.searchDishes} onChange={(e) => setQuery(e.target.value)} />
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {shown.slice(0, 40).map((d) => (
            <li key={d.id}>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={itemIds.includes(d.id)}
                  onChange={(e) => setItemIds(e.target.checked ? [...itemIds, d.id].slice(0, 20) : itemIds.filter((x) => x !== d.id))}
                  className="size-5 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="min-w-0">
                  <span className="block font-bold">{d.name}</span>
                  <span className="block text-sm text-muted">{d.category}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <details className="rounded-xl border border-line p-3" open={Boolean(titleLg || descriptionLg)}>
        <summary className="min-h-8 cursor-pointer font-bold">{s.luganda}</summary>
        <div className="mt-3 space-y-3">
          <Field id="sp-title-lg" label={s.nameLg}>
            <Input id="sp-title-lg" value={titleLg} maxLength={80} onChange={(e) => setTitleLg(e.target.value)} />
          </Field>
          <Field id="sp-desc-lg" label={s.descriptionLg}>
            <textarea id="sp-desc-lg" value={descriptionLg} maxLength={300} rows={2} onChange={(e) => setDescriptionLg(e.target.value)} className={`${inputClass} py-2`} />
          </Field>
        </div>
      </details>

      <label className="flex min-h-11 items-center gap-3 font-bold">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-[var(--color-brand)]" />
        {s.active}
      </label>
      <Button size="lg" className="w-full" onClick={submit} disabled={pending}>
        {s.save}
      </Button>
    </div>
  );
}

export function SpecialsManager({
  restaurantId,
  specials,
  dishes,
  dayNames,
  s,
}: {
  restaurantId: string;
  specials: SpecialRow[];
  dishes: DishOption[];
  dayNames: string[];
  s: Strings;
}) {
  const [editing, setEditing] = useState<SpecialRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? null);
    });

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <Button
        className="w-full sm:w-auto"
        onClick={() => {
          setNotice(null);
          setEditing("new");
        }}
      >
        + {s.add}
      </Button>
      {specials.length === 0 ? <p className="rounded-xl bg-card p-4 text-lg">{s.empty}</p> : null}
      <ul className="space-y-3">
        {specials.map((row) => (
          <li key={row.id} className="space-y-2 rounded-[var(--radius-card)] border border-line bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 text-lg font-extrabold">{row.title}</p>
              <Badge tone={row.is_active ? "green" : "grey"}>{row.is_active ? s.on : s.off}</Badge>
            </div>
            <p className="text-muted">
              {whenText(row, s, dayNames)}
              {row.price_ugx !== null ? ` · ${formatUGX(row.price_ugx)}` : ""}
            </p>
            {row.description ? <p>{row.description}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                {s.edit}
              </Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setSpecialActiveAction(restaurantId, row.id, !row.is_active))}>
                {row.is_active ? s.off : s.on}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(fill(s.deleteConfirm, { name: row.title }))) run(() => deleteSpecialAction(restaurantId, row.id));
                }}
              >
                {s.delete}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? s.newTitle : s.editTitle} closeLabel={s.close}>
        {editing !== null ? (
          <SpecialForm
            key={editing === "new" ? "new" : editing.id}
            restaurantId={restaurantId}
            initial={editing === "new" ? null : editing}
            dishes={dishes}
            dayNames={dayNames}
            s={s}
            onDone={() => {
              setEditing(null);
              setNotice(s.saved);
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
