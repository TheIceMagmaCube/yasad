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

type Section = "home" | "admin";

/** Return the header section a path belongs to, or null when it belongs to none. */
function sectionOf(path: string): Section | null {
  if (path === "/") return "home";
  if (path === "/admin" || path.startsWith("/admin/")) return "admin";
  return null;
}

/**
 * Header link to a section. With `short`, small screens show it instead of the label, which stays the
 * accessible name: `short` must be a whole word of `label` (WCAG 2.5.3, speech input matches words).
 */
function NavLink({ href, current, label, short }: { href: string; current: boolean; label: string; short?: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className="flex h-full min-w-6 items-center border-y-2 border-transparent px-2 text-sm font-semibold whitespace-nowrap text-header-muted outline-none hover:text-header-foreground focus-visible:ring-2 focus-visible:ring-header-foreground focus-visible:ring-inset aria-[current=page]:border-b-header-active aria-[current=page]:text-header-foreground"
    >
      {short ? (
        <>
          <span aria-hidden="true" className="sm:hidden">
            {short}
          </span>
          <span className="sr-only sm:not-sr-only">{label}</span>
        </>
      ) : (
        label
      )}
    </Link>
  );
}

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
  const section = sectionOf(path);
  return (
    <div className="min-h-screen">
      <SkipLink />
      <header className="border-b border-header-border bg-header text-header-foreground">
        {/* A grid, so the search field can sit in the 56 px row from sm up and on its own row below it on small
            screens while staying one element, after the toggle and before the account menu in focus order. */}
        <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)_auto_auto] grid-rows-[3.5rem_auto] items-center gap-x-2 px-4 sm:grid-rows-[3.5rem] sm:gap-x-6 sm:px-8">
          <Brand className="col-start-1 row-start-1" />
          {user && (
            <nav aria-label={m.nav.label} className="col-start-2 row-start-1 h-full">
              <ul className="flex h-full gap-1 sm:gap-2">
                <li className="h-full">
                  <NavLink href="/" current={section === "home"} label={m.nav.home} short={m.nav.homeShort} />
                </li>
                {user.role === "admin" && (
                  <li className="h-full">
                    <NavLink href="/admin/users" current={section === "admin"} label={m.nav.admin} />
                  </li>
                )}
              </ul>
            </nav>
          )}
          {!minimal && (
            <SearchBox
              key={homeKey(user)}
              homeKey={homeKey(user)}
              toggleClassName="col-start-4 row-start-1"
              className="col-span-full row-start-2 pb-3 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:w-full sm:max-w-sm sm:justify-self-end sm:pb-0"
            />
          )}
          <div className="col-start-5 row-start-1">
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
      <main id="content" tabIndex={-1} className="mx-auto max-w-5xl p-4 outline-none sm:p-8">
        {children}
      </main>
      {!user && !minimal && (
        <footer className="border-t">
          <div className="mx-auto max-w-5xl p-4 sm:px-8">
            <PreferenceSelects />
          </div>
        </footer>
      )}
    </div>
  );
}
