import en from "../../messages/en.json";
import lg from "../../messages/lg.json";
import { BRAND } from "@/config/brand";

/**
 * Translations live in messages/*.json. Luganda strings are left empty until
 * a native speaker fills them in; any empty string falls back to English.
 */
export const LOCALES = ["en", "lg"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

type Messages = typeof en;
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type Vars = Record<string, string | number>;
export type Translator = (key: MessageKey, vars?: Vars) => string;

const catalogs: Record<Locale, unknown> = { en, lg };

function lookup(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

export function interpolate(template: string, vars?: Vars): string {
  const all: Vars = { brand: BRAND.name, ...vars };
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(all, name) ? String(all[name]) : match,
  );
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const value = (locale !== "en" && lookup(catalogs[locale], key)) || lookup(en, key) || key;
  return interpolate(value, vars);
}

export function getTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  return (key, vars) => translate(locale, key, vars);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** True once a native speaker has filled in at least some Luganda UI text. */
export function hasLugandaUi(): boolean {
  const walk = (node: unknown): boolean =>
    typeof node === "string" ? node.trim().length > 0 : Object.values(node as object).some(walk);
  return walk(lg);
}

type Section = keyof Messages;

/**
 * Every string in one section, translated and flattened ("errors.invalid"),
 * for client components that need a whole screen's worth of text.
 */
export function sectionStrings(locale: Locale, section: Section): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, prefix: string) => {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") out[path] = translate(locale, `${section}.${path}` as MessageKey);
      else walk(value, path);
    }
  };
  walk(en[section], "");
  return out;
}

/**
 * Picks the strings a client component needs, already translated, so the
 * browser never downloads the whole catalogue.
 */
export function pick<K extends MessageKey>(t: Translator, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, t(k)])) as Record<K, string>;
}
