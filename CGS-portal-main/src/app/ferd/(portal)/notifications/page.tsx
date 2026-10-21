import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireModule } from "@/modules/ferd/portal";
import { markNotificationsRead } from "@/modules/ferd/student-actions";

export default async function FerdNotificationsPage() {
  const { supabase, user, moduleLabel } = await requireModule("notifications");
  const { data } = await supabase.from("ferd_notifications").select("id, title, body, link, read_at, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader
        title={moduleLabel}
        description="Updates about your account, payments and verification."
        actions={
          unread > 0 && (
            <form action={markNotificationsRead}>
              <button type="submit" className="btn btn-secondary">Mark all as read</button>
            </form>
          )
        }
      />
      <Card pad={false}>
        {items.length === 0 ? (
          <EmptyState title="No notifications" />
        ) : (
          <ul className="divide-y divide-subtle-border">
            {items.map((n) => (
              <li key={n.id} className={`px-4 py-3 sm:px-5 ${n.read_at ? "" : "bg-white/5"}`}>
                <p className="text-sm font-medium text-white">
                  {!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-clay" aria-label="Unread" />}
                  {n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}
                </p>
                {n.body && <p className="mt-0.5 text-sm text-muted-grey">{n.body}</p>}
                <p className="mt-0.5 text-xs text-muted-grey">{formatDateTime(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
