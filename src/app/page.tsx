import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl py-16 text-center">
      <p className="mb-3 text-sm font-bold uppercase tracking-[.22em] text-blue-700">Local-first exam practice</p>
      <h1 className="text-5xl font-black tracking-tight">CertForge</h1>
      <p className="muted mx-auto mt-5 max-w-xl text-lg leading-8">Import reusable question banks, practice with instant feedback, or run a timed exam. Your data stays in a local SQLite database.</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link className="card p-7 text-left transition hover:-translate-y-0.5 hover:border-blue-300" href="/import">
          <span className="text-xl font-extrabold">Import Question Banks</span>
          <span className="muted mt-2 block">Add or update validated JSON question banks.</span>
        </Link>
        <Link className="card p-7 text-left transition hover:-translate-y-0.5 hover:border-blue-300" href="/simulations">
          <span className="text-xl font-extrabold">Simulations</span>
          <span className="muted mt-2 block">Start, continue, and review your sessions.</span>
        </Link>
      </div>
    </div>
  );
}
