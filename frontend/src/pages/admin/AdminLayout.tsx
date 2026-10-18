import { LibraryBig, type LucideIcon, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Link } from "../../components/Link";
import { PageHeader } from "../../components/PageHeader";
import { useStrings } from "../../i18n/LocaleProvider";
import { useDocumentTitle } from "../../lib/page";

export const ADMIN_TABS = ["users", "groups", "catalog"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** Icon and colour of each tab (literal classes, so Tailwind finds them). */
const TAB_STYLE: Record<AdminTab, { icon: LucideIcon; current: string }> = {
  users: { icon: UserRound, current: "aria-[current=page]:bg-category-3-fill aria-[current=page]:[--relief-color:var(--category-3-fill)]" },
  groups: { icon: Users, current: "aria-[current=page]:bg-category-4-fill aria-[current=page]:[--relief-color:var(--category-4-fill)]" },
  catalog: { icon: LibraryBig, current: "aria-[current=page]:bg-category-2-fill aria-[current=page]:[--relief-color:var(--category-2-fill)]" },
};

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
      <nav aria-label={m.admin.title} className="mb-8">
        <ul className="flex flex-wrap gap-3 pb-1.5">
          {ADMIN_TABS.map((t) => {
            const { icon: Icon, current } = TAB_STYLE[t];
            return (
              <li key={t}>
                <Link
                  href={`/admin/${t}`}
                  aria-current={t === tab ? "page" : undefined}
                  className={`relief inline-flex min-h-11 items-center gap-2 rounded-md bg-card px-4 py-2 font-heading text-base font-bold text-foreground [--relief-ring:var(--border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:text-on-fill aria-[current=page]:[--relief-ring:transparent] aria-[current=page]:[--relief-inset:rgb(255_255_255/0.55)] ${current}`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {m.admin.tabs[t]}
                </Link>
              </li>
            );
          })}
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
