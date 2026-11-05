import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import lg from "../../messages/lg.json";
import { getTranslator, interpolate, translate } from "./i18n";
import { mirror } from "../../scripts/sync-lg";

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

describe("translations", () => {
  it("Luganda has exactly the same keys as English", () => {
    expect(keys(lg as Tree)).toEqual(keys(en as Tree));
  });

  it("lg.json is up to date (run npm run i18n:sync)", () => {
    expect(mirror(en as Tree, lg as Tree)).toEqual(lg);
  });

  it("has no empty English strings", () => {
    const walk = (t: Tree): string[] =>
      Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? (v.trim() ? [] : [k]) : walk(v)));
    expect(walk(en as Tree)).toEqual([]);
  });

  it("falls back to English when Luganda is empty", () => {
    expect(translate("lg", "common.save")).toBe("Save");
  });

  it("fills in variables and the brand name", () => {
    expect(interpolate("Hi {name} from {brand}", { name: "Sarah" })).toBe("Hi Sarah from Menyu");
    expect(getTranslator("en")("auth.codeSentPhone", { phone: "0772 123 456" })).toBe(
      "We sent a code to 0772 123 456.",
    );
    expect(interpolate("Keep {unknown}")).toBe("Keep {unknown}");
  });
});
