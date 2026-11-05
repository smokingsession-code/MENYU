"use client";

import { useState, useTransition } from "react";
import { deleteItemAction, duplicateItemAction, saveItemAction } from "@/app/(site)/dashboard/[restaurantId]/menu/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, inputClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import type { ImageDescriptor } from "@/lib/images/shared";
import { formatUGX } from "@/lib/money";
import { parsePrice } from "@/lib/price";
import { PhotoPicker, type PhotoStrings } from "./photo-picker";

export interface EditorOption {
  id: string;
  kind: "size" | "addon";
  name: string;
  name_lg: string | null;
  price_ugx: number;
}

export interface EditorItem {
  id: string;
  category_id: string;
  name: string;
  name_lg: string | null;
  description: string | null;
  description_lg: string | null;
  price_ugx: number | null;
  tags: string[];
  is_hidden: boolean;
  photo: ImageDescriptor | null;
  options: EditorOption[];
}

type Strings = Record<string, string>;
const TAGS = ["popular", "spicy", "vegetarian", "new"] as const;

interface OptionDraft {
  key: string;
  id?: string;
  name: string;
  price: string;
}

function draftOptions(item: EditorItem | null, kind: "size" | "addon"): OptionDraft[] {
  return (item?.options ?? []).filter((o) => o.kind === kind).map((o) => ({ key: o.id, id: o.id, name: o.name, price: String(o.price_ugx) }));
}

let keySeq = 0;
const newKey = () => `new-${++keySeq}`;

export function ItemEditor({
  restaurantId,
  open,
  item,
  categories,
  defaultCategoryId,
  onClose,
  onSaved,
  s,
  tagLabels,
  photoStrings,
}: {
  restaurantId: string;
  open: boolean;
  item: EditorItem | null;
  categories: { id: string; name: string }[];
  defaultCategoryId: string;
  onClose: () => void;
  onSaved: (id: string, isNew: boolean) => void;
  s: Strings;
  tagLabels: Record<string, string>;
  photoStrings: PhotoStrings;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={item ? s.editItem : s.newItem} closeLabel={s.close}>
      {open ? (
        <EditorForm
          key={item?.id ?? `new-${defaultCategoryId}`}
          restaurantId={restaurantId}
          item={item}
          categories={categories}
          defaultCategoryId={defaultCategoryId}
          onClose={onClose}
          onSaved={onSaved}
          s={s}
          tagLabels={tagLabels}
          photoStrings={photoStrings}
        />
      ) : null}
    </Sheet>
  );
}

function PriceHint({ text, s, onUse }: { text: string; s: Strings; onUse: (value: number) => void }) {
  if (!text.trim()) return null;
  const parsed = parsePrice(text);
  if (parsed.value === null) return <p className="text-sm font-bold text-danger">{s["errors.invalid"]}</p>;
  if (parsed.suggestion) {
    return (
      <p className="text-sm font-bold text-ink">
        {s.priceUnclear.replace("{suggestion}", formatUGX(parsed.suggestion))}{" "}
        <button type="button" className="underline" onClick={() => onUse(parsed.suggestion!)}>
          {formatUGX(parsed.suggestion)}
        </button>
      </p>
    );
  }
  return <p className={`text-sm ${parsed.unsure ? "font-bold text-ink" : "text-muted"}`}>{s.priceHint.replace("{price}", formatUGX(parsed.value))}</p>;
}

