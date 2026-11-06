"use client";

import { CUISINES } from "@/config/cuisines";
import { useState, useTransition } from "react";
import { saveProfileAction, type ProfileInput } from "@/app/(site)/dashboard/[restaurantId]/profile/actions";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { DAY_KEYS, type DayKey, type OpeningHours } from "@/lib/hours";
import type { ImageDescriptor } from "@/lib/images/shared";
import { mapsLink, parseMapPosition } from "@/lib/maps";
import { formatPhoneLocal } from "@/lib/phone";
import { PhotoPicker, type PhotoStrings } from "./photo-picker";

type Strings = Record<string, string>;

const COLORS = ["#1E5B3A", "#2F7A3E", "#0F766E", "#1D4ED8", "#6D28D9", "#B91C1C", "#C2410C", "#A16207", "#111827"];

export interface ProfileValues {
  name: string;
  description: string | null;
  descriptionLg: string | null;
  brandColor: string;
  logo: ImageDescriptor | null;
  cover: ImageDescriptor | null;
  cuisines: string[];
  priceRange: number | null;
  area: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  whatsapp: string | null;
  phone: string | null;
  hours: OpeningHours;
  acceptsDineIn: boolean;
  acceptsTakeaway: boolean;
  acceptsDelivery: boolean;
  deliveryNote: string | null;
  momoMtnCode: string | null;
  momoMtnName: string | null;
  momoAirtelCode: string | null;
  momoAirtelName: string | null;
}

type DayState = { open: boolean; ranges: [string, string][] };

function toDays(hours: OpeningHours): Record<DayKey, DayState> {
  return Object.fromEntries(
    DAY_KEYS.map((d) => {
      const ranges = (hours[d] ?? []) as [string, string][];
      return [d, { open: ranges.length > 0, ranges: ranges.length ? ranges : [["08:00", "22:00"]] }];
    }),
  ) as Record<DayKey, DayState>;
}

