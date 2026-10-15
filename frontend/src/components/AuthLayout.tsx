import type { ReactNode } from "react";

import { strings } from "../strings";
import { Logo } from "./Logo";

/** Split screen for the auth pages: brand panel on the left, a top bar on small screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-zinc-900 md:flex">
      <header className="flex items-center gap-3 bg-zinc-900 px-4 py-3 text-zinc-50 md:w-2/5 md:flex-col md:items-start md:justify-between md:p-10">
        <div className="flex items-center gap-3 md:flex-col md:items-start">
          <Logo className="h-6 w-6 md:h-14 md:w-14" />
          <span className="text-lg font-bold md:text-3xl">{strings.appName}</span>
        </div>
        <p className="hidden max-w-xs text-sm text-zinc-300 md:block">{strings.tagline}</p>
      </header>
      <main className="flex flex-1 items-center justify-center p-4 md:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
