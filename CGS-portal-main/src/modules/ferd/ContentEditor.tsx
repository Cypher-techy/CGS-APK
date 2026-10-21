import type { ReactNode } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { saveContent } from "@/modules/ferd/admin-actions";
import { CONTENT_TYPES } from "@/modules/ferd/constants";
import type { ContentRow } from "@/modules/ferd/content";
import { FileFields, NewContentForm } from "@/modules/ferd/FileUploader";
import type { Department } from "@/modules/ferd/session";

/** Timestamp → value for <input type="datetime-local">, in Nairobi time. */
const localValue = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 16) : "");

/** A new item is created together with its files; an existing one is saved through the ordinary form. */
function EditorForm({ isNew, children }: { isNew: boolean; children: ReactNode }) {
  if (isNew) return <NewContentForm>{children}</NewContentForm>;
  return (
    <ActionForm action={saveContent} submitLabel="Save changes" className="space-y-6" resetOnSuccess={false}>
      {children}
    </ActionForm>
  );
}

/** Create / edit form shared by every content type. Fields that do not apply to a type are simply left empty. */
export function ContentEditor({
  row,
  departments,
  courses,
  products,
  canSetPremium,
}: {
  row?: ContentRow;
  departments: Department[];
  courses: { id: string; code: string; title: string; department_id: string }[];
  products: { id: string; name: string; price_kes: number }[];
  /** Only the Super Admin and department admins decide what is premium. */
  canSetPremium: boolean;
}) {
  const meta = (row?.meta ?? {}) as Record<string, string>;
  const selected = new Set<string>(row?.departments ?? []);
  return (
    <EditorForm isNew={!row}>
      {row && <input type="hidden" name="id" value={row.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Content type">
          <select name="type" className="input" required defaultValue={row?.type ?? "note"}>
            {Object.entries(CONTENT_TYPES).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Title">
            <input name="title" className="input" required minLength={3} maxLength={200} defaultValue={row?.title} />
          </Field>
        </div>
      </div>
      <Field label="Summary" hint="One or two sentences shown on cards and lists.">
        <textarea name="summary" className="input" rows={2} maxLength={500} defaultValue={row?.summary ?? ""} />
      </Field>
      <Field label="Content" hint="The full text: the note itself, the announcement, the description of the opportunity or event.">
        <textarea name="body" className="input" rows={10} maxLength={30000} defaultValue={row?.body ?? ""} />
      </Field>

      {!row && (
        <fieldset className="space-y-3">
          <legend className="section-title">Files and photos (optional)</legend>
          <p className="text-sm text-muted-grey">Attach the PDF, document, dataset or photos now. They are uploaded when you press Create, and you can add more afterwards.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <FileFields />
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className="section-title">Departments</legend>
        <p className="hint">Leave every box empty to show the item to all departments.</p>
        <div className="mt-2 flex flex-wrap gap-4">
          {departments.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="departments" value={d.id} defaultChecked={selected.has(d.id)} /> {d.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Unit (optional)">
          <select name="course_id" className="input" defaultValue={row?.course_id ?? ""}>
            <option value="">No unit</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {departments.find((d) => d.id === c.department_id)?.code} · {c.code} {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Access" hint={canSetPremium ? undefined : "Your role cannot change premium status."}>
          <select name="tier" className="input" defaultValue={row?.tier ?? "free"}>
            <option value="free">Free</option>
            {(canSetPremium || row?.tier === "premium") && <option value="premium">Premium</option>}
          </select>
        </Field>
        <Field label="Premium library" hint="Required for premium items: the library whose payment unlocks this item.">
          <select name="product_id" className="input" defaultValue={row?.product_id ?? ""}>
            <option value="">None</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (KSh {p.price_kes})</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Status">
          <select name="status" className="input" defaultValue={row?.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Publish at" hint="A future time schedules the item. Empty: as soon as it is published.">
          <input name="publish_at" type="datetime-local" className="input" defaultValue={localValue(row?.publish_at)} />
        </Field>
        <Field label="Expires at / deadline" hint="The item disappears from the portal after this time.">
          <input name="expires_at" type="datetime-local" className="input" defaultValue={localValue(row?.expires_at)} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Author or source">
          <input name="source" className="input" maxLength={200} defaultValue={row?.source ?? ""} />
        </Field>
        <Field label="Link" hint="Video, external resource, or the official application page.">
          <input name="external_url" type="url" className="input" maxLength={500} placeholder="https://" defaultValue={row?.external_url ?? ""} />
        </Field>
        <Field label="Tags" hint="Comma separated. A tag equal to a department focus area appears under that focus area.">
          <input name="tags" className="input" maxLength={500} defaultValue={(row?.tags ?? []).join(", ")} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="section-title">Opportunity and event details (optional)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Organization">
            <input name="organization" className="input" maxLength={160} defaultValue={meta.organization ?? ""} />
          </Field>
          <Field label="Location">
            <input name="location" className="input" maxLength={160} defaultValue={meta.location ?? ""} />
          </Field>
          <Field label="Delivery mode" hint="On site, remote, hybrid">
            <input name="mode" className="input" maxLength={40} defaultValue={meta.mode ?? ""} />
          </Field>
          <Field label="Starts">
            <input name="starts_at" type="date" className="input" defaultValue={meta.starts_at ?? ""} />
          </Field>
          <Field label="Ends">
            <input name="ends_at" type="date" className="input" defaultValue={meta.ends_at ?? ""} />
          </Field>
          <Field label="Last verified" hint="When someone last checked the listing against its source">
            <input name="last_verified" type="date" className="input" defaultValue={meta.last_verified ?? ""} />
          </Field>
        </div>
        <Field label="Eligibility">
          <input name="eligibility" className="input" maxLength={500} defaultValue={meta.eligibility ?? ""} />
        </Field>
      </fieldset>
    </EditorForm>
  );
}