export function ProfileForm({
  restaurantId,
  branchId,
  initial,
  s,
  photoStrings,
}: {
  restaurantId: string;
  branchId: string;
  initial: ProfileValues;
  s: Strings;
  photoStrings: PhotoStrings;
}) {
  const [v, setV] = useState({
    ...initial,
    description: initial.description ?? "",
    descriptionLg: initial.descriptionLg ?? "",
    area: initial.area ?? "",
    address: initial.address ?? "",
    whatsapp: initial.whatsapp ? formatPhoneLocal(initial.whatsapp) : "",
    phone: initial.phone ? formatPhoneLocal(initial.phone) : "",
    deliveryNote: initial.deliveryNote ?? "",
    momoMtnCode: initial.momoMtnCode ?? "",
    momoMtnName: initial.momoMtnName ?? "",
    momoAirtelCode: initial.momoAirtelCode ?? "",
    momoAirtelName: initial.momoAirtelName ?? "",
  });
  const [days, setDays] = useState(() => toDays(initial.hours));
  const [mapLink, setMapLink] = useState("");
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((current) => ({ ...current, [key]: value }));

  function locate() {
    if (!navigator.geolocation) return setMapMessage(s.locationFailed);
    setMapMessage(s.locating);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setV((c) => ({ ...c, lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 }));
        setMapMessage(null);
      },
      () => setMapMessage(s.locationFailed),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function save() {
    setResult(null);
    const hours = Object.fromEntries(DAY_KEYS.map((d) => [d, days[d].open ? days[d].ranges : []]));
    const input: ProfileInput = {
      name: v.name,
      description: v.description,
      descriptionLg: v.descriptionLg,
      brandColor: v.brandColor,
      cuisines: v.cuisines,
      priceRange: v.priceRange,
      area: v.area,
      address: v.address,
      lat: v.lat,
      lng: v.lng,
      whatsapp: v.whatsapp,
      phone: v.phone,
      hours,
      acceptsDineIn: v.acceptsDineIn,
      acceptsTakeaway: v.acceptsTakeaway,
      acceptsDelivery: v.acceptsDelivery,
      deliveryNote: v.deliveryNote,
      momoMtnCode: v.momoMtnCode,
      momoMtnName: v.momoMtnName,
      momoAirtelCode: v.momoAirtelCode,
      momoAirtelName: v.momoAirtelName,
    };
    start(async () => {
      const r = await saveProfileAction(restaurantId, branchId, input);
      setResult(r.ok ? { tone: "success", text: s.saved } : { tone: "error", text: r.error, field: r.field });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const err = (field: string) => (result?.tone === "error" && result.field === field ? result.text : undefined);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}

      <Card className="space-y-5">
        <h2 className="text-lg font-extrabold">{s.look}</h2>
        <div className="space-y-1">
          <p className="font-bold">{s.logo}</p>
          <PhotoPicker restaurantId={restaurantId} target={{ kind: "logo" }} value={v.logo} onChange={(p) => set("logo", p)} s={photoStrings} />
        </div>
        <div className="space-y-1">
          <p className="font-bold">{s.cover}</p>
          <p className="text-sm text-muted">{s.coverHint}</p>
          <PhotoPicker restaurantId={restaurantId} target={{ kind: "cover" }} value={v.cover} onChange={(p) => set("cover", p)} s={photoStrings} />
        </div>
        <fieldset>
          <legend className="font-bold">{s.brandColor}</legend>
          <p className="mb-2 text-sm text-muted">{s.brandColorHint}</p>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={v.brandColor.toLowerCase() === c.toLowerCase()}
                onClick={() => set("brandColor", c)}
                className="size-11 rounded-full border-4 border-card shadow ring-2 ring-line aria-pressed:ring-ink"
                style={{ background: c }}
              />
            ))}
            <input type="color" aria-label={s.brandColor} value={v.brandColor} onChange={(e) => set("brandColor", e.target.value)} className="h-11 w-14 cursor-pointer rounded-lg border-2 border-line" />
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-5">
        <h2 className="text-lg font-extrabold">{s.basics}</h2>
        <Field id="p-name" label={s.name} error={err("name")}>
          <Input id="p-name" value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} aria-invalid={err("name") ? true : undefined} />
        </Field>
        <Field id="p-description" label={s.description} optionalLabel={s.optional}>
          <textarea id="p-description" value={v.description} maxLength={500} rows={2} placeholder={s.descriptionPlaceholder} onChange={(e) => set("description", e.target.value)} className={`${inputClass} py-2`} />
          <details className="mt-2 rounded-xl border border-line p-3" open={Boolean(v.descriptionLg)}>
            <summary className="min-h-8 cursor-pointer font-bold">{s.lugandaTitle}</summary>
            <p className="mt-1 text-sm text-muted">{s.lugandaHint}</p>
            <label htmlFor="p-description-lg" className="mt-2 block text-sm font-bold">
              {s.descriptionLg}
            </label>
            <textarea id="p-description-lg" value={v.descriptionLg} maxLength={500} rows={2} onChange={(e) => set("descriptionLg", e.target.value)} className={`${inputClass} py-2`} />
          </details>
        </Field>
        <fieldset>
          <legend className="mb-2 font-bold">{s.cuisines}</legend>
          <div className="flex flex-wrap gap-2">
            {CUISINES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={v.cuisines.includes(c)}
                onClick={() => set("cuisines", v.cuisines.includes(c) ? v.cuisines.filter((x) => x !== c) : [...v.cuisines, c].slice(0, 8))}
                className="min-h-11 rounded-full border-2 border-line px-4 font-bold aria-pressed:border-brand aria-pressed:bg-brand-soft"
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 font-bold">{s.priceRange}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={v.priceRange === n}
                onClick={() => set("priceRange", v.priceRange === n ? null : n)}
                className="min-h-11 rounded-xl border-2 border-line px-2 font-bold aria-pressed:border-brand aria-pressed:bg-brand-soft"
              >
                {s[`priceRanges.${n}`]}
              </button>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-5">
        <h2 className="text-lg font-extrabold">{s.contact}</h2>
        <Field id="p-whatsapp" label={s.whatsapp} error={err("whatsapp")}>
          <Input id="p-whatsapp" type="tel" inputMode="tel" value={v.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="0772 123 456" aria-invalid={err("whatsapp") ? true : undefined} />
        </Field>
        <Field id="p-phone" label={s.phone} optionalLabel={s.optional} error={err("phone")}>
          <Input id="p-phone" type="tel" inputMode="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0772 123 456" aria-invalid={err("phone") ? true : undefined} />
        </Field>
      </Card>

      <Card className="space-y-5">
        <h2 className="text-lg font-extrabold">{s.whereTitle}</h2>
        <Field id="p-area" label={s.area}>
          <Input id="p-area" value={v.area} maxLength={80} placeholder={s.areaPlaceholder} onChange={(e) => set("area", e.target.value)} />
        </Field>
        <Field id="p-address" label={s.address} optionalLabel={s.optional}>
          <Input id="p-address" value={v.address} maxLength={200} placeholder={s.addressPlaceholder} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <div className="space-y-2">
          <p className="font-bold">{s.mapPin}</p>
          <p className="text-sm text-muted">{s.mapPinHint}</p>
          <Button variant="outline" onClick={locate}>
            {s.useLocation}
          </Button>
          <div className="flex gap-2">
            <label htmlFor="p-maplink" className="sr-only">
              {s.pasteMapLink}
            </label>
            <input id="p-maplink" value={mapLink} onChange={(e) => setMapLink(e.target.value)} placeholder={s.pasteMapLink} className={`${inputClass} min-w-0 flex-1`} />
            <Button
              variant="outline"
              onClick={() => {
                const pos = parseMapPosition(mapLink);
                if (!pos) return setMapMessage(s.mapLinkInvalid);
                setV((c) => ({ ...c, lat: pos.lat, lng: pos.lng }));
                setMapLink("");
                setMapMessage(null);
              }}
            >
              OK
            </Button>
          </div>
          {mapMessage ? <p className="text-sm font-bold text-muted" role="status">{mapMessage}</p> : null}
          {v.lat !== null && v.lng !== null ? (
            <p className="flex flex-wrap items-center gap-3 text-sm">
              <span>{s.mapPinSet.replace("{lat}", String(v.lat)).replace("{lng}", String(v.lng))}</span>
              <a href={mapsLink(v.lat, v.lng)} target="_blank" rel="noopener noreferrer" className="font-bold text-brand underline">
                {s.checkMap}
              </a>
              <button type="button" className="font-bold text-muted underline" onClick={() => setV((c) => ({ ...c, lat: null, lng: null }))}>
                {s.clearPin}
              </button>
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-extrabold">{s.hoursTitle}</h2>
          <p className="text-sm text-muted">{s.hoursHint}</p>
        </div>
        {err("hours") ? <Alert tone="error">{err("hours")}</Alert> : null}
        <ul className="space-y-3">
          {DAY_KEYS.map((d) => (
            <li key={d} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{s[`days.${d}`]}</span>
                <label className="flex min-h-11 items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    checked={days[d].open}
                    onChange={(e) => setDays((c) => ({ ...c, [d]: { ...c[d], open: e.target.checked } }))}
                    className="size-5 accent-[#1e5b3a]"
                  />
                  {days[d].open ? s.open : s.closedDay}
                </label>
              </div>
              {days[d].open ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    aria-label={`${s[`days.${d}`]}: ${s.from}`}
                    value={days[d].ranges[0][0]}
                    onChange={(e) => setDays((c) => ({ ...c, [d]: { ...c[d], ranges: [[e.target.value, c[d].ranges[0][1]]] } }))}
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="time"
                    aria-label={`${s[`days.${d}`]}: ${s.to}`}
                    value={days[d].ranges[0][1]}
                    onChange={(e) => setDays((c) => ({ ...c, [d]: { ...c[d], ranges: [[c[d].ranges[0][0], e.target.value]] } }))}
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <Button variant="ghost" onClick={() => setDays((c) => Object.fromEntries(DAY_KEYS.map((d) => [d, { ...c.mon }])) as Record<DayKey, DayState>)}>
          {s.copyToAll}
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-extrabold">{s.ordersTitle}</h2>
        {([
          ["acceptsDineIn", s.dineIn],
          ["acceptsTakeaway", s.takeaway],
          ["acceptsDelivery", s.delivery],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex min-h-11 items-center gap-3 font-bold">
            <input type="checkbox" checked={v[key]} onChange={(e) => set(key, e.target.checked)} className="size-5 accent-[#1e5b3a]" />
            {label}
          </label>
        ))}
        {v.acceptsDelivery ? (
          <Field id="p-delivery" label={s.deliveryNote} optionalLabel={s.optional}>
            <Input id="p-delivery" value={v.deliveryNote} maxLength={200} placeholder={s.deliveryNotePlaceholder} onChange={(e) => set("deliveryNote", e.target.value)} />
          </Field>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-extrabold">{s.momoTitle}</h2>
          <p className="text-sm text-muted">{s.momoHint}</p>
        </div>
        {err("momoMtnCode") ? <Alert tone="error">{err("momoMtnCode")}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="p-mtn" label={s.mtnCode} optionalLabel={s.optional}>
            <Input id="p-mtn" inputMode="numeric" value={v.momoMtnCode} maxLength={20} onChange={(e) => set("momoMtnCode", e.target.value)} />
          </Field>
          <Field id="p-mtn-name" label={s.mtnName} optionalLabel={s.optional}>
            <Input id="p-mtn-name" value={v.momoMtnName} maxLength={80} onChange={(e) => set("momoMtnName", e.target.value)} />
          </Field>
          <Field id="p-airtel" label={s.airtelCode} optionalLabel={s.optional}>
            <Input id="p-airtel" inputMode="numeric" value={v.momoAirtelCode} maxLength={20} onChange={(e) => set("momoAirtelCode", e.target.value)} />
          </Field>
          <Field id="p-airtel-name" label={s.airtelName} optionalLabel={s.optional}>
            <Input id="p-airtel-name" value={v.momoAirtelName} maxLength={80} onChange={(e) => set("momoAirtelName", e.target.value)} />
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-20 z-10">
        <Button type="submit" size="lg" className="w-full shadow-lg" disabled={pending}>
          {pending ? s.saving : s.save}
        </Button>
      </div>
    </form>
  );
}
