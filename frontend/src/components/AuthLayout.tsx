import type { ReactNode } from "react";

import { useStrings } from "../i18n/LocaleProvider";
import { Brand } from "./Brand";
import { PreferenceSelects } from "./PreferenceSelects";
import { SkipLink } from "./SkipLink";

/** Split screen for the signed-out pages: skip link, brand panel on the left, a top bar on small screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const m = useStrings();
  return (
    <div className="min-h-screen md:flex">
      <SkipLink />
      <header className="flex items-center gap-3 bg-header px-4 py-3 text-header-foreground md:w-2/5 md:flex-col md:items-start md:justify-between md:p-10">
        <Brand size="panel" />
        <p className="hidden max-w-xs text-sm text-header-muted md:block">{m.tagline}</p>
      </header>
      <div className="flex flex-1 flex-col">
        <main id="content" tabIndex={-1} className="flex flex-1 items-center justify-center p-4 outline-none md:p-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        <footer className="border-t p-4 md:px-10">
          <PreferenceSelects />
        </footer>
      </div>
    </div>
  );
}
