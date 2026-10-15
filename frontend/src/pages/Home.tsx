import type { User } from "../api";
import { Logo } from "../components/Logo";
import { strings } from "../strings";

const s = strings.home;

export function Home({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="flex items-center justify-between bg-zinc-900 px-4 py-3 text-zinc-50">
        <span className="flex items-center gap-2 font-bold">
          <Logo className="h-6 w-6" />
          {strings.appName}
        </span>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-md px-3 py-1 text-sm underline outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {s.signOut}
        </button>
      </header>
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-bold">{s.title}</h1>
        <p className="mt-2 text-zinc-700">{s.signedInAs(user.name)}</p>
        <p className="mt-6 text-sm text-zinc-600">{s.placeholder}</p>
      </main>
    </div>
  );
}
