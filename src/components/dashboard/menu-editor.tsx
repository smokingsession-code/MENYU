"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createCategoryAction,
  deleteCategoryAction,
  reorderAction,
  setItemHiddenAction,
  setSoldOutAction,
  updateCategoryAction,
} from "@/app/(site)/dashboard/[restaurantId]/menu/actions";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { imageUrl, pickWidth } from "@/lib/images/shared";
import { formatUGX } from "@/lib/money";
import { matchesQuery } from "@/lib/text";
import { BulkPriceSheet } from "./bulk-price";
import { ItemEditor, type EditorItem } from "./item-editor";
import type { PhotoStrings } from "./photo-picker";

export interface EditorCategory {
  id: string;
  name: string;
  name_lg: string | null;
  is_hidden: boolean;
  items: EditorItem[];
}

type Strings = Record<string, string>;
type Mode = "edit" | "soldout" | "view";

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

function priceLabel(item: EditorItem): string {
  const sizes = item.options.filter((o) => o.kind === "size");
  if (sizes.length) return `${formatUGX(Math.min(...sizes.map((x) => x.price_ugx)))}+`;
  return item.price_ugx !== null ? formatUGX(item.price_ugx) : "";
}

export function MenuEditor({
  restaurantId,
  menuId,
  branchId,
  categories: initial,
  soldOut: initialSoldOut,
  mode,
  freeLimit,
  s,
  tagLabels,
  photoStrings,
}: {
  restaurantId: string;
  menuId: string;
  branchId: string;
  categories: EditorCategory[];
  soldOut: string[];
  mode: Mode;
  /** Set when an admin edits a Free restaurant: only this many dishes show. */
  freeLimit: number | null;
  s: Strings;
  tagLabels: Record<string, string>;
  photoStrings: PhotoStrings;
}) {
  // Local copies for instant feedback; they follow the server after each refresh.
  const [source, setSource] = useState(initial);
  const [categories, setCategories] = useState(initial);
  const [sourceSoldOut, setSourceSoldOut] = useState(initialSoldOut);
  const [soldOut, setSoldOut] = useState(() => new Set(initialSoldOut));
  if (initial !== source) {
    setSource(initial);
    setCategories(initial);
  }
  if (initialSoldOut !== sourceSoldOut) {
    setSourceSoldOut(initialSoldOut);
    setSoldOut(new Set(initialSoldOut));
  }

  const [query, setQuery] = useState("");
  // Which dish is open: its id (null for a new dish) and its section.
  const [editing, setEditing] = useState<{ itemId: string | null; categoryId: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, start] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, rollback?: () => void) =>
    start(async () => {
      setError(null);
      const result = await task();
      if (!result.ok) {
        rollback?.();
        setError(result.error ?? s["errors.invalid"]);
      }
    });

  function toggleSoldOut(item: EditorItem) {
    const next = !soldOut.has(item.id);
    const previous = new Set(soldOut);
    setSoldOut((current) => {
      const copy = new Set(current);
      if (next) copy.add(item.id);
      else copy.delete(item.id);
      return copy;
    });
    run(() => setSoldOutAction(restaurantId, branchId, item.id, next), () => setSoldOut(previous));
  }

  function onCategoryDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = categories.findIndex((c) => c.id === active.id);
    const to = categories.findIndex((c) => c.id === over.id);
    const previous = categories;
    const next = arrayMove(categories, from, to);
    setCategories(next);
    run(() => reorderAction(restaurantId, "categories", next.map((c) => c.id)), () => setCategories(previous));
  }

  function onItemDragEnd(categoryId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const previous = categories;
    const next = categories.map((c) => {
      if (c.id !== categoryId) return c;
      const from = c.items.findIndex((i) => i.id === active.id);
      const to = c.items.findIndex((i) => i.id === over.id);
      return { ...c, items: arrayMove(c.items, from, to) };
    });
    setCategories(next);
    const ids = next.find((c) => c.id === categoryId)!.items.map((i) => i.id);
    run(() => reorderAction(restaurantId, "items", ids), () => setCategories(previous));
  }

  function move(categoryId: string, itemId: string | null, delta: -1 | 1) {
    // Buttons for people who prefer not to drag (and for keyboards).
    if (itemId === null) {
      const from = categories.findIndex((c) => c.id === categoryId);
      const to = from + delta;
      if (to < 0 || to >= categories.length) return;
      onCategoryDragEnd({ active: { id: categoryId }, over: { id: categories[to].id } } as DragEndEvent);
    } else {
      const items = categories.find((c) => c.id === categoryId)!.items;
      const from = items.findIndex((i) => i.id === itemId);
      const to = from + delta;
      if (to < 0 || to >= items.length) return;
      onItemDragEnd(categoryId, { active: { id: itemId }, over: { id: items[to].id } } as DragEndEvent);
    }
  }

  const filtered = query.trim()
    ? categories
        .map((c) => ({ ...c, items: c.items.filter((i) => matchesQuery(`${i.name} ${i.description ?? ""}`, query)) }))
        .filter((c) => c.items.length > 0)
    : categories;
  const total = categories.reduce((n, c) => n + c.items.length, 0);
  const canDrag = mode === "edit" && !query.trim();

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {freeLimit !== null && mode === "edit" && total > freeLimit ? <Alert tone="warning">{fill(s.freeLimit, { limit: freeLimit })}</Alert> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="editor-search" className="sr-only">
          {s.search}
        </label>
        <input id="editor-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.search} className={`${inputClass} flex-1`} />
        {mode === "edit" && total > 0 ? (
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            {s.bulkPrices}
          </Button>
        ) : null}
      </div>

      {categories.length === 0 ? <p className="rounded-xl bg-card p-4 text-lg">{s.emptyMenu}</p> : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onCategoryDragEnd}>
        <SortableContext items={filtered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {filtered.map((category, index) => (
              <SortableBlock key={category.id} id={category.id} disabled={!canDrag}>
                {(handle) => (
                  <section className="rounded-[var(--radius-card)] border border-line bg-card" aria-labelledby={`cat-${category.id}`}>
                    <CategoryHeader
                      category={category}
                      mode={mode}
                      handle={canDrag ? handle : null}
                      first={index === 0}
                      last={index === filtered.length - 1}
                      s={s}
                      onMove={(delta) => move(category.id, null, delta)}
                      onRename={(name, name_lg) => run(() => updateCategoryAction(restaurantId, category.id, { name, name_lg }))}
                      onToggleHidden={() => run(() => updateCategoryAction(restaurantId, category.id, { is_hidden: !category.is_hidden }))}
                      onDelete={() => {
                        if (window.confirm(fill(s.deleteCategoryConfirm, { name: category.name, count: category.items.length }))) {
                          run(() => deleteCategoryAction(restaurantId, category.id));
                        }
                      }}
                    />
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onItemDragEnd(category.id, e)}>
                      <SortableContext items={category.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                        <ul className="divide-y divide-line">
                          {category.items.length === 0 ? <li className="px-4 py-3 text-muted">{s.emptyCategory}</li> : null}
                          {category.items.map((item, i) => (
                            <SortableBlock key={item.id} id={item.id} disabled={!canDrag} as="li">
                              {(itemHandle) => (
                                <ItemRow
                                  item={item}
                                  mode={mode}
                                  soldOut={soldOut.has(item.id)}
                                  handle={canDrag ? itemHandle : null}
                                  first={i === 0}
                                  last={i === category.items.length - 1}
                                  s={s}
                                  onOpen={() => setEditing({ itemId: item.id, categoryId: category.id })}
                                  onToggleSoldOut={() => toggleSoldOut(item)}
                                  onToggleHidden={() => run(() => setItemHiddenAction(restaurantId, item.id, !item.is_hidden))}
                                  onMove={(delta) => move(category.id, item.id, delta)}
                                />
                              )}
                            </SortableBlock>
                          ))}
                        </ul>
                      </SortableContext>
                    </DndContext>
                    {mode === "edit" ? (
                      <div className="border-t border-line p-2">
                        <Button variant="ghost" className="w-full" onClick={() => setEditing({ itemId: null, categoryId: category.id })}>
                          + {s.addItem}
                        </Button>
                      </div>
                    ) : null}
                  </section>
                )}
              </SortableBlock>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {mode === "edit" ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newCategory.trim();
            if (!name) return;
            run(async () => {
              const result = await createCategoryAction(restaurantId, menuId, name);
              if (result.ok) setNewCategory("");
              return result;
            });
          }}
        >
          <label htmlFor="new-category" className="sr-only">
            {s.addCategory}
          </label>
          <input id="new-category" value={newCategory} maxLength={80} onChange={(e) => setNewCategory(e.target.value)} placeholder={s.categoryNamePlaceholder} className={`${inputClass} flex-1`} />
          <Button type="submit" variant="brand">
            {s.addCategory}
          </Button>
        </form>
      ) : null}

      {mode === "edit" ? (
        <>
          <ItemEditor
            restaurantId={restaurantId}
            open={editing !== null}
            // Looked up in the latest data, so a just-created dish appears
            // (with its photo picker) as soon as the server refresh lands.
            item={editing?.itemId ? (categories.flatMap((c) => c.items).find((i) => i.id === editing.itemId) ?? null) : null}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            defaultCategoryId={editing?.categoryId ?? categories[0]?.id ?? ""}
            onClose={() => setEditing(null)}
            onSaved={(id, isNew) => {
              if (isNew) {
                setEditing((current) => ({ itemId: id, categoryId: current?.categoryId ?? "" }));
                setNotice(s.saved);
              } else {
                setEditing(null);
              }
            }}
            s={s}
            tagLabels={tagLabels}
            photoStrings={photoStrings}
          />
          <BulkPriceSheet restaurantId={restaurantId} open={bulkOpen} onClose={() => setBulkOpen(false)} categories={categories} s={s} />
        </>
      ) : null}
    </div>
  );
}

