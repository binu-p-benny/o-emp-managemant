import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function ForbiddenPage() {
  return (
    <div className="card mx-auto mt-10 max-w-lg">
      <EmptyState icon="shield" title="You don't have access to this page">
        Your role doesn&apos;t include this module. Ask the Managing Director to update your role&apos;s permissions if you need it.
        <div className="mt-4">
          <Link href="/" className="btn btn-dark">
            Back to dashboard
          </Link>
        </div>
      </EmptyState>
    </div>
  );
}
