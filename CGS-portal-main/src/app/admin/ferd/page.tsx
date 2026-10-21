import { redirect } from "next/navigation";

/** Short address for FERD administration. Access is checked by the page it leads to. */
export default function AdminFerdRedirect() {
  redirect("/ferd/admin");
}
