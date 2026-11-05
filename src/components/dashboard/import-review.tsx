"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { publishImportAction, saveDraftAction } from "@/app/(site)/dashboard/[restaurantId]/import/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import {
  countItems,
  LIMITS,
  newId,
  publishProblems,
  TAGS,
  type DraftItem,
  type DraftOption,
  type DraftSection,
  type ImportDraft,
  type Tag,
} from "@/lib/import/draft";
import { formatUGX, groupThousands } from "@/lib/money";
import { parsePrice } from "@/lib/price";
import { DiscardImportButton } from "./import-progress";

type Strings = Record<string, string>;

export interface ImportPhoto {
  url: string;
  isPdf: boolean;
}

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const NO_FLAGS: DraftItem["unsure"] = { name: false, description: false, price: false, sizes: false };

function isFlagged(item: DraftItem) {
  return Object.values(item.unsure).some(Boolean) || [...item.sizes, ...item.addons].some((o) => o.unsure);
}

const flagClass = "border-accent-dark bg-accent-soft";

function Label({ htmlFor, text, flagged, s }: { htmlFor: string; text: string; flagged?: boolean; s: Strings }) {
  return (
    <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-bold text-muted">
      {text}
      {flagged ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-extrabold text-ink">{s.check}</span> : null}
    </label>
  );
}

/**
 * A price typed the way people write them ("15k", "15,000/="). The draft
 * keeps whole shillings; the box keeps what the owner typed.
 */
function PriceInput({
  id,
  label,
  value,
  flagged,
  invalid,
  compact,
  allowEmpty,
  onChange,
  s,
}: {
  id: string;
  label: string;
  value: number | null;
  flagged: boolean;
  invalid?: boolean;
  compact?: boolean;
  allowEmpty?: boolean;
  onChange: (value: number | null) => void;
  s: Strings;
}) {
  const [text, setText] = useState(value === null ? "" : groupThousands(value));
  const parsed = text.trim() ? parsePrice(text) : null;

  function update(next: string) {
    setText(next);
    onChange(next.trim() ? (parsePrice(next).value ?? null) : null);
  }

  let hint: ReactNode = null;
  if (!parsed) {
    hint = allowEmpty ? <span className="text-muted">{s.noPrice}</span> : null;
  } else if (parsed.value === null) {
    hint = <span className="font-bold text-danger">{s.priceInvalid}</span>;
  } else if (parsed.suggestion) {
    const suggestion = parsed.suggestion;
    hint = (
      <span className="font-bold text-ink">
        {fill(s.priceUnclear, { suggestion: formatUGX(suggestion) })}{" "}
        <button type="button" className="min-h-11 px-1 font-extrabold text-brand underline" onClick={() => update(groupThousands(suggestion))}>
          {s.use}
        </button>
      </span>
    );
  } else if (!compact || parsed.unsure) {
    hint = <span className={parsed.unsure ? "font-bold text-ink" : "text-muted"}>{fill(s.priceShows, { price: formatUGX(parsed.value) })}</span>;
  }

  return (
    <div className={compact ? "w-28 shrink-0" : "space-y-1"}>
      {compact ? null : <Label htmlFor={id} text={label} flagged={flagged} s={s} />}
      <input
        id={id}
        value={text}
        inputMode="numeric"
        autoComplete="off"
        aria-label={compact ? label : undefined}
        aria-invalid={invalid || (parsed !== null && parsed.value === null) || undefined}
        placeholder={s.pricePlaceholder}
        onChange={(e) => update(e.target.value)}
        className={`${inputClass} ${flagged ? flagClass : ""}`}
      />
      {hint ? <p className={`text-sm ${compact ? "mt-1" : ""}`}>{hint}</p> : null}
    </div>
  );
}

function OptionRows({
  itemId,
  kind,
  title,
  options,
  showProblems,
  onChange,
  s,
}: {
  itemId: string;
  kind: "sizes" | "addons";
  title: string;
  options: DraftOption[];
  showProblems: boolean;
  onChange: (options: DraftOption[]) => void;
  s: Strings;
}) {
  if (options.length === 0) return null;
  const set = (id: string, patch: Partial<DraftOption>) =>
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch, unsure: false } : o)));
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-muted">{title}</p>
      {options.map((o) => (
        <div key={o.id} className="flex items-start gap-2">
          <input
            id={`${kind}-name-${itemId}-${o.id}`}
            aria-label={`${title}: ${s.optionName}`}
            value={o.name}
            maxLength={60}
            placeholder={s.optionName}
            onChange={(e) => set(o.id, { name: e.target.value })}
            aria-invalid={(showProblems && !o.name.trim()) || undefined}
            className={`${inputClass} min-w-0 flex-1 ${o.unsure ? flagClass : ""}`}
          />
          <PriceInput
            id={`${kind}-price-${itemId}-${o.id}`}
            label={`${o.name || title}: ${s.optionPrice}`}
            value={o.price}
            flagged={o.unsure}
            invalid={showProblems && o.price === null}
            compact
            onChange={(price) => set(o.id, { price })}
            s={s}
          />
          <button
            type="button"
            onClick={() => onChange(options.filter((x) => x.id !== o.id))}
            aria-label={fill(s.removeOption, { name: o.name || title })}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl font-bold text-danger hover:bg-danger-soft"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/**
 * One dish. Memoised, with callbacks that never change, so typing in one dish
 * does not re-render a hundred others on a cheap phone.
 */
const DishEditor = memo(function DishEditor({
  sectionId,
  item,
  showProblems,
  onItem,
  onRemove,
  s,
  tagLabels,
}: {
  sectionId: string;
  item: DraftItem;
  showProblems: boolean;
  onItem: (sectionId: string, item: DraftItem) => void;
  onRemove: (sectionId: string, itemId: string) => void;
  s: Strings;
  tagLabels: Record<Tag, string>;
}) {
  const [describe, setDescribe] = useState(Boolean(item.description) || item.unsure.description);
  const flagged = isFlagged(item);
  const onChange = (next: DraftItem) => onItem(sectionId, next);
  const set = (patch: Partial<DraftItem>, field?: keyof DraftItem["unsure"]) =>
    onChange({ ...item, ...patch, unsure: field ? { ...item.unsure, [field]: false } : item.unsure });
  const addOption = (kind: "sizes" | "addons") => {
    const option: DraftOption = { id: newId(), name: "", price: null, unsure: false };
    onChange({ ...item, [kind]: [...item[kind], option] });
    focusSoon(`${kind}-name-${item.id}-${option.id}`);
  };

  return (
    <div id={`dish-${item.id}`} className={`space-y-3 p-3 ${flagged ? "border-l-4 border-accent-dark" : ""}`}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`name-${item.id}`} text={s.dishName} flagged={item.unsure.name} s={s} />
          <input
            id={`name-${item.id}`}
            value={item.name}
            maxLength={120}
            onChange={(e) => set({ name: e.target.value }, "name")}
            aria-invalid={(showProblems && !item.name.trim()) || undefined}
            className={`${inputClass} font-bold ${item.unsure.name ? flagClass : ""}`}
          />
        </div>
        <button
          type="button"
          onClick={() => onRemove(sectionId, item.id)}
          aria-label={fill(s.removeDish, { name: item.name.trim() || s.untitled })}
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl font-bold text-danger hover:bg-danger-soft"
        >
          ×
        </button>
      </div>

      {item.sizes.length === 0 ? (
        <PriceInput
          id={`price-${item.id}`}
          label={s.price}
          value={item.price}
          flagged={item.unsure.price}
          allowEmpty
          onChange={(price) => set({ price }, "price")}
          s={s}
        />
      ) : (
        <p className="text-sm font-bold text-muted">{s.pricedBySize}</p>
      )}

      {describe ? (
        <div className="space-y-1">
          <Label htmlFor={`desc-${item.id}`} text={s.description} flagged={item.unsure.description} s={s} />
          <textarea
            id={`desc-${item.id}`}
            value={item.description}
            maxLength={300}
            rows={2}
            onChange={(e) => set({ description: e.target.value }, "description")}
            className={`${inputClass} py-2 ${item.unsure.description ? flagClass : ""}`}
          />
        </div>
      ) : null}

      <OptionRows
        itemId={item.id}
        kind="sizes"
        title={s.sizes}
        options={item.sizes}
        showProblems={showProblems}
        onChange={(sizes) => onChange({ ...item, sizes, unsure: { ...item.unsure, sizes: false } })}
        s={s}
      />
      <OptionRows
        itemId={item.id}
        kind="addons"
        title={s.addons}
        options={item.addons}
        showProblems={showProblems}
        onChange={(addons) => onChange({ ...item, addons, unsure: { ...item.unsure, sizes: false } })}
        s={s}
      />

      <div className="flex flex-wrap gap-x-1">
        {item.sizes.length < LIMITS.options ? (
          <Button variant="ghost" size="sm" className="px-3" aria-label={s.addSize} onClick={() => addOption("sizes")}>
            + {s.sizeShort}
          </Button>
        ) : null}
        {item.addons.length < LIMITS.options ? (
          <Button variant="ghost" size="sm" className="px-3" aria-label={s.addAddon} onClick={() => addOption("addons")}>
            + {s.addonShort}
          </Button>
        ) : null}
        {describe ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="px-3"
            aria-label={s.addDescription}
            onClick={() => {
              setDescribe(true);
              focusSoon(`desc-${item.id}`);
            }}
          >
            + {s.descriptionShort}
          </Button>
        )}
      </div>

      <div role="group" aria-label={s.tags} className="flex flex-wrap gap-2">
        {TAGS.map((tag) => {
          const on = item.tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => set({ tags: on ? item.tags.filter((x) => x !== tag) : [...item.tags, tag] })}
              className={`min-h-11 rounded-full border-2 px-3 text-sm font-bold ${on ? "border-brand bg-brand text-white" : "border-line bg-card text-ink"}`}
            >
              {tagLabels[tag]}
            </button>
          );
        })}
      </div>

      {flagged ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...item,
              unsure: NO_FLAGS,
              sizes: item.sizes.map((o) => ({ ...o, unsure: false })),
              addons: item.addons.map((o) => ({ ...o, unsure: false })),
            })
          }
        >
          ✓ {s.looksRight}
        </Button>
      ) : null}
    </div>
  );
});

