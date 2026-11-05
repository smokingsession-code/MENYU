"use client";

import { useState, useTransition } from "react";
import { addTablesAction, deleteTableAction, renameTableAction } from "@/app/(site)/dashboard/[restaurantId]/tables/actions";
import { Button, buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";

export interface TableRow {
  id: string;
  label: string;
  printed: string;
}

export function TablesManager({
  restaurantId,
  branchId,
  tables,
  s,
}: {
  restaurantId: string;
  branchId: string;
  tables: TableRow[];
  s: Record<string, string>;
}) {
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();

  const qr = (tableId: string, format: "png" | "svg") => `/api/qr/${restaurantId}?branch=${branchId}&table=${tableId}&format=${format}`;

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addTablesAction(restaurantId, branchId, input);
            if (r.ok) {
              setInput("");
              setMessage({ tone: "success", text: s.added.replace("{count}", String(r.count ?? 0)) });
            } else {
              setMessage({ tone: "error", text: r.error });
            }
          });
        }}
      >
        <label htmlFor="add-tables" className="block font-bold">
          {s.add}
        </label>
        <div className="flex gap-2">
          <input id="add-tables" value={input} onChange={(e) => setInput(e.target.value)} placeholder={s.addPlaceholder} className={`${inputClass} min-w-0 flex-1`} />
          <Button type="submit" variant="brand" disabled={pending || !input.trim()}>
            {s.add}
          </Button>
        </div>
        <p className="text-sm text-muted">{s.addHint}</p>
      </form>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {tables.length === 0 ? <p className="text-muted">{s.none}</p> : null}
      <ul className="divide-y divide-line">
        {tables.map((table) => (
          <li key={table.id} className="space-y-2 py-3">
            {renaming === table.id ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setRenaming(null);
                  start(async () => {
                    const r = await renameTableAction(restaurantId, table.id, label);
                    if (!r.ok) setMessage({ tone: "error", text: r.error });
                  });
                }}
              >
                <input aria-label={s.rename} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} className={`${inputClass} min-w-0 flex-1`} autoFocus />
                <Button type="submit" size="sm" variant="brand">
                  OK
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-lg font-extrabold">{table.printed}</span>
                <div className="flex flex-wrap gap-2">
                  <a href={qr(table.id, "png")} className={buttonClass("outline", "sm")} download>
                    PNG
                  </a>
                  <a href={qr(table.id, "svg")} className={buttonClass("outline", "sm")} download>
                    SVG
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRenaming(table.id);
                      setLabel(table.label);
                    }}
                  >
                    {s.rename}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => {
                      if (!window.confirm(s.deleteConfirm.replace("{name}", table.printed))) return;
                      start(async () => {
                        const r = await deleteTableAction(restaurantId, table.id);
                        if (!r.ok) setMessage({ tone: "error", text: r.error });
                      });
                    }}
                  >
                    {s.delete}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