type Handle = { attributes: Record<string, unknown>; listeners: Record<string, unknown> | undefined };

function SortableBlock({ id, disabled, as = "div", children }: { id: string; disabled: boolean; as?: "div" | "li"; children: (handle: Handle) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const Tag = as;
  return (
    <Tag
      ref={setNodeRef as never}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: "relative", opacity: isDragging ? 0.85 : 1 }}
    >
      {children({ attributes: attributes as unknown as Record<string, unknown>, listeners })}
    </Tag>
  );
}

function DragHandle({ handle, label }: { handle: Handle; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted active:cursor-grabbing"
      {...handle.attributes}
      {...handle.listeners}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </svg>
    </button>
  );
}

function CategoryHeader({
  category,
  mode,
  handle,
  first,
  last,
  s,
  onMove,
  onRename,
  onToggleHidden,
  onDelete,
}: {
  category: EditorCategory;
  mode: Mode;
  handle: Handle | null;
  first: boolean;
  last: boolean;
  s: Strings;
  onMove: (delta: -1 | 1) => void;
  onRename: (name: string, nameLg: string) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  const [nameLg, setNameLg] = useState(category.name_lg ?? "");
  return (
    <div className="flex items-center gap-1 border-b border-line px-2 py-2">
      {handle ? <DragHandle handle={handle} label={s.drag} /> : null}
      {renaming ? (
        <form
          className="flex flex-1 flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setRenaming(false);
            if (name.trim() && (name.trim() !== category.name || nameLg.trim() !== (category.name_lg ?? ""))) onRename(name, nameLg);
          }}
        >
          <input aria-label={s.rename} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${inputClass} min-w-0 flex-1`} autoFocus />
          <Button type="submit" size="sm" variant="brand">
            {s.saveShort}
          </Button>
          <input
            aria-label={s.categoryLg}
            placeholder={s.categoryLg}
            value={nameLg}
            maxLength={80}
            onChange={(e) => setNameLg(e.target.value)}
            className={`${inputClass} w-full`}
          />
        </form>
      ) : (
        <h2 id={`cat-${category.id}`} className="min-w-0 flex-1 truncate px-2 text-lg font-extrabold">
          {category.name} <span className="text-sm font-bold text-muted">· {fill(s.itemsCount, { count: category.items.length })}</span>
          {category.is_hidden ? (
            <span className="ml-2 align-middle">
              <Badge tone="grey">{s.hidden}</Badge>
            </span>
          ) : null}
        </h2>
      )}
      {mode === "edit" && !renaming ? (
        <details className="relative">
          <summary className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-lg text-2xl leading-none font-bold" aria-label={s.sectionActions}>
            ⋯
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-line bg-card p-1 shadow-lg">
            <MenuButton onClick={() => setRenaming(true)}>{s.rename}</MenuButton>
            {!first ? <MenuButton onClick={() => onMove(-1)}>{s.moveUp}</MenuButton> : null}
            {!last ? <MenuButton onClick={() => onMove(1)}>{s.moveDown}</MenuButton> : null}
            <MenuButton onClick={onToggleHidden}>{category.is_hidden ? s.show : s.hide}</MenuButton>
            <MenuButton onClick={onDelete} danger>
              {s.delete}
            </MenuButton>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function MenuButton({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
        onClick();
      }}
      className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left font-bold hover:bg-paper ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}

function ItemRow({
  item,
  mode,
  soldOut,
  handle,
  first,
  last,
  s,
  onOpen,
  onToggleSoldOut,
  onToggleHidden,
  onMove,
}: {
  item: EditorItem;
  mode: Mode;
  soldOut: boolean;
  handle: Handle | null;
  first: boolean;
  last: boolean;
  s: Strings;
  onOpen: () => void;
  onToggleSoldOut: () => void;
  onToggleHidden: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  if (mode === "soldout") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={soldOut}
        onClick={onToggleSoldOut}
        className="flex min-h-16 w-full items-center justify-between gap-3 px-4 text-left"
      >
        <span className="text-lg font-bold">{item.name}</span>
        <span className={`rounded-full px-3 py-1 text-sm font-extrabold ${soldOut ? "bg-danger text-white" : "bg-brand-soft text-brand-dark"}`}>
          {soldOut ? s.soldOut : s.available}
        </span>
      </button>
    );
  }
  return (
    <div className={`flex items-center gap-1 px-1 py-2 ${item.is_hidden ? "opacity-60" : ""}`}>
      {handle ? <DragHandle handle={handle} label={s.drag} /> : null}
      {item.photo ? (
        // Hidden on the narrowest phones so the name and price keep their room.
        <img src={imageUrl(item.photo, pickWidth(item.photo, 48))} alt="" width={48} height={48} loading="lazy" className="hidden size-12 shrink-0 rounded-lg object-cover min-[400px]:block" style={{ backgroundColor: item.photo.color }} />
      ) : null}
      <button type="button" onClick={onOpen} disabled={mode !== "edit"} className="min-h-12 min-w-0 flex-1 px-1 text-left">
        <span className="block truncate font-extrabold">{item.name}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <span className="whitespace-nowrap">{priceLabel(item)}</span>
          {item.is_hidden ? <Badge tone="grey">{s.hidden}</Badge> : null}
        </span>
      </button>
      {mode === "edit" ? (
        <details className="relative">
          <summary className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-lg text-2xl leading-none font-bold" aria-label={s.sectionActions}>
            ⋯
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-line bg-card p-1 shadow-lg">
            <MenuButton onClick={onOpen}>{s.editItem}</MenuButton>
            {!first ? <MenuButton onClick={() => onMove(-1)}>{s.moveUp}</MenuButton> : null}
            {!last ? <MenuButton onClick={() => onMove(1)}>{s.moveDown}</MenuButton> : null}
            <MenuButton onClick={onToggleHidden}>{item.is_hidden ? s.show : s.hide}</MenuButton>
          </div>
        </details>
      ) : null}
      {mode === "edit" ? (
        <button
          type="button"
          role="switch"
          aria-checked={!soldOut}
          aria-label={fill(soldOut ? s.markAvailable : s.markSoldOut, { name: item.name })}
          onClick={onToggleSoldOut}
          className={`min-h-11 shrink-0 rounded-full px-2.5 text-xs font-extrabold ${soldOut ? "bg-danger text-white" : "bg-brand-soft text-brand-dark"}`}
        >
          {soldOut ? s.soldOut : s.available}
        </button>
      ) : null}
    </div>
  );
}
