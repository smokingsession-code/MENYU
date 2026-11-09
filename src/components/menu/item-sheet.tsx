"use client";

import { useState } from "react";
import { dealIsOn, dealPrice } from "@/lib/deals";
import { formatUGX } from "@/lib/money";
import { imageSrcSet, imageUrl, pickWidth } from "@/lib/images/shared";
import { lineKey, unitPrice, type CartLine } from "@/lib/order";
import { addonsOf, sizesOf, type PublicDeal, type PublicItem } from "@/lib/menu/types";
import type { DinerStrings, Translate } from "./menu-app";
import { MinusIcon, PlusIcon } from "./icons";
import { Sheet } from "@/components/ui/sheet";
import { TagList } from "./tags";

export function ItemSheet({
  item,
  deal,
  open,
  onClose,
  onAdd,
  canOrder,
  soldOut,
  s,
  tr,
}: {
  item: PublicItem | null;
  /** A "Sell it today" deal on this dish, if one was on when the menu loaded. */
  deal?: PublicDeal;
  open: boolean;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
  canOrder: boolean;
  soldOut: boolean;
  s: DinerStrings;
  tr: Translate;
}) {
  return (
    <Sheet open={open && !!item} onClose={onClose} title={item ? tr(item.name, item.name_lg) : ""} closeLabel={s.close}>
      {/* Keyed by item so choices reset when a different dish opens. */}
      {item ? <ItemDetails key={item.id} item={item} deal={deal} onAdd={onAdd} onClose={onClose} canOrder={canOrder} soldOut={soldOut} s={s} tr={tr} /> : null}
    </Sheet>
  );
}

function ItemDetails({
  item,
  deal,
  onAdd,
  onClose,
  canOrder,
  soldOut,
  s,
  tr,
}: {
  item: PublicItem;
  deal?: PublicDeal;
  onAdd: (line: CartLine) => void;
  onClose: () => void;
  canOrder: boolean;
  soldOut: boolean;
  s: DinerStrings;
  tr: Translate;
}) {
  const sizes = sizesOf(item);
  const addons = addonsOf(item);
  const [sizeId, setSizeId] = useState<string | undefined>(sizes[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  // Decided when the dish opens (the sheet only ever renders in the browser).
  const [percentOff] = useState(() => (deal && dealIsOn(deal, Date.now()) ? deal.percent : 0));
  const off = (value: number) => (percentOff ? dealPrice(value, percentOff) : value);

  const size = sizes.find((x) => x.id === sizeId);
  const chosenAddons = addons.filter((a) => addonIds.includes(a.id)).map((a) => ({ id: a.id, name: tr(a.name, a.name_lg), price: a.price }));
  const price = unitPrice(item.price === null ? null : off(item.price), size ? off(size.price) : undefined, chosenAddons);
  const description = tr(item.description ?? "", item.description_lg);

  function add() {
    onAdd({
      key: lineKey(item.id, size?.id, chosenAddons.map((a) => a.id), note) + (percentOff ? `|-${percentOff}` : ""),
      itemId: item.id,
      name: tr(item.name, item.name_lg),
      sizeId: size?.id,
      sizeName: size ? tr(size.name, size.name_lg) : undefined,
      addons: chosenAddons,
      unitPrice: price,
      qty,
      note: note.trim() || undefined,
      ...(percentOff ? { percentOff } : {}),
    });
    onClose();
  }

  return (
    <div className="pb-2">
      {item.photo ? (
        <img
          src={imageUrl(item.photo, pickWidth(item.photo, 360))}
          srcSet={imageSrcSet(item.photo)}
          sizes="(min-width: 640px) 512px, 100vw"
          width={item.photo.w}
          height={item.photo.h}
          alt={tr(item.name, item.name_lg)}
          className="aspect-[4/3] w-full object-cover"
          style={{ backgroundColor: item.photo.color }}
          decoding="async"
        />
      ) : null}
      <div className="space-y-4 p-4">
        {percentOff ? (
          <p className="inline-block rounded-full bg-accent px-3 py-1 font-extrabold text-ink">
            {s.dealsTitle} · {s.dealOff.replace("{percent}", String(percentOff))}
          </p>
        ) : null}
        {item.tags.length ? <TagList tags={item.tags} s={s} /> : null}
        {description ? <p className="text-base text-muted">{description}</p> : null}
        {soldOut ? <p className="inline-block rounded-full bg-danger-soft px-3 py-1 font-bold text-danger">{s.soldOut}</p> : null}

        {sizes.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="mb-2 font-extrabold">{s.chooseSize}</legend>
            {sizes.map((option) => (
              <label key={option.id} className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border-2 border-line px-3 has-[:checked]:border-[var(--brand)]">
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="size"
                    value={option.id}
                    checked={sizeId === option.id}
                    onChange={() => setSizeId(option.id)}
                    disabled={!canOrder}
                    className="size-5 accent-[var(--brand)]"
                  />
                  {tr(option.name, option.name_lg)}
                </span>
                <span className="font-bold">
                  {percentOff ? <s className="mr-1.5 font-normal text-muted">{formatUGX(option.price)}</s> : null}
                  {formatUGX(off(option.price))}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {addons.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="mb-2 font-extrabold">{s.extras}</legend>
            {addons.map((option) => (
              <label key={option.id} className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border-2 border-line px-3 has-[:checked]:border-[var(--brand)]">
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={addonIds.includes(option.id)}
                    onChange={(e) => setAddonIds((ids) => (e.target.checked ? [...ids, option.id] : ids.filter((x) => x !== option.id)))}
                    disabled={!canOrder}
                    className="size-5 accent-[var(--brand)]"
                  />
                  {tr(option.name, option.name_lg)}
                </span>
                <span className="font-bold">+{formatUGX(option.price)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {canOrder && !soldOut ? (
          <>
            <div>
              <label htmlFor="item-note" className="mb-1.5 block font-extrabold">
                {s.note}
              </label>
              <input
                id="item-note"
                value={note}
                maxLength={120}
                onChange={(e) => setNote(e.target.value)}
                placeholder={s.notePlaceholder}
                className="block min-h-12 w-full rounded-xl border-2 border-line px-3 text-base focus:border-[var(--brand)] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="font-extrabold">{s.quantity}</span>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={s.less} className="inline-flex size-12 items-center justify-center rounded-full border-2 border-line">
                  <MinusIcon />
                </button>
                <output aria-live="polite" className="w-10 text-center text-xl font-extrabold">
                  {qty}
                </output>
                <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label={s.more} className="inline-flex size-12 items-center justify-center rounded-full border-2 border-line">
                  <PlusIcon />
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={add}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl px-4 text-lg font-extrabold"
              style={{ background: "var(--brand)", color: "var(--on-brand)" }}
            >
              {fill(s.addToOrder, formatUGX(price * qty))}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function fill(template: string, price: string) {
  return template.replace("{price}", price);
}
