import type { ReactNode } from "react";

import type { User } from "../api";
import { useStrings } from "../i18n/LocaleProvider";
import { Brand } from "./Brand";
import { Link } from "./Link";
import { SkipLink } from "./SkipLink";
import { UserMenu } from "./UserMenu";

type Section = "home" | "admin";

/** Return the header section a path belongs to, or null when it belongs to none. */
function sectionOf(path: string): Section | null {
  if (path === "/") return "home";
  if (path === "/admin" || path.startsWith("/admin/")) return "admin";
  return null;
}

/** Header link to a section; on small screens it shows the short label, the full one staying its accessible name. */
function NavLink({ href, current, label, short }: { href: string; current: boolean; label: string; short: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className="flex h-full min-w-6 items-center border-y-2 border-transparent px-2 text-sm font-semibold whitespace-nowrap text-header-muted outline-none hover:text-header-foreground focus-visible:ring-2 focus-visible:ring-header-foreground focus-visible:ring-inset aria-[current=page]:border-b-header-active aria-[current=page]:text-header-foreground"
    >
      <span aria-hidden="true" className="sm:hidden">
        {short}
      </span>
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Link>
  );
}

/**
 * Frame of the signed-in screens: skip link, header with the instance title, the section links and the
 * user menu, main content. `path` is the current path; `nav` hides the section links when false.
 */
export function AppShell({
  user,
  path,
  nav = true,
  onSignOut,
  children,
}: {
  user: User;
  path: string;
  nav?: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const m = useStrings();
  const section = sectionOf(path);
  return (
    <div className="min-h-screen">
      <SkipLink />
      <header className="border-b border-header-border bg-header text-header-foreground">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:gap-6 sm:px-8">
          <Brand />
          {nav && (
            <nav aria-label={m.nav.label} className="h-full">
              <ul className="flex h-full gap-1 sm:gap-2">
                <li className="h-full">
                  <NavLink href="/" current={section === "home"} label={m.nav.home} short={m.nav.homeShort} />
                </li>
                {user.role === "admin" && (
                  <li className="h-full">
                    <NavLink href="/admin/users" current={section === "admin"} label={m.nav.admin} short={m.nav.adminShort} />
                  </li>
                )}
              </ul>
            </nav>
          )}
          <div className="ml-auto">
            <UserMenu user={user} onSignOut={onSignOut} />
          </div>
        </div>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto max-w-5xl p-4 outline-none sm:p-8">
        {children}
      </main>
    </div>
  );
}
