import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card card-pad mx-auto mt-10 max-w-lg text-center">
      <h1 className="text-base font-semibold text-heading">Record not found</h1>
      <p className="mt-2 text-sm text-muted-grey">
        The record does not exist, or your account is not authorised to view it.
      </p>
      <Link href="/dashboard" className="btn btn-primary mt-4">
        Back to dashboard
      </Link>
    </div>
  );
}
