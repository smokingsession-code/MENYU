import type { PhotoStrings } from "@/components/dashboard/photo-picker";
import { getTranslator, sectionStrings, type Locale } from "@/lib/i18n";

/**
 * Strings for the photo picker, used on several dashboard screens. With
 * `enhance` (plans with auto-fix) the picker also offers to fix photos.
 */
export function photoStrings(locale: Locale = "en", options: { enhance?: boolean } = {}): PhotoStrings {
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
    ...(options.enhance
      ? {
          enhance: {
            button: p.enhance,
            working: p.enhancing,
            title: p.enhanceTitle,
            before: p.before,
            after: p.after,
            use: p.useFixed,
            keep: p.keepOriginal,
          },
        }
      : {}),
  };
}
