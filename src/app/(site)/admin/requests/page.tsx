import Link from "next/link";
import { Badge, Card } from "@/components/ui/card";
import { RequestControls } from "@/components/admin/request-controls";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { getTranslator, sectionStrings, type MessageKey } from "@/lib/i18n";
import { formatPhoneLocal } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { waLink } from "@/lib/whatsapp";

const t = getTranslator("en");

// "Import these photos" reads the menu in the background of its Server Action.
export const maxDuration = 300;

const FILTERS = { open: ["new", "in_progress"], done: ["done"], cancelled: ["cancelled"] } as const;
type Filter = keyof typeof FILTERS;

interface RequestFile {
  path: string;
  name: string;
  type: string;
}

export default async function AdminRequestsPage({ searchParams }: PageProps<"/admin/requests">) {
  await requireAdmin();
  const { show } = await searchParams;
  const filter: Filter = show === "done" || show === "cancelled" ? show : "open";
  const db = createAdminClient();
  const { data: requests } = await db
    .from("setup_requests")
    .select("id, kind, status, contact_name, contact_phone, notes, files, created_at, restaurants(id, name)")
    .in("status", [...FILTERS[filter]])
    .is("deleted_at", null)
    .order("created_at", { ascending: filter !== "open" ? false : true })
    .limit(100);

  // Short-lived links to the private photos, for viewing.
  const paths = (requests ?? []).flatMap((r) => ((r.files as unknown as RequestFile[]) ?? []).map((f) => f.path));
  const { data: signed } = paths.length ? await db.storage.from("uploads").createSignedUrls(paths, 3600) : { data: [] };
  const urls = new Map((signed ?? []).flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : [])));
  const s = sectionStrings("en", "admin");
  const rs = Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("requests.")).map(([k, v]) => [k.slice("requests.".length), v]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">{t("admin.requests.title")}</h1>
        <p className="text-muted">{t("admin.requests.intro")}</p>
      </div>
      <nav aria-label={t("admin.requests.title")} className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link
            key={f}
            href={f === "open" ? "/admin/requests" : `/admin/requests?show=${f}`}
            aria-current={filter === f ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-full border-2 px-4 font-bold ${filter === f ? "border-brand bg-brand text-white" : "border-line"}`}
          >
            {t(`admin.requests.${f}` as MessageKey)}
          </Link>
        ))}
      </nav>
      {(requests ?? []).length === 0 ? <p className="rounded-xl bg-card p-4">{t("admin.requests.none")}</p> : null}
      <ul className="space-y-3">
        {(requests ?? []).map((r) => {
          const files = (r.files as unknown as RequestFile[]) ?? [];
          return (
            <li key={r.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {r.restaurants ? (
                      <Link href={`/admin/restaurants/${r.restaurants.id}`} className="text-lg font-extrabold text-brand underline">
                        {r.restaurants.name}
                      </Link>
                    ) : (
                      <p className="text-lg font-extrabold">{t("admin.requests.noRestaurant")}</p>
                    )}
                    <p className="text-sm text-muted">
                      {t(`admin.requests.kind.${r.kind}` as MessageKey)} · {formatDateTime(r.created_at)}
                    </p>
                  </div>
                  <Badge tone={r.status === "new" ? "yellow" : r.status === "done" ? "green" : "grey"}>
                    {t(`admin.requests.status.${r.status}` as MessageKey)}
                  </Badge>
                </div>
                <p className={r.notes ? "whitespace-pre-line" : "text-muted"}>{r.notes ?? t("admin.requests.noNotes")}</p>
                {files.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {files.map((f, i) => (
                      <li key={f.path}>
                        <a href={urls.get(f.path) ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border-2 border-line px-3 font-bold text-brand">
                          {t(f.type === "application/pdf" ? "admin.requests.pdf" : "admin.requests.photo", { n: i + 1 })}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {r.contact_phone ? (
                  <p>
                    {r.contact_name ? `${r.contact_name} · ` : ""}
                    <a href={waLink(r.contact_phone, "")} target="_blank" rel="noopener noreferrer" className="font-bold text-brand underline">
                      {formatPhoneLocal(r.contact_phone)} · {t("admin.requests.chat")}
                    </a>
                  </p>
                ) : null}
                <RequestControls
                  requestId={r.id}
                  status={r.status as "new" | "in_progress" | "done" | "cancelled"}
                  canImport={Boolean(r.restaurants) && files.length > 0 && r.status !== "done" && r.status !== "cancelled"}
                  s={rs}
                />
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
