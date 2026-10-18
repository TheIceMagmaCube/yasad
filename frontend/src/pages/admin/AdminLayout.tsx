import type { ReactNode } from "react";

import { Link } from "../../components/Link";
import { PageHeader } from "../../components/PageHeader";
import { useStrings } from "../../i18n/LocaleProvider";
import { useDocumentTitle } from "../../lib/page";

export const ADMIN_TABS = ["users", "groups", "catalog"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** Return the tab an /admin path shows, or null for a path outside the section. */
export function adminTab(path: string): AdminTab | null {
  if (path === "/admin" || path === "/admin/") return "users";
  return ADMIN_TABS.find((tab) => path === `/admin/${tab}`) ?? null;
}

/** Frame of the administration pages: one link per page with the current one marked, then the page itself. */
export function AdminLayout({ tab, children }: { tab: AdminTab; children: ReactNode }) {
  const m = useStrings();
  useDocumentTitle(m.admin.tabs[tab], m.admin.title);
  return (
    <div>
      <nav aria-label={m.admin.title} className="mb-6 border-b border-border">
        <ul className="flex flex-wrap gap-1">
          {ADMIN_TABS.map((t) => (
            <li key={t}>
              <Link
                href={`/admin/${t}`}
                aria-current={t === tab ? "page" : undefined}
                className="-mb-px inline-flex min-h-11 items-center rounded-t-md border-b-2 border-transparent px-3 py-2 text-base font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-selected aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
              >
                {m.admin.tabs[t]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}

/** Render the heading of an administration page, also shown while it loads or failed, so the focus finds it. */
export function AdminPageHeader({ tab, description }: { tab: AdminTab; description?: ReactNode }) {
  const m = useStrings();
  return <PageHeader eyebrow={m.admin.title} title={m.admin.tabs[tab]} description={description} />;
}
