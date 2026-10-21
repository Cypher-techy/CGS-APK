import type { Supabase } from "@/lib/supabase/server";

/**
 * Exact row counts per value of a column, one indexed count query per value.
 * Counts are always computed by the database under the caller's RLS scope.
 */
export async function countBy(supabase: Supabase, table: string, column: string, values: string[]) {
  const results = await Promise.all(
    values.map((value) => supabase.from(table).select("id", { count: "exact", head: true }).eq(column, value)),
  );
  const counts: Record<string, number> = {};
  values.forEach((value, i) => (counts[value] = results[i].count ?? 0));
  return counts;
}

export const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

export async function countOverdueTasks(supabase: Supabase, today: string, assignee?: string) {
  let query = supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "completed").lt("due_date", today);
  if (assignee) query = query.eq("assigned_to", assignee);
  return (await query).count ?? 0;
}
