import type { PhotoStrings } from "@/components/dashboard/photo-picker";
import { getTranslator, sectionStrings, type Locale } from "@/lib/i18n";

/** Strings for the photo picker, used on several dashboard screens. */
export function photoStrings(locale: Locale = "en"): PhotoStrings {
  const t = getTranslator(locale);
  const p = sectionStrings(locale, "photos");
  return {
    add: p.add,
    change: p.change,
    remove: p.remove,
    cropTitle: p.cropTitle,
    cropHint: p.cropHint,
    zoom: p.zoom,
    use: p.use,
    cancel: t("common.cancel"),
    uploading: p.uploading,
    processing: p.processing,
    errorFormat: p["errors.format"],
    errorFailed: p["errors.failed"],
  };
}
