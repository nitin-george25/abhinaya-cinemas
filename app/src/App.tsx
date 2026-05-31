import { Route, Routes, Link } from "react-router-dom";

// Phase C0 placeholder. The real shell + routing arrives in Phase C2.
// This page exists so we can ship a deploy and confirm the Cloudflare
// Pages build pipeline works end-to-end.
export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-line bg-paper-card">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-block w-7 h-7 rounded-md bg-ink" />
          <span className="font-semibold tracking-tight">Abhinaya Cinemas</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-ink-soft font-medium">
            v2 · preview
          </span>
        </Link>
        <nav className="text-sm text-ink-muted">
          <a
            href="/admin/dcr/"
            className="hover:text-ink underline-offset-4 hover:underline"
          >
            Back to legacy console
          </a>
        </nav>
      </div>
    </header>
  );
}

function Home() {
  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-ink-muted uppercase tracking-wider font-medium">
          Phase C0 · scaffold
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">
          The new console is wired up.
        </h1>
        <p className="text-ink-muted mt-3 max-w-xl">
          This is the placeholder shell for the React rewrite. The real app shell,
          dashboard, entry form, F&amp;B view and DCR PDF generation arrive in
          phases C2 through C6. Until cutover (Phase C7), all live operations
          continue to run on the legacy console at{" "}
          <code className="text-ink">/admin/dcr/</code>.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card title="What this proves" lines={[
          "Vite + React + Tailwind compile.",
          "Cloudflare Pages build script runs.",
          "/v2/ route serves alongside legacy /admin/dcr/.",
          "TypeScript strict mode passes.",
        ]} />
        <Card title="What's next" lines={[
          "C1 — port locked DCR engine math to TypeScript.",
          "C2 — app shell, Google auth, React Router.",
          "C3 — dashboard pane (KPIs + charts).",
          "C4 — DCR entry form.",
        ]} />
      </div>
    </section>
  );
}

function Card({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-line bg-paper-card shadow-card p-5">
      <h2 className="font-semibold tracking-tight">{title}</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-muted">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-amber-400">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotFound() {
  return (
    <div className="text-center py-20">
      <p className="text-ink-muted">No such page in /v2/ yet.</p>
      <Link to="/" className="text-amber-600 underline mt-2 inline-block">
        Back to home
      </Link>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line text-xs text-ink-muted">
      <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between">
        <span>Abhinaya Cinemas · v2 preview</span>
        <span>Built {new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}
