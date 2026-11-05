import Link from "next/link";
import { Alert } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { MenuEditor, type EditorCategory } from "@/components/dashboard/menu-editor";
import type { EditorItem } from "@/components/dashboard/item-editor";
import { PLANS } from "@/config/plans";
import { getDashboardContext } from "@/lib/dashboard";
import { getTranslator, sectionStrings } from "@/lib/i18n";
import { photoStrings } from "@/lib/dashboard-strings";
import type { ImageDescriptor } from "@/lib/images/shared";
import { createClient } from "@/lib/supabase/server";

const t = getTranslator("en");

export default async function MenuPage({ params, searchParams }: PageProps<"/dashboard/[restaurantId]/menu">) {
  const { restaurantId } = await params;
  const { imported } = await searchParams;
  const importedCount = typeof imported === "string" && /^\d{1,5}$/.test(imported) ? Number(imported) : null;
  const ctx = await getDashboardContext(restaurantId);
  const supabase = await createClient();

  const [{ data: categories }, { data: soldOut }] = await Promise.all([
    supabase
      .from("categories")
      .select(
        "id, name, name_lg, is_hidden, sort_order, created_at, items(id, category_id, name, name_lg, description, description_lg, price_ugx, tags, is_hidden, photo, sort_order, created_at, deleted_at, item_options(id, kind, name, name_lg, price_ugx, sort_order, deleted_at))",
      )
      .eq("menu_id", ctx.branch.menuId)
      .is("deleted_at", null)
      .order("sort_order")
      .order("created_at"),
    supabase.from("sold_out").select("item_id").eq("branch_id", ctx.branch.id),
  ]);

  const data: EditorCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    name_lg: c.name_lg,
    is_hidden: c.is_hidden,
    items: c.items
      .filter((i) => !i.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
      .map(
        (i): EditorItem => ({
          id: i.id,
          category_id: i.category_id,
          name: i.name,
          name_lg: i.name_lg,
          description: i.description,
          description_lg: i.description_lg,
          price_ugx: i.price_ugx,
          tags: i.tags,
          is_hidden: i.is_hidden,
          photo: (i.photo as unknown as ImageDescriptor | null) ?? null,
          options: i.item_options
            .filter((o) => !o.deleted_at)
            .sort((a, b) => (a.kind === b.kind ? a.sort_order - b.sort_order : a.kind === "size" ? -1 : 1))
            .map((o) => ({ id: o.id, kind: o.kind as "size" | "addon", name: o.name, name_lg: o.name_lg, price_ugx: o.price_ugx })),
        }),
      ),
  }));

  const mode = ctx.canEditMenu ? "edit" : ctx.canToggleSoldOut ? "soldout" : "view";
  const strings = {
    ...sectionStrings("en", "editor"),
    close: t("common.close"),
    optional: t("common.optional"),
    saved: t("common.saved"),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{mode === "soldout" ? t("editor.staffTitle") : t("editor.title")}</h1>
        {mode === "edit" ? (
          <ButtonLink href={`/dashboard/${restaurantId}/import`} variant="outline" size="sm">
            {t("editor.fromPhotos")}
          </ButtonLink>
        ) : null}
      </div>
      {importedCount !== null && mode === "edit" ? <Alert tone="success">{t("editor.imported", { count: importedCount })}</Alert> : null}
      {mode === "soldout" ? <p className="text-muted">{t("editor.staffIntro")}</p> : null}
      {mode === "view" ? (
        <Alert tone="warning">
          {ctx.plan === "free" ? (
            <>
              {t("editor.freeNotice")}{" "}
              <Link href={`/dashboard/${restaurantId}/request`} className="underline">
                {t("request.cta")}
              </Link>
            </>
          ) : (
            t("editor.viewOnly")
          )}
        </Alert>
      ) : null}
      <MenuEditor
        restaurantId={restaurantId}
        menuId={ctx.branch.menuId}
        branchId={ctx.branch.id}
        categories={data}
        soldOut={(soldOut ?? []).map((x) => x.item_id)}
        mode={mode}
        freeLimit={ctx.role === "admin" && ctx.plan === "free" ? PLANS.free.limits.items : null}
        s={strings}
        tagLabels={{ popular: t("diner.tags.popular"), spicy: t("diner.tags.spicy"), vegetarian: t("diner.tags.vegetarian"), new: t("diner.tags.new") }}
        photoStrings={photoStrings()}
      />
    </div>
  );
}
