import type { ReactNode } from "react";

import type { User } from "../api";
import { useStrings } from "../i18n/LocaleProvider";
import { Brand } from "./Brand";
import { homeKey } from "../lib/home-store";
import { Link } from "./Link";
import { PreferenceSelects } from "./PreferenceSelects";
import { SearchBox } from "./search/SearchBox";
import { SkipLink } from "./SkipLink";
import { buttonVariants } from "./ui/button";
import { HEADER_BUTTON, UserMenu } from "./UserMenu";

/**
 * Frame of the app screens: skip link, header with the instance title, the section links, the link search and the
 * user menu, main content. `path` is the current path. `minimal` keeps the brand alone, without a user (the
 * loading screen). Without `user` (anonymous home), the header has no section links and a sign-in link instead of
 * the menu, and a footer holds the language and appearance choices.
 */
export function AppShell({
  user,
  path,
  minimal = false,
  onSignOut,
  children,
}: { path: string; onSignOut?: () => void; children: ReactNode } & ({ user: User | null; minimal?: false } | { user: null; minimal: true })) {
  const m = useStrings();
  return (
    <div className="min-h-screen">
      <SkipLink />
      <div className="z-40 px-2 pt-2 sm:sticky sm:top-0 sm:px-4 sm:pt-3">
      <header className="mx-auto max-w-5xl rounded-[14px] bg-header/95 text-header-foreground shadow-[0_0_0_1.5px_var(--header-border),0_6px_0_rgb(0_0_0/0.45)] backdrop-blur">
        {/* A grid, so the search field can sit in the 56 px row from sm up and on its own row below it on small
            screens while staying one element, after the toggle and before the account menu in focus order. */}
        <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto_auto] grid-rows-[3.5rem_auto] items-center gap-x-2 px-2 sm:grid-rows-[3.75rem] sm:gap-x-5 sm:px-3">
          <Brand className="col-start-1 row-start-1" />
          {!minimal && (
            <SearchBox
              key={homeKey(user)}
              homeKey={homeKey(user)}
              toggleClassName="col-start-3 row-start-1"
              className="col-span-full row-start-2 pb-3 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:w-full sm:max-w-sm sm:justify-self-end sm:pb-0"
            />
          )}
          <div className="col-start-4 row-start-1">
            {user ? (
              <UserMenu user={user} path={path} onSignOut={onSignOut ?? (() => {})} />
            ) : minimal ? null : (
              <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm", className: HEADER_BUTTON })}>
                {m.signIn.title}
              </Link>
            )}
          </div>
        </div>
      </header>
      </div>
      <main id="content" tabIndex={-1} className="mx-auto max-w-5xl p-4 pt-8 outline-none sm:p-8 sm:pt-12">
        {children}
      </main>
      {!user && !minimal && (
        <footer>
          <div aria-hidden="true" className="pixel-band" />
          <div className="mx-auto max-w-5xl p-4 sm:px-8">
            <PreferenceSelects />
          </div>
        </footer>
      )}
    </div>
  );
}
