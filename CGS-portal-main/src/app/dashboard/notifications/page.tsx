import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { markAllNotificationsRead, markNotificationRead } from "@/modules/notifications/actions";

export default async function NotificationsPage() {
  const { supabase } = await requireSession();
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${unread} unread. Notifications are created for project decisions, task assignments, deadlines, document reviews and field reports that concern you.`}
        actions={unread > 0 && <ActionForm action={markAllNotificationsRead} submitLabel="Mark all as read" submitClass="btn btn-secondary" />}
      />
      <Card pad={false}>
        {notifications.length === 0 ? (
          <EmptyState title="You have no notifications." />
        ) : (
          <ul className="divide-y divide-subtle-border">
            {notifications.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5 ${n.read_at ? "" : "bg-amber-400/10"}`}>
                <div className="min-w-0">
                  <p className={`text-sm ${n.read_at ? "text-charcoal" : "font-semibold text-heading"}`}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-muted-grey">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted-grey">{formatDateTime(n.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {n.link?.startsWith("/dashboard") && <Link href={n.link} className="btn btn-secondary btn-sm">Open</Link>}
                  {!n.read_at && (
                    <ActionForm action={markNotificationRead} submitLabel="Mark read" submitClass="btn btn-secondary btn-sm">
                      <input type="hidden" name="notification_id" value={n.id} />
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted-grey">
        Notifications are also e-mailed to your registered address when CGS has e-mail delivery switched on. You can opt out under Profile.
      </p>
    </>
  );
}
