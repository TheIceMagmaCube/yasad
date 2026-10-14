import { useEffect, useState } from "react";

type Health = { ok: boolean; version: string; database: boolean };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">YASAD</h1>
      <p className="mt-2 text-slate-600">Yet Another Simple Accessible Dashboard.</p>
      <p className="mt-6 text-sm" role="status">
        {health ? `API ${health.version}: ${health.ok ? "up" : "database unreachable"}` : "Checking the API…"}
      </p>
    </main>
  );
}
