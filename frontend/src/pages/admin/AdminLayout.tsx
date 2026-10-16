import type { ReactNode } from "react";

import { Link } from "../../components/Link";
import { useStrings } from "../../i18n/LocaleProvider";
import { useDocumentTitle } from "../../lib/page";

export const ADMIN_TABS = ["users", "groups", "catalog"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** Return the tab an /admin path shows, or null for a path outside the section. */
export function adminTab(path: string): AdminTab | null {
  if (path === "/admin" || path === "/admin/") return "users";
  return ADMIN_TABS.find((tab) => path === `/admin/${tab}`) ?? null;
}

/**
 * Frame of the administration pages: title and one link per page, the current one marked.
 * The heading, focused after each tab switch, also names the tab to screen readers.
 */
export function AdminLayout({ tab, children }: { tab: AdminTab; children: ReactNode }) {
  const m = useStrings();
  useDocumentTitle(m.admin.tabs[tab], m.admin.title);
  return (
    <div>
      <h1 tabIndex={-1} className="text-2xl font-bold outline-none">
        {m.admin.title}
        <span className="sr-only">, {m.admin.tabs[tab]}</span>
      </h1>
      <nav aria-label={m.admin.title} className="mt-4 border-b border-border">
        <ul className="flex flex-wrap gap-1">
          {ADMIN_TABS.map((t) => (
            <li key={t}>
              <Link
                href={`/admin/${t}`}
                aria-current={t === tab ? "page" : undefined}
                className="-mb-px inline-block rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:text-foreground"
              >
                {m.admin.tabs[t]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