function EditorForm({
  restaurantId,
  item,
  categories,
  defaultCategoryId,
  onClose,
  onSaved,
  s,
  tagLabels,
  photoStrings,
}: {
  restaurantId: string;
  item: EditorItem | null;
  categories: { id: string; name: string }[];
  defaultCategoryId: string;
  onClose: () => void;
  onSaved: (id: string, isNew: boolean) => void;
  s: Strings;
  tagLabels: Record<string, string>;
  photoStrings: PhotoStrings;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState(item?.category_id ?? defaultCategoryId);
  const [price, setPrice] = useState(item?.price_ugx !== null && item?.price_ugx !== undefined ? String(item.price_ugx) : "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [sizes, setSizes] = useState<OptionDraft[]>(() => draftOptions(item, "size"));
  const [addons, setAddons] = useState<OptionDraft[]>(() => draftOptions(item, "addon"));
  const [hidden, setHidden] = useState(item?.is_hidden ?? false);
  const [nameLg, setNameLg] = useState(item?.name_lg ?? "");
  const [descriptionLg, setDescriptionLg] = useState(item?.description_lg ?? "");
  const [photo, setPhoto] = useState<ImageDescriptor | null>(item?.photo ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function optionsPayload(): { ok: true; value: { id?: string; kind: "size" | "addon"; name: string; price_ugx: number }[] } | { ok: false } {
    const out: { id?: string; kind: "size" | "addon"; name: string; price_ugx: number }[] = [];
    for (const [kind, list] of [["size", sizes], ["addon", addons]] as const) {
      for (const o of list) {
        if (!o.name.trim() && !o.price.trim()) continue;
        const parsed = parsePrice(o.price);
        if (!o.name.trim() || parsed.value === null) return { ok: false };
        out.push({ id: o.id, kind, name: o.name.trim(), price_ugx: parsed.value });
      }
    }
    return { ok: true, value: out };
  }

  function save() {
    setError(null);
    const options = optionsPayload();
    if (!options.ok) return setError(s["errors.optionPrice"]);
    const parsed = price.trim() ? parsePrice(price) : { value: null };
    if (price.trim() && parsed.value === null) return setError(s["errors.invalid"]);
    start(async () => {
      const result = await saveItemAction(restaurantId, {
        id: item?.id,
        category_id: categoryId,
        name,
        name_lg: nameLg,
        description,
        description_lg: descriptionLg,
        price_ugx: parsed.value,
        tags: tags as ("popular" | "spicy" | "vegetarian" | "new")[],
        is_hidden: hidden,
        options: options.value,
      });
      if (!result.ok) setError(result.error);
      else onSaved(result.id!, !item);
    });
  }

  function remove() {
    if (!item || !window.confirm(s.deleteItemConfirm.replace("{name}", item.name))) return;
    start(async () => {
      const result = await deleteItemAction(restaurantId, item.id);
      if (!result.ok) setError(result.error);
      else onClose();
    });
  }

  function duplicate() {
    if (!item) return;
    start(async () => {
      const result = await duplicateItemAction(restaurantId, item.id);
      if (!result.ok) setError(result.error);
      else onSaved(result.id!, true);
    });
  }

  const optionList = (kind: "size" | "addon", list: OptionDraft[], setList: (l: OptionDraft[]) => void) => (
    <div className="space-y-2">
      {list.map((o, i) => (
        <div key={o.key} className="flex items-center gap-2">
          <input
            aria-label={kind === "size" ? s.sizeName : s.addonName}
            value={o.name}
            maxLength={60}
            placeholder={kind === "size" ? s.sizeName : s.addonName}
            onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            className={`${inputClass} min-w-0 flex-[2]`}
          />
          <input
            aria-label={s.optionPrice}
            value={o.price}
            inputMode="numeric"
            placeholder={s.optionPrice}
            onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => setList(list.filter((_, j) => j !== i))}
            aria-label={s.removeOption.replace("{name}", o.name || "")}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-xl font-bold text-danger"
          >
            ×
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => setList([...list, { key: newKey(), name: "", price: "" }])}>
        + {kind === "size" ? s.addSize : s.addAddon}
      </Button>
    </div>
  );

  return (
    <form
      className="space-y-5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field id="item-name" label={s.name}>
        <Input id="item-name" value={name} maxLength={120} required placeholder={s.namePlaceholder} onChange={(e) => setName(e.target.value)} autoFocus={!item} />
      </Field>
      <Field id="item-category" label={s.category}>
        <select id="item-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="item-price" label={s.price}>
        <Input id="item-price" value={price} inputMode="numeric" placeholder={s.pricePlaceholder} onChange={(e) => setPrice(e.target.value)} />
        <PriceHint text={price} s={s} onUse={(v) => setPrice(String(v))} />
        {sizes.length > 0 && !price.trim() ? <p className="text-sm text-muted">{s.priceFromSizes}</p> : null}
      </Field>
      <Field id="item-description" label={s.description} optionalLabel={s.optional}>
        <textarea
          id="item-description"
          value={description}
          maxLength={300}
          rows={2}
          placeholder={s.descriptionPlaceholder}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} py-2`}
        />
      </Field>
      <fieldset>
        <legend className="mb-2 font-bold">{s.tags}</legend>
        <div className="flex flex-wrap gap-2">
          {TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tags.includes(tag)}
              onClick={() => setTags((current) => (current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag]))}
              className="min-h-11 rounded-full border-2 border-line px-4 font-bold aria-pressed:border-brand aria-pressed:bg-brand-soft"
            >
              {tagLabels[tag]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="font-bold">{s.sizes}</legend>
        <p className="text-sm text-muted">{s.sizesHint}</p>
        {optionList("size", sizes, setSizes)}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="font-bold">{s.addons}</legend>
        <p className="text-sm text-muted">{s.addonsHint}</p>
        {optionList("addon", addons, setAddons)}
      </fieldset>
      {item ? (
        <fieldset className="space-y-1">
          <legend className="font-bold">{s.photo}</legend>
          <PhotoPicker restaurantId={restaurantId} target={{ kind: "item", itemId: item.id }} value={photo} onChange={setPhoto} s={photoStrings} />
        </fieldset>
      ) : null}
      <label className="flex min-h-12 items-center gap-3 font-bold">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="size-6 accent-[#1e5b3a]" />
        {s.hiddenToggle}
      </label>
      <details className="rounded-xl border-2 border-line p-3">
        <summary className="min-h-8 cursor-pointer font-bold">{s.luganda}</summary>
        <p className="mt-2 text-sm text-muted">{s.lugandaHint}</p>
        <div className="mt-3 space-y-3">
          <Field id="item-name-lg" label={s.nameLg}>
            <Input id="item-name-lg" value={nameLg} maxLength={120} onChange={(e) => setNameLg(e.target.value)} lang="lg" />
          </Field>
          <Field id="item-description-lg" label={s.descriptionLg}>
            <textarea id="item-description-lg" value={descriptionLg} maxLength={300} rows={2} onChange={(e) => setDescriptionLg(e.target.value)} className={`${inputClass} py-2`} lang="lg" />
          </Field>
        </div>
      </details>
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-line bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? s.saving : s.save}
        </Button>
        {item ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={duplicate} disabled={pending}>
              {s.duplicate}
            </Button>
            <Button variant="danger" className="flex-1" onClick={remove} disabled={pending}>
              {s.delete}
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
