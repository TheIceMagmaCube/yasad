import type { ReactNode } from "react";

import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { InstanceLogo } from "./InstanceLogo";
import { PreferenceSelects } from "./PreferenceSelects";

/** Split screen for the signed-out pages: brand panel on the left, a top bar on small screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const m = useStrings();
  const { title } = useInstance();
  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center gap-3 bg-header px-4 py-3 text-header-foreground md:w-2/5 md:flex-col md:items-start md:justify-between md:p-10">
        <div className="flex min-w-0 items-center gap-3 md:flex-col md:items-start">
          <InstanceLogo className="size-6 shrink-0 md:size-14" />
          <span className="truncate text-lg font-bold md:text-3xl">{title}</span>
        </div>
        <p className="hidden max-w-xs text-sm text-header-muted md:block">{m.tagline}</p>
      </header>
      <div className="flex flex-1 flex-col">
        <main id="content" className="flex flex-1 items-center justify-center p-4 md:p-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        <footer className="border-t p-4 md:px-10">
          <PreferenceSelects />
        </footer>
      </div>
    </div>
  );
}
