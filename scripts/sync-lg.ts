/**
 * Keeps messages/lg.json in step with messages/en.json: same keys, same
 * order. Existing Luganda translations are kept; new keys are added as ""
 * for a native speaker to fill in. Removed keys are dropped.
 * Never put machine-made Luganda here.
 *
 * Usage: npm run i18n:sync
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Tree = { [key: string]: string | Tree };

const root = join(__dirname, "..", "messages");

export function mirror(en: Tree, lg: Tree | undefined): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(en)) {
    const existing = lg?.[key];
    if (typeof value === "string") {
      out[key] = typeof existing === "string" ? existing : "";
    } else {
      out[key] = mirror(value, typeof existing === "object" ? existing : undefined);
    }
  }
  return out;
}

if (require.main === module) {
  const en = JSON.parse(readFileSync(join(root, "en.json"), "utf8")) as Tree;
  let lg: Tree | undefined;
  try {
    lg = JSON.parse(readFileSync(join(root, "lg.json"), "utf8")) as Tree;
  } catch {
    lg = undefined;
  }
  writeFileSync(join(root, "lg.json"), JSON.stringify(mirror(en, lg), null, 2) + "\n");
  console.log("messages/lg.json synced with en.json");
}
