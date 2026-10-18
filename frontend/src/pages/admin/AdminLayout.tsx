import { LibraryBig, type LucideIcon, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Link } from "../../components/Link";
import { PageHeader } from "../../components/PageHeader";
import { useStrings } from "../../i18n/LocaleProvider";
import { useDocumentTitle } from "../../lib/page";

/**
 * Administration sections, in navigation order; the first one opens on /admin. A new section adds an entry here,
 * its label in `admin.tabs` and its page in the route table of AdminRoutes.tsx (the types require both).
 * `tone` holds literal classes, so Tailwind finds them: the fill of the current tab and the base of its relief.
 */
const SECTIONS = [
  { id: "users", icon: UserRound, tone: "aria-[current=page]:bg-category-3-fill aria-[current=page]:[--relief-color:var(--category-3-fill)]" },
  { id: "groups", icon: Users, tone: "aria-[current=page]:bg-category-4-fill aria-[current=page]:[--relief-color:var(--category-4-fill)]" },
  { id: "catalog", icon: LibraryBig, tone: "aria-[current=page]:bg-category-2-fill aria-[current=page]:[--relief-color:var(--category-2-fill)]" },
] as const satisfies readonly { id: string; icon: LucideIcon; tone: string }[];

export type AdminTab = (typeof SECTIONS)[number]["id"];
export const ADMIN_TABS: readonly AdminTab[] = SECTIONS.map((section) => section.id);

/** Address the bare /admin path stands for. */
export const ADMIN_HOME = `/admin/${SECTIONS[0].id}`;

/** Return the tab an /admin path shows, or null for a path outside the section. */
export function adminTab(path: string): AdminTab | null {
  if (path === "/admin" || path === "/admin/") return SECTIONS[0].id;
  return ADMIN_TABS.find((tab) => path === `/admin/${tab}`) ?? null;
}

// Raised keys like the outline buttons. The current one takes its section's fill and an underlined label, so it
// stands out without colour, forced colors mode included. Tabs wrap onto further rows rather than scroll, and a
// long label wraps inside its tab. The focus outline replaces the forced colors boundary of .relief only while
// focused, so the tab never carries outline-none.
const TAB =
  "relief inline-flex min-h-11 max-w-full items-center gap-2 rounded-md bg-card px-4 py-2 font-heading text-base font-bold text-card-foreground [--relief-color:var(--control-ring)] [--relief-ring:var(--control-ring)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-[current=page]:text-on-fill aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-4";

/** Frame of the administration pages: one tab per section with the current one marked, then the page itself. */
export function AdminLayout({ tab, children }: { tab: AdminTab; children: ReactNode }) {
  const m = useStrings();
  useDocumentTitle(m.admin.tabs[tab], m.admin.title);
  return (
    <div>
      <nav aria-label={m.admin.title} className="mb-8">
        <ul className="flex flex-wrap gap-x-2 gap-y-3 pb-1.5">
          {SECTIONS.map(({ id, icon: Icon, tone }) => (
            <li key={id} className="max-w-full">
              <Link href={`/admin/${id}`} aria-current={id === tab ? "page" : undefined} className={cn(TAB, tone)}>
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 wrap-anywhere">{m.admin.tabs[id]}</span>
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