export function ImportReview({
  restaurantId,
  importId,
  initialDraft,
  photos,
  existingItems,
  note,
  freeLimit,
  s,
  tagLabels,
}: {
  restaurantId: string;
  importId: string;
  initialDraft: ImportDraft;
  photos: ImportPhoto[];
  /** Dishes already on the menu this import goes into. */
  existingItems: number;
  /** What the reader said it could not read, if anything. */
  note: string | null;
  /** Set for the Menyu team on a Free restaurant: only this many dishes show. */
  freeLimit: number | null;
  s: Strings;
  tagLabels: Record<Tag, string>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  // The dishes to check when the filter was switched on. They stay in view
  // while the owner fixes them, instead of vanishing on the first keystroke.
  const [focus, setFocus] = useState<ReadonlySet<string> | null>(null);
  const onlyFlagged = focus !== null;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [publishing, startPublish] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves run one after another, so an older draft never lands last.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const edits = useRef(0);
  const dirty = useRef(false);
  const unsaved = useRef<ImportDraft | null>(null);

  // Autosave a moment after the last edit.
  useEffect(() => {
    if (!dirty.current) return;
    unsaved.current = draft;
    const edit = ++edits.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      unsaved.current = null;
      queue.current = queue.current.then(async () => {
        try {
          const result = await saveDraftAction(restaurantId, importId, draft);
          if (edit !== edits.current) return;
          setSaveState(result.ok ? "saved" : "error");
          if (!result.ok) setError(result.error);
        } catch {
          if (edit === edits.current) setSaveState("error");
        }
      });
    }, 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [draft, restaurantId, importId]);

  // Leaving the screen within the autosave delay still saves the last edit.
  useEffect(
    () => () => {
      if (unsaved.current) void saveDraftAction(restaurantId, importId, unsaved.current);
    },
    [restaurantId, importId],
  );

  const problems = useMemo(() => publishProblems(draft), [draft]);
  const items = countItems(draft);
  const flaggedCount = draft.sections.reduce((n, sec) => n + sec.items.filter(isFlagged).length, 0);

  const edit = useCallback((fn: (current: ImportDraft) => ImportDraft) => {
    dirty.current = true;
    setDraft(fn);
    setSaveState("saving");
  }, []);
  const updateSection = useCallback(
    (id: string, fn: (section: DraftSection) => DraftSection) =>
      edit((d) => ({ ...d, sections: d.sections.map((sec) => (sec.id === id ? fn(sec) : sec)) })),
    [edit],
  );
  const onItem = useCallback(
    (sectionId: string, next: DraftItem) =>
      updateSection(sectionId, (sec) => ({ ...sec, items: sec.items.map((i) => (i.id === next.id ? next : i)) })),
    [updateSection],
  );
  const onRemove = useCallback(
    (sectionId: string, itemId: string) => updateSection(sectionId, (sec) => ({ ...sec, items: sec.items.filter((i) => i.id !== itemId) })),
    [updateSection],
  );

  function addDish(sectionId: string) {
    const item: DraftItem = { id: newId(), name: "", description: "", price: null, sizes: [], addons: [], tags: [], unsure: NO_FLAGS };
    updateSection(sectionId, (sec) => ({ ...sec, items: [...sec.items, item] }));
    setFocus(null);
    focusSoon(`name-${item.id}`);
  }

  function addSection() {
    const section: DraftSection = { id: newId(), name: s.newSection, items: [] };
    edit((d) => ({ ...d, sections: [...d.sections, section] }));
    setFocus(null);
    requestAnimationFrame(() => {
      const input = document.getElementById(`section-name-${section.id}`) as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  function askPublish() {
    setError(null);
    if (problems.length) {
      setShowProblems(true);
      setFocus(null);
      setError(s["errors.problems"]);
      const first = problems[0];
      const target =
        first.kind === "section_name" ? `section-name-${first.sectionId}` : first.kind === "empty" ? null : `dish-${first.itemId}`;
      if (target) requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    setPublishOpen(true);
  }

  function publish() {
    startPublish(async () => {
      // The publish carries this draft; a pending autosave is not needed.
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      unsaved.current = null;
      edits.current += 1;
      const result = await publishImportAction(restaurantId, importId, { draft, mode });
      if (!result.ok) {
        setPublishOpen(false);
        setError(result.error);
        return;
      }
      router.push(`/dashboard/${restaurantId}/menu?imported=${result.items}`);
    });
  }

  const problemText = (() => {
    const kinds = new Set(problems.map((p) => p.kind));
    return [
      kinds.has("empty") ? s["problems.empty"] : null,
      kinds.has("section_name") ? s["problems.sectionName"] : null,
      kinds.has("item_name") ? s["problems.itemName"] : null,
      kinds.has("option") ? s["problems.option"] : null,
    ].filter((x): x is string => Boolean(x));
  })();

  const visible = focus
    ? draft.sections.map((sec) => ({ ...sec, items: sec.items.filter((i) => focus.has(i.id)) })).filter((sec) => sec.items.length > 0)
    : draft.sections;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">{s.reviewTitle}</h1>
        <p className="text-muted">{fill(s.reviewIntro, { items, sections: draft.sections.length })}</p>
      </div>

      {note ? <Alert tone="warning">{fill(s.readerNote, { note })}</Alert> : null}

      {photos.length ? (
        <details className="rounded-[var(--radius-card)] border border-line bg-card">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold">{s.photosTitle}</summary>
          <div className="space-y-3 p-3 pt-0">
            {photos.map((photo, i) =>
              photo.isPdf ? (
                <a key={photo.url} href={photo.url} target="_blank" rel="noopener noreferrer" className="block min-h-11 font-bold text-brand underline">
                  {fill(s.pdf, { n: i + 1 })}
                </a>
              ) : (
                <a key={photo.url} href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
                  {/* Signed links to private storage, so not next/image. Only loads once opened. */}
                  <img src={photo.url} alt={fill(s.photo, { n: i + 1 })} loading="lazy" className="w-full rounded-xl border border-line" />
                </a>
              ),
            )}
          </div>
        </details>
      ) : null}

      {error ? (
        <Alert tone="error">
          <p>{error}</p>
          {showProblems && problemText.length ? (
            <ul className="mt-1 list-disc pl-5 font-normal">
              {problemText.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">{flaggedCount ? fill(s.toCheck, { count: flaggedCount }) : s.allChecked}</p>
        {flaggedCount || onlyFlagged ? (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={onlyFlagged}
            onClick={() =>
              setFocus(onlyFlagged ? null : new Set(draft.sections.flatMap((sec) => sec.items.filter(isFlagged).map((i) => i.id))))
            }
          >
            {onlyFlagged ? s.showAll : s.onlyFlagged}
          </Button>
        ) : null}
      </div>

      {onlyFlagged && flaggedCount === 0 ? <p className="rounded-xl bg-card p-4">{s.noneFlagged}</p> : null}

      {visible.map((section) => {
        const full = draft.sections.find((x) => x.id === section.id)!;
        return (
          <section key={section.id} aria-labelledby={`section-name-${section.id}`} className="rounded-[var(--radius-card)] border border-line bg-card">
            <div className="flex items-end gap-2 border-b border-line p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor={`section-name-${section.id}`} className="block text-sm font-bold text-muted">
                  {s.sectionName}
                </label>
                <input
                  id={`section-name-${section.id}`}
                  value={full.name}
                  maxLength={80}
                  placeholder={s.sectionPlaceholder}
                  onChange={(e) => {
                    const name = e.target.value;
                    updateSection(section.id, (sec) => ({ ...sec, name }));
                  }}
                  aria-invalid={(showProblems && !full.name.trim() && full.items.length > 0) || undefined}
                  className={`${inputClass} text-lg font-extrabold`}
                />
              </div>
              <button
                type="button"
                aria-label={`${s.removeSection}: ${full.name}`}
                onClick={() => {
                  if (full.items.length && !window.confirm(fill(s.removeSectionConfirm, { name: full.name, count: full.items.length }))) return;
                  edit((d) => ({ ...d, sections: d.sections.filter((x) => x.id !== section.id) }));
                }}
                className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl font-bold text-danger hover:bg-danger-soft"
              >
                ×
              </button>
            </div>
            <ul className="divide-y divide-line">
              {section.items.map((item) => (
                <li key={item.id}>
                  <DishEditor
                    sectionId={section.id}
                    item={item}
                    showProblems={showProblems}
                    onItem={onItem}
                    onRemove={onRemove}
                    s={s}
                    tagLabels={tagLabels}
                  />
                </li>
              ))}
            </ul>
            {!onlyFlagged && full.items.length < LIMITS.itemsPerSection ? (
              <div className="border-t border-line p-2">
                <Button variant="ghost" size="sm" onClick={() => addDish(section.id)}>
                  + {s.addDish}
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}

      {!onlyFlagged && draft.sections.length < LIMITS.sections ? (
        <Button variant="outline" className="w-full" onClick={addSection}>
          + {s.addSection}
        </Button>
      ) : null}

      <DiscardImportButton restaurantId={restaurantId} importId={importId} s={s} then={`/dashboard/${restaurantId}/import`} />

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 space-y-1 rounded-[var(--radius-card)] border border-line bg-card p-3 shadow-lg">
        <p className="text-center text-sm text-muted" role="status" aria-live="polite">
          {saveState === "saving" ? s.saving : saveState === "saved" ? s.saved : saveState === "error" ? s["errors.saveFailed"] : " "}
        </p>
        <Button size="lg" className="w-full" onClick={askPublish} disabled={publishing || items === 0}>
          {fill(s.publish, { count: items })}
        </Button>
      </div>

      <Sheet
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={s.publishTitle}
        closeLabel={s.close}
        footer={
          <Button size="lg" className="w-full" onClick={publish} disabled={publishing}>
            {publishing ? s.publishing : s.confirmPublish}
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-lg font-bold">{fill(s.publishSummary, { items, sections: draft.sections.filter((x) => x.items.length).length })}</p>
          {existingItems > 0 ? (
            <fieldset className="space-y-2">
              <legend className="sr-only">{s.publishTitle}</legend>
              {(["append", "replace"] as const).map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer gap-3 rounded-xl border-2 p-3 ${mode === value ? "border-brand bg-brand-soft" : "border-line"}`}
                >
                  <input type="radio" name="publish-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
                  <span>
                    <span className="block font-bold">{value === "append" ? s.modeAppend : s.modeReplace}</span>
                    <span className="block text-sm text-muted">
                      {fill(value === "append" ? s.modeAppendHint : s.modeReplaceHint, { count: existingItems })}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {flaggedCount ? <Alert tone="warning">{fill(s.stillToCheck, { count: flaggedCount })}</Alert> : null}
          {freeLimit !== null && items + (mode === "append" ? existingItems : 0) > freeLimit ? (
            <Alert tone="info">{fill(s.freeLimit, { limit: freeLimit })}</Alert>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
