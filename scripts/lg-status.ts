/**
 * How much of the Luganda UI text a native speaker has filled in, by
 * section, and (with --todo) every key still empty, with its English text.
 *
 * Usage: npm run i18n:status [-- --todo diner]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Tree = { [key: string]: string | Tree };

const root = join(__dirname, "..", "messages");
const en = JSON.parse(readFileSync(join(root, "en.json"), "utf8")) as Tree;
const lg = JSON.parse(readFileSync(join(root, "lg.json"), "utf8")) as Tree;

function leaves(tree: Tree, other: Tree | undefined, prefix: string, out: { key: string; en: string; lg: string }[]) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const theirs = other?.[key];
    if (typeof value === "string") out.push({ key: path, en: value, lg: typeof theirs === "string" ? theirs : "" });
    else leaves(value, typeof theirs === "object" ? theirs : undefined, path, out);
  }
  return out;
}

const all = leaves(en, lg, "", []);
const todoIndex = process.argv.indexOf("--todo");
const section = todoIndex >= 0 ? process.argv[todoIndex + 1] : undefined;

const bySection = new Map<string, { done: number; total: number }>();
for (const row of all) {
  const name = row.key.split(".")[0];
  const s = bySection.get(name) ?? { done: 0, total: 0 };
  s.total += 1;
  if (row.lg.trim()) s.done += 1;
  bySection.set(name, s);
}
const done = all.filter((r) => r.lg.trim()).length;
console.log(`Luganda: ${done} of ${all.length} strings filled in (${Math.round((done / all.length) * 100)}%).`);
for (const [name, s] of bySection) console.log(`  ${name.padEnd(14)} ${String(s.done).padStart(4)} / ${s.total}`);
if (todoIndex >= 0) {
  console.log("");
  for (const row of all.filter((r) => !r.lg.trim() && (!section || r.key.startsWith(`${section}.`)))) console.log(`${row.key}\n  ${row.en}\n`);
}
