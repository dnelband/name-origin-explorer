import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold text-accent">Name not found</h1>
      <p className="text-muted">That name is not in the database.</p>
      <Link href="/" className="text-accent underline-offset-2 hover:underline">
        Back to search
      </Link>
    </main>
  );
}
