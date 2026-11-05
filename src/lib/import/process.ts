import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { countItems, toDraft } from "./draft";
import { extractMenu, type ExtractFailure, type ImportFile } from "./extract";
import { fakeExtract, fakeImportEnabled } from "./fake";
import { prepareFile } from "./files";

/**
 * The background half of a menu import: download the photos, have Claude
 * read them, and store an editable draft for the owner to review. Runs after
 * the response is sent (Next.js `after`), inside the same function as the
 * Server Action that started it.
 */

export type ImportFailureCode = ExtractFailure | "unsupported_file" | "damaged_file" | "timeout";

/** Failures worth retrying with the same photos. */
const RETRYABLE: ReadonlySet<string> = new Set(["busy", "too_slow", "timeout", "failed"]);
export const IMPORT_MAX_ATTEMPTS = 3;

export function canRetry(code: string | null, attempts: number): boolean {
  return code !== null && RETRYABLE.has(code) && attempts < IMPORT_MAX_ATTEMPTS;
}

/**
 * The import pages allow 300 s (maxDuration). Claude gets what is left of
 * 270 s, so there is time to record a slow read as failed before the
 * platform stops the function.
 */
const DEADLINE_MS = 270_000;
/** A row still "processing" after this was stopped mid-way (deploy, crash, time limit). */
export const STALE_AFTER_MS = 6 * 60 * 1000;

export interface StoredFile {
  path: string;
  mime: string;
  size: number;
  name: string;
}

export function importAvailable(): boolean {
  return fakeImportEnabled() || Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function processImport(importId: string): Promise<void> {
  const started = Date.now();
  const admin = createAdminClient();
  const { data: row } = await admin.from("menu_imports").select("id, files, status").eq("id", importId).maybeSingle();
  if (!row || row.status !== "processing") return;
  const files = row.files as unknown as StoredFile[];

  const finish = async (values: {
    status: "failed" | "needs_review";
    error_code?: ImportFailureCode | null;
    error_message?: string | null;
    ai_result?: Json;
    draft?: Json;
    model?: string;
    usage?: Json;
  }) => {
    const { error } = await admin.from("menu_imports").update(values).eq("id", importId).eq("status", "processing");
    if (error) console.error("[import] could not save the result", { importId, message: error.message });
  };
  const fail = (code: ImportFailureCode, detail?: string | null) =>
    finish({ status: "failed", error_code: code, error_message: detail ? detail.slice(0, 500) : null });

  try {
    const prepared: ImportFile[] = [];
    for (const f of files) {
      const { data, error } = await admin.storage.from("uploads").download(f.path);
      if (error || !data) return await fail("damaged_file", f.name);
      const result = await prepareFile(Buffer.from(await data.arrayBuffer()), f.mime);
      if (!result.ok) return await fail(result.reason === "unsupported" ? "unsupported_file" : "damaged_file", f.name);
      prepared.push(result.file);
    }

    const remaining = Math.max(10_000, DEADLINE_MS - (Date.now() - started));
    const outcome = fakeImportEnabled()
      ? await fakeExtract(files.map((f) => f.name))
      : await extractMenu(prepared, { signal: AbortSignal.timeout(remaining) });
    if (!outcome.ok) return await fail(outcome.code, outcome.detail);

    const draft = toDraft(outcome.extraction);
    if (countItems(draft) === 0) return await fail("unreadable", outcome.extraction.problem);
    await finish({
      status: "needs_review",
      error_code: null,
      error_message: null,
      ai_result: outcome.extraction as unknown as Json,
      draft: draft as unknown as Json,
      model: outcome.model,
      usage: outcome.usage as Json,
    });
  } catch (error) {
    console.error("[import] processing failed", { importId, message: (error as Error).message });
    await fail("failed");
  }
}

/** Marks imports that stopped mid-way as failed, so the owner can retry. */
export async function expireStaleImports(restaurantId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { error } = await createAdminClient()
    .from("menu_imports")
    .update({ status: "failed", error_code: "timeout" satisfies ImportFailureCode })
    .eq("restaurant_id", restaurantId)
    .eq("status", "processing")
    .lt("updated_at", cutoff);
  if (error) console.error("[import] could not expire stale imports", { message: error.message });
}
