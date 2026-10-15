import type { ReactNode } from "react";

import type { User } from "../api";
import { useStrings } from "../i18n/LocaleProvider";
import { useInstance } from "../instance";
import { InstanceLogo } from "./InstanceLogo";
import { UserMenu } from "./UserMenu";

/** Frame of the signed-in screens: skip link, header with the instance title and the user menu, main content. */
export function AppShell({ user, onSignOut, children }: { user: User; onSignOut: () => void; children: ReactNode }) {
  const m = useStrings();
  const { title } = useInstance();
  return (
    <div className="min-h-screen">
      <a
        href="#content"
        className="sr-only rounded-md bg-background px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:ring-2 focus:ring-ring"
      >
        {m.skipToContent}
      </a>
      <header className="flex items-center justify-between gap-4 bg-header px-4 py-2 text-header-foreground">
        <span className="flex min-w-0 items-center gap-2 font-bold">
          <InstanceLogo className="size-6 shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        <UserMenu user={user} onSignOut={onSignOut} />
      </header>
      <main id="content" tabIndex={-1} className="mx-auto max-w-5xl p-4 outline-none sm:p-8">
        {children}
      </main>
    </div>
  );
}
