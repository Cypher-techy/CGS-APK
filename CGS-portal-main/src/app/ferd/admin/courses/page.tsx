import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { saveCourse, setCourseActive } from "@/modules/ferd/admin-actions";
import { requireStaff } from "@/modules/ferd/session";

/** Units (courses) per department. Content can be attached to a unit. */
export default async function FerdAdminCoursesPage() {
  const { supabase, departments, role, staffDepartmentId } = await requireStaff(["department_admin"]);
  const { data: courses } = await supabase.from("ferd_courses").select("id, department_id, code, title, year_of_study, semester, is_active").order("department_id").order("year_of_study").order("code");
  const mine = role === "super_admin" ? departments : departments.filter((d) => d.id === staffDepartmentId);

  return (
    <div className="space-y-5">
      <PageHeader title="Units" description="The units each department offers. Notes, guides and manuals can be filed under a unit." />
      <Card title="Add a unit">
        <ActionForm action={saveCourse} submitLabel="Add unit" className="grid gap-4 sm:grid-cols-3">
          <Field label="Department">
            <select name="department_id" className="input" required defaultValue={mine[0]?.id ?? ""}>
              {mine.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Unit code">
            <input name="code" className="input uppercase" required minLength={2} maxLength={20} />
          </Field>
          <Field label="Title">
            <input name="title" className="input" required minLength={3} maxLength={160} />
          </Field>
          <Field label="Year of study (optional)">
            <input name="year_of_study" type="number" min={1} max={8} className="input" />
          </Field>
          <Field label="Semester (optional)">
            <input name="semester" type="number" min={1} max={3} className="input" />
          </Field>
          <Field label="Description (optional)">
            <input name="description" className="input" maxLength={1000} />
          </Field>
        </ActionForm>
      </Card>
      {departments.map((d) => {
        const list = (courses ?? []).filter((c) => c.department_id === d.id);
        return (
          <Card key={d.id} title={d.name} pad={false}>
            {list.length === 0 ? (
              <EmptyState title="No units listed" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Title</th>
                      <th>Year</th>
                      <th>Semester</th>
                      <th>Shown to students</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id}>
                        <td>{c.code}</td>
                        <td>{c.title}</td>
                        <td>{c.year_of_study ?? "—"}</td>
                        <td>{c.semester ?? "—"}</td>
                        <td>
                          <ActionForm action={setCourseActive} submitLabel={c.is_active ? "Yes · hide" : "No · show"} submitClass="btn btn-secondary btn-sm">
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="active" value={c.is_active ? "false" : "true"} />
                          </ActionForm>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
