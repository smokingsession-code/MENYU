"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/components/copy-button";
import { Sheet } from "@/components/ui/sheet";
import { dealPrice } from "@/lib/deals";
import { formatClock, parseTime } from "@/lib/hours";
import { imageSrcSet, imageUrl, pickWidth } from "@/lib/images/shared";
import { startingPrice, type PublicDeal, type PublicItem, type PublicMenu, type PublicSpecial } from "@/lib/menu/types";
import { formatUGX } from "@/lib/money";
import type { CartLine } from "@/lib/order";
import { specialOnAt, specialsScript } from "@/lib/specials";
import { fill } from "./hooks";
import type { DinerStrings, Translate } from "./menu-app";

const SPECIALS_ID = "menu-specials";

/** The Kampala clock time of an ISO moment, e.g. "9pm". Same on server and phone. */
export function kampalaClock(iso: string): string {
  const local = new Date(Date.parse(iso) + 3 * 3_600_000);
  return formatClock(local.getUTCHours() * 60 + local.getUTCMinutes());
}

/**
 * "Today only": the restaurant's Sell it today deals. Every deal is in the
 * page; the deals style sheet (see lib/deals) shows the ones still on, so
 * the list never jumps and disappears by itself at the end time.
 */
export function DealsBanner({
  deals,
  items,
  soldOut,
  canOrder,
  onAdd,
  onOpen,
  s,
  tr,
}: {
  deals: PublicDeal[];
  items: Map<string, PublicItem>;
  soldOut: Set<string>;
  canOrder: boolean;
  onAdd: (item: PublicItem) => void;
  onOpen: (item: PublicItem) => void;
  s: DinerStrings;
  tr: Translate;
}) {
  const shown = deals.filter((d, i) => items.has(d.item_id) && deals.findIndex((x) => x.item_id === d.item_id) === i);
  if (shown.length === 0) return null;
  return (
    <section id="menu-deals" aria-labelledby="deals-title" className="px-4 pt-4">
      <h2 id="deals-title" className="mb-2 text-xl font-extrabold">
        {s.dealsTitle}
      </h2>
      <ul className="space-y-2">
        {shown.map((deal) => {
          const item = items.get(deal.item_id)!;
          const name = tr(item.name, item.name_lg);
          const note = tr(deal.note ?? "", deal.note_lg);
          const { price, from } = startingPrice(item);
          const simple = item.options.length === 0 && item.price !== null;
          const out = soldOut.has(item.id);
          return (
            <li key={deal.id} className="dl-card" data-dl={deal.item_id}>
              <div className="flex gap-3 rounded-2xl border-2 p-3" style={{ borderColor: "var(--brand)", background: "var(--brand-soft)" }}>
                {item.photo ? (
                  <img
                    src={imageUrl(item.photo, pickWidth(item.photo, 80))}
                    srcSet={imageSrcSet(item.photo)}
                    sizes="80px"
                    width={80}
                    height={80}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-20 shrink-0 rounded-xl object-cover"
                    style={{ backgroundColor: item.photo.color }}
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-lg leading-snug font-extrabold">{name}</p>
                    <p className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-sm font-extrabold text-ink">{fill(s.dealOff, { percent: deal.percent })}</p>
                  </div>
                  {note ? <p className="text-base">{note}</p> : null}
                  {price !== null ? (
                    <p className="mt-0.5">
                      <s className="text-sm text-muted">{formatUGX(price)}</s>{" "}
                      <span className="text-lg font-extrabold">
                        {from ? fill(s.fromPrice, { price: formatUGX(dealPrice(price, deal.percent)) }) : formatUGX(dealPrice(price, deal.percent))}
                      </span>
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold">{out ? s.soldOut : fill(s.dealUntil, { time: kampalaClock(deal.ends_at) })}</p>
                    {canOrder && !out ? (
                      <button
                        type="button"
                        onClick={() => (simple ? onAdd(item) : onOpen(item))}
                        aria-label={fill(s.addNamed, { name })}
                        className="min-h-11 shrink-0 rounded-xl px-5 font-extrabold"
                        style={{ background: "var(--brand)", color: "var(--on-brand)" }}
                      >
                        + {s.add}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Today's specials and happy hours. Every special is sent with the page and
 * starts hidden; a tiny inline script shows the ones that are on (by the
 * phone's clock) as soon as the browser reads them, so nothing below moves
 * when React starts. After that a minute timer keeps them up to date.
 */
export function SpecialsBanner({
  specials,
  canOrder,
  onAdd,
  s,
  tr,
}: {
  specials: PublicSpecial[];
  canOrder: boolean;
  onAdd: (line: CartLine) => void;
  s: DinerStrings;
  tr: Translate;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (specials.length === 0) return null;

  const on = (sp: PublicSpecial) => now !== null && specialOnAt(sp.days, sp.start, sp.end, sp.starts_on, sp.ends_on, now);
  const any = specials.some(on);

  return (
    <>
      <section id={SPECIALS_ID} hidden={!any} suppressHydrationWarning aria-labelledby="specials-title" className="px-4 pt-4">
        <h2 id="specials-title" className="mb-2 text-xl font-extrabold">
          {s.specialsTitle}
        </h2>
        <ul className="space-y-2">
          {specials.map((sp) => {
            const title = tr(sp.title, sp.title_lg);
            const items = sp.items.map((i) => tr(i.name, i.name_lg)).join(", ");
            const start = parseTime(sp.start) ?? 0;
            const end = parseTime(sp.end) ?? 0;
            return (
              <li
                key={sp.id}
                hidden={!on(sp)}
                suppressHydrationWarning
                data-special={JSON.stringify([sp.days, sp.start, sp.end, sp.starts_on, sp.ends_on])}
                className="rounded-2xl border-2 p-3"
                style={{ borderColor: "var(--brand)", background: "var(--brand-soft)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-lg font-extrabold">{title}</p>
                  {sp.price !== null ? <p className="shrink-0 text-lg font-extrabold">{formatUGX(sp.price)}</p> : null}
                </div>
                {tr(sp.description ?? "", sp.description_lg) ? <p className="text-base">{tr(sp.description ?? "", sp.description_lg)}</p> : null}
                {items ? <p className="text-sm text-muted">{fill(s.specialWith, { items })}</p> : null}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-bold">{start === end ? s.specialAllDay : fill(s.specialUntil, { time: formatClock(end) })}</p>
                  {canOrder && sp.price !== null ? (
                    <button
                      type="button"
                      onClick={() =>
                        onAdd({
                          key: `special|${sp.id}`,
                          itemId: `special:${sp.id}`,
                          name: items ? `${title} (${items})` : title,
                          addons: [],
                          unitPrice: sp.price ?? 0,
                          qty: 1,
                        })
                      }
                      aria-label={fill(s.addNamed, { name: title })}
                      className="min-h-11 rounded-xl px-5 font-extrabold"
                      style={{ background: "var(--brand)", color: "var(--on-brand)" }}
                    >
                      + {s.add}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: specialsScript(SPECIALS_ID) }} />
    </>
  );
}

function CopyLine({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }
      }}
      className="min-h-11 rounded-xl border-2 border-line bg-card px-4 font-bold"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

/** The restaurant's MTN and Airtel merchant codes, with the order total, and cash. */
export function PaySheet({
  open,
  onClose,
  momo,
  acceptsCash,
  total,
  s,
}: {
  open: boolean;
  onClose: () => void;
  momo: NonNullable<PublicMenu["branch"]["momo"]>;
  acceptsCash: boolean;
  total: number;
  s: DinerStrings;
}) {
  const networks = (
    [
      [s.mtn, momo.mtn_code, momo.mtn_name],
      [s.airtel, momo.airtel_code, momo.airtel_name],
    ] as const
  ).filter(([, code]) => Boolean(code));
  return (
    <Sheet open={open} onClose={onClose} title={s.payMomo} closeLabel={s.close}>
      <div className="space-y-4">
        <p className="text-base">{s.payIntro}</p>
        {total > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-paper p-3">
            <div>
              <p className="text-sm text-muted">{s.payTotal}</p>
              <p className="text-2xl font-extrabold">{formatUGX(total)}</p>
            </div>
            <CopyLine value={String(total)} label={s.copyAmount} copiedLabel={s.copied} />
          </div>
        ) : null}
        {networks.map(([network, code, name]) => (
          <div key={network} className="space-y-1 rounded-2xl border-2 border-line p-3">
            <p className="font-extrabold">{network}</p>
            <p className="text-sm text-muted">{s.merchantCode}</p>
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-2xl font-extrabold tracking-wider">{code}</p>
              <CopyLine value={code ?? ""} label={s.copyCode} copiedLabel={s.copied} />
            </div>
            {name ? <p className="text-sm">{fill(s.accountName, { name })}</p> : null}
          </div>
        ))}
        {acceptsCash ? (
          <div className="space-y-1 rounded-2xl border-2 border-line p-3">
            <p className="font-extrabold">{s.payCash}</p>
            <p className="text-base">{s.payCashBody}</p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

type FeedbackState = "idle" | "sending" | "done" | "too_many" | "error";

/** 1 to 5 stars and an optional comment, sent privately to the owner. */
export function FeedbackSheet({
  open,
  onClose,
  slug,
  table,
  s,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  table: string | null;
  s: DinerStrings;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<FeedbackState>("idle");
  const [hint, setHint] = useState(false);

  async function send() {
    if (rating === 0) return setHint(true);
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ s: slug, r: rating, c: comment.trim().slice(0, 1000), tb: table }),
      });
      setState(res.ok ? "done" : res.status === 429 ? "too_many" : "error");
    } catch {
      setState("error");
    }
  }

  const finished = state === "done" || state === "too_many";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={s.feedbackTitle}
      closeLabel={s.close}
      footer={
        finished ? null : (
          <button
            type="button"
            onClick={send}
            disabled={state === "sending"}
            className="min-h-14 w-full rounded-2xl text-lg font-extrabold disabled:opacity-60"
            style={{ background: "var(--brand)", color: "var(--on-brand)" }}
          >
            {state === "sending" ? s.feedbackSending : s.feedbackSend}
          </button>
        )
      }
    >
      {finished ? (
        <p role="status" className="py-6 text-center text-lg font-bold">
          {state === "done" ? s.feedbackThanks : s.feedbackTooMany}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-muted">{s.feedbackPrivate}</p>
          <div role="radiogroup" aria-label={s.feedbackTitle} className="flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={fill(s.feedbackStars, { count: n })}
                onClick={() => {
                  setRating(n);
                  setHint(false);
                }}
                className="flex size-12 items-center justify-center text-4xl leading-none"
                style={{ color: n <= rating ? "#F4B400" : "#C9C4B8" }}
              >
                ★
              </button>
            ))}
          </div>
          {hint ? (
            <p role="alert" className="text-center font-bold text-danger">
              {s.feedbackPick}
            </p>
          ) : null}
          <label htmlFor="feedback-comment" className="block font-bold">
            {s.feedbackComment}
          </label>
          <textarea
            id="feedback-comment"
            value={comment}
            maxLength={1000}
            rows={3}
            onChange={(e) => setComment(e.target.value)}
            className="block w-full rounded-xl border-2 border-line bg-card px-4 py-2 text-base focus:border-[var(--brand)] focus:outline-none"
          />
          {state === "error" ? (
            <p role="alert" className="font-bold text-danger">
              {s.feedbackFailed}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
