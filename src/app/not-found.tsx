import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-6xl font-black text-brand-500">404</p>
        <h1 className="mt-2 text-xl font-bold">Page not found</h1>
        <p className="mt-1 text-sm text-stone-500">It may have been removed, or you may not have access to it.</p>
        <Link href="/" className="btn btn-dark mt-6">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
