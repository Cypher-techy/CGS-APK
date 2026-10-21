import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Lock } from "lucide-react";
import { Card, DetailList, PageHeader } from "@/components/ui";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { CONTENT_TYPES } from "@/modules/ferd/constants";
import { CONTENT_COLUMNS, TierBadge } from "@/modules/ferd/content";
import { requireViewer } from "@/modules/ferd/session";

const uuidPattern = /^[0-9a-f-]{36}$/i;

/** One content item. The text is shown to everyone who may see the item; its files only after the access check. */
export default async function FerdContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const { supabase, department } = await requireViewer();
  const { data: row } = await supabase.from("ferd_content").select(`${CONTENT_COLUMNS}, body`).eq("id", id).maybeSingle();
  if (!row) notFound();

  // The database makes the access decision (department, publication, premium entitlement).
  const [{ data: allowed }, { data: files }, { data: product }, { data: course }] = await Promise.all([
    supabase.rpc("ferd_can_access_content", { p_content: id }),
    supabase.from("ferd_files").select("id, kind, file_name, mime_type, size_bytes, caption, storage_path").eq("content_id", id).order("sort_order").order("created_at"),
    row.product_id ? supabase.from("ferd_products").select("slug, name, price_kes, is_active").eq("id", row.product_id).maybeSingle() : Promise.resolve({ data: null }),
    row.course_id ? supabase.from("ferd_courses").select("code, title").eq("id", row.course_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const access = allowed === true;
  const attachments = (files ?? []).filter((f) => f.kind === "attachment");
  const images = (files ?? []).filter((f) => f.kind !== "attachment");

  // Images are shown through links that expire after ten minutes, and only when access was granted.
  let imageUrls = new Map<string, string>();
  if (access && images.length > 0 && adminConfigured()) {
    const { data: signed } = await createAdminClient().storage.from("ferd-files").createSignedUrls(images.map((f) => f.storage_path), 600);
    imageUrls = new Map((signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl as string]));
  }
  const meta = (row.meta ?? {}) as Record<string, string>;
  const group = CONTENT_TYPES[row.type]?.group;

  return (
    <>
      <PageHeader
        title={row.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{CONTENT_TYPES[row.type]?.label ?? row.type}</span>
            <TierBadge row={row} unlocked={access} />
            <span>{department.name}</span>
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            {row.summary && <p className="text-base text-charcoal">{row.summary}</p>}
            {access ? (
              <>
                {row.body && <p className="prose-block mt-4">{row.body}</p>}
                {row.external_url && (
                  <p className="mt-5">
                    <a href={row.external_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary">
                      {group === "opportunity" ? "Official application page" : "Open link"} <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </p>
                )}
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
                <p className="flex items-center gap-2 font-semibold">
                  <Lock className="h-4 w-4" aria-hidden="true" /> This is a premium item
                </p>
                {product ? (
                  <>
                    <p className="mt-1">It is part of “{product.name}”. One payment unlocks every item in that library.</p>
                    {product.is_active ? (
                      <Link href={`/ferd/checkout/${product.slug}`} className="btn btn-accent mt-3">Unlock for KSh {formatNumber(product.price_kes)}</Link>
                    ) : (
                      <p className="mt-2">The library is not on sale at the moment.</p>
                    )}
                  </>
                ) : (
                  <p className="mt-1">It is not available to your account.</p>
                )}
              </div>
            )}
          </Card>

          {images.length > 0 && access && (
            <Card title="Photos">
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((image) => {
                  const url = imageUrls.get(image.storage_path);
                  return (
                    <li key={image.id}>
                      {url ? (
                        // Signed, short-lived URLs cannot go through the image optimiser's cache.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={image.caption ?? image.file_name} loading="lazy" className="aspect-[4/3] w-full rounded-2xl object-cover" />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-white/5 text-xs text-muted-grey">Image unavailable</div>
                      )}
                      {image.caption && <p className="mt-1 text-xs text-muted-grey">{image.caption}</p>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {attachments.length > 0 && (
            <Card title="Files" pad={false}>
              <ul className="divide-y divide-subtle-border">
                {attachments.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate text-white">{file.caption ?? file.file_name}</span>
                      <span className="block text-xs text-muted-grey">{file.file_name} · {formatBytes(file.size_bytes)}</span>
                    </span>
                    {access ? (
                      <a href={`/api/ferd/files/${file.id}`} className="btn btn-secondary btn-sm">
                        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Open
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-200">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Locked
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card title="Details">
          <DetailList
            items={[
              ["Published", formatDate(row.publish_at ?? row.created_at)],
              ...(course ? ([["Unit", `${course.code} · ${course.title}`]] as [string, string][]) : []),
              ...(meta.organization ? ([["Organization", meta.organization]] as [string, string][]) : []),
              ...(meta.eligibility ? ([["Eligibility", meta.eligibility]] as [string, string][]) : []),
              ...(meta.location ? ([["Location", `${meta.location}${meta.mode ? ` · ${meta.mode}` : ""}`]] as [string, string][]) : []),
              ...(meta.starts_at ? ([["Starts", formatDate(meta.starts_at)]] as [string, string][]) : []),
              ...(meta.ends_at ? ([["Ends", formatDate(meta.ends_at)]] as [string, string][]) : []),
              ...(group === "opportunity" ? ([["Deadline", row.expires_at ? formatDate(row.expires_at) : "Not stated"]] as [string, string][]) : []),
              ...(meta.last_verified ? ([["Last checked", formatDate(meta.last_verified)]] as [string, string][]) : []),
              ...(row.source ? ([["Source", row.source]] as [string, string][]) : []),
            ]}
          />
          {(row.tags ?? []).length > 0 && (
            <p className="mt-4 flex flex-wrap gap-1.5">
              {(row.tags as string[]).map((tag) => (
                <span key={tag} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-charcoal">{tag}</span>
              ))}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
