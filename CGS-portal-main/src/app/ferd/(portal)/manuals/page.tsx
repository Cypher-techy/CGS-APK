import Link from "next/link";
import { Lock, Unlock } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { bookmarkedIds, ContentGrid, entitledProducts, liveContent } from "@/modules/ferd/content";
import { requireModule } from "@/modules/ferd/portal";

/** Manuals and study packs, grouped under the premium library that unlocks them. */
export default async function FerdManualsPage() {
  const { supabase, user, student, role, department, moduleLabel } = await requireModule("manuals");
  const [rows, entitled, bookmarks, { data: products }] = await Promise.all([
    liveContent(supabase, department.id, { types: ["manual"] }),
    entitledProducts(supabase, user.id),
    bookmarkedIds(supabase, user.id),
    supabase.from("ferd_products").select("id, slug, name, description, terms, price_kes, is_active").eq("department_id", department.id).order("name"),
  ]);
  const staff = !!role;
  const visible = (products ?? []).filter((p) => p.is_active || entitled.has(p.id) || staff);

  return (
    <>
      <PageHeader title={moduleLabel} description={`Manuals and study packs for ${department.name}. One payment unlocks every item in a library.`} />
      <div className="space-y-8">
        {visible.map((product) => {
          const owned = entitled.has(product.id) || staff;
          const items = rows.filter((row) => row.product_id === product.id);
          return (
            <section key={product.id}>
              <div className="card mb-4 flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0 max-w-2xl">
                  <h2 className="flex items-center gap-2 text-xl font-bold text-white">
                    {owned ? <Unlock className="h-5 w-5 text-[var(--ferd-accent)]" aria-hidden="true" /> : <Lock className="h-5 w-5 text-amber-200" aria-hidden="true" />}
                    {product.name}
                  </h2>
                  {product.description && <p className="mt-1.5 text-sm text-muted-grey">{product.description}</p>}
                  <p className="mt-2 text-xs text-muted-grey">
                    {items.length} item{items.length === 1 ? "" : "s"} currently in this library.{!product.is_active && " Not on sale at the moment."}
                  </p>
                </div>
                {owned ? (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">{staff && !entitled.has(product.id) ? "Staff access" : "Unlocked"}</span>
                ) : (
                  <Link href={`/ferd/checkout/${product.slug}`} className="btn btn-accent">Unlock for KSh {formatNumber(product.price_kes)}</Link>
                )}
              </div>
              <ContentGrid rows={items} entitled={entitled} bookmarks={bookmarks} canBookmark={!!student} staff={staff} empty="No manuals have been added to this library yet" emptyHint="Items appear here as soon as they are published." />
            </section>
          );
        })}
        {(() => {
          const free = rows.filter((row) => row.tier === "free");
          if (free.length === 0 && visible.length > 0) return null;
          return (
            <section>
              {visible.length > 0 && <h2 className="mb-4 text-xl font-bold text-white">Free manuals</h2>}
              <ContentGrid rows={free} entitled={entitled} bookmarks={bookmarks} canBookmark={!!student} staff={staff} empty="No manuals available" emptyHint="Manuals appear here when your department publishes them." />
            </section>
          );
        })()}
      </div>
    </>
  );
}
