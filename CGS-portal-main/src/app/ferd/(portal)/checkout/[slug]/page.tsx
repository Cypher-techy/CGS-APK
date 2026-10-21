import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { CheckoutForm } from "@/modules/ferd/CheckoutForm";
import { displayPhone } from "@/modules/ferd/constants";
import { liveContent } from "@/modules/ferd/content";
import { mpesaConfig } from "@/modules/ferd/mpesa";
import { requireViewer } from "@/modules/ferd/session";

/** Checkout for one premium library: what is included, the terms, and the M-Pesa payment. */
export default async function FerdCheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) notFound();
  const { supabase, user, student, department, preview } = await requireViewer();
  const { data: product } = await supabase.from("ferd_products").select("id, slug, name, description, terms, price_kes, is_active, department_id").eq("slug", slug).maybeSingle();
  if (!product) notFound();

  const [{ data: owned }, { data: pending }, manuals] = await Promise.all([
    supabase.from("ferd_entitlements").select("id").eq("user_id", user.id).eq("product_id", product.id).is("revoked_at", null).maybeSingle(),
    supabase.from("ferd_payments").select("id, created_at").eq("user_id", user.id).eq("product_id", product.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    liveContent(supabase, department.id, { types: ["manual", "note", "document", "resource", "dataset", "report", "video", "link"], tier: "premium", limit: 100 }),
  ]);
  const included = manuals.filter((row) => row.product_id === product.id);
  const available = mpesaConfig().enabled;
  const wrongDepartment = !!product.department_id && product.department_id !== department.id;

  return (
    <>
      <PageHeader title={product.name} description={`One-time payment of KSh ${formatNumber(product.price_kes)}.`} crumbs={undefined} actions={<Link href="/ferd/manuals" className="btn btn-secondary">Back to manuals</Link>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="What you get">
          {product.description && <p className="prose-block">{product.description}</p>}
          <h3 className="section-title mt-5">Included right now ({included.length})</h3>
          {included.length === 0 ? (
            <p className="mt-1 text-sm text-muted-grey">No items have been published in this library yet. Check the list before you pay.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-charcoal">
              {included.map((row) => (
                <li key={row.id}>{row.title}</li>
              ))}
            </ul>
          )}
          {product.terms && (
            <>
              <h3 className="section-title mt-5">Terms</h3>
              <p className="prose-block mt-1 text-muted-grey">{product.terms}</p>
            </>
          )}
        </Card>

        <Card title="Pay with M-Pesa">
          {owned ? (
            <>
              <p className="alert alert-success">You already own this library.</p>
              <Link href="/ferd/manuals" className="btn btn-primary mt-4">Open your library</Link>
            </>
          ) : preview || !student ? (
            <p className="alert alert-info">Staff preview: purchases are made by verified students only.</p>
          ) : wrongDepartment ? (
            <p className="alert alert-warning">This library belongs to another department.</p>
          ) : !product.is_active ? (
            <p className="alert alert-warning">This library is not on sale at the moment.</p>
          ) : !available ? (
            <p className="alert alert-warning">M-Pesa payments are not available yet. The library will be purchasable as soon as payments are switched on.</p>
          ) : (
            <CheckoutForm product={product.slug} price={product.price_kes} defaultPhone={displayPhone(student.phone)} resumePaymentId={pending?.id} />
          )}
          <p className="mt-4 text-xs text-muted-grey">
            Access is granted when Safaricom confirms the payment, usually within a minute. You are never charged twice for the same library.
          </p>
        </Card>
      </div>
    </>
  );
}
