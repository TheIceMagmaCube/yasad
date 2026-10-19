import { ArrowLeft, CircleCheck, Search } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { useDebouncedStatus } from "../../lib/announcer";
import { useDocumentTitle } from "../../lib/page";
import { Link } from "../Link";
import { ShellNotice } from "../ShellNotice";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/**
 * Administration sections, in navigation order. A section joins the list once it exists: no empty entry. `bar`
 * holds literal classes, so Tailwind finds them: the mark of the current one.
 */
export const ADMIN_SECTIONS = [
  { id: "dashboard", href: "/admin", bar: "before:bg-category-1-fill" },
  { id: "users", href: "/admin/users", bar: "before:bg-category-3-fill" },
  { id: "links", href: "/admin/links", bar: "before:bg-category-2-fill" },
  { id: "history", href: "/admin/history", bar: "before:bg-category-4-fill" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["id"];

// The current entry has a bar under it in its section colour and a bold label, so it stands out without colour
// alone; in forced colors mode the bar takes the text colour.
const ENTRY =
  "relative flex min-h-11 items-center rounded-md px-3 text-base text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden before:absolute before:inset-x-3 before:bottom-0.5 before:hidden before:h-1 before:rounded-full forced-colors:before:bg-[CanvasText] aria-[current=page]:font-bold aria-[current=page]:text-foreground aria-[current=page]:before:block";

type AdminShellProps = {
  section: AdminSection;
  /** Page title, the h1; the section name unless the page says otherwise (an item's name on its own page). */
  title?: string;
  /** Extra parts of the document title, most specific first. */
  titleParts?: string[];
  /** Link back to the list an item page was opened from. */
  back?: { href: string; label: string };
  /** Shown before the title (a person's initials). */
  leading?: ReactNode;
  /** Lines under the title: e-mail, origin, a sentence on an abnormal state. */
  subtitle?: ReactNode;
  /** Content between the section links and the title, full width: a hero band. */
  banner?: ReactNode;
  children: ReactNode;
};

/**
 * Frame of the administration pages: one row of section links, then the page title (an item page has a link back to
 * its list above it), then the page. No eyebrow and no description: what needs explaining is said in the empty
 * states and on the item pages.
 */
export function AdminShell({ section, title, titleParts = [], back, leading, subtitle, banner, children }: AdminShellProps) {
  const m = useStrings();
  const heading = title ?? m.admin.tabs[section];
  useDocumentTitle(...titleParts, ...(title ? [title] : []), m.admin.tabs[section], m.admin.title);
  return (
    <div data-slot="admin-shell">
      <nav aria-label={m.admin.title} className="mb-6 border-b-[1.5px] border-border">
        <ul className="-mx-3 flex flex-wrap gap-x-1 gap-y-1">
          {ADMIN_SECTIONS.map(({ id, href, bar }) => (
            <li key={id}>
              <Link href={href} aria-current={id === section ? "page" : undefined} className={cn(ENTRY, bar)}>
                {m.admin.tabs[id]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {banner}
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm underline decoration-link-decoration decoration-2 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="mb-6 flex items-start gap-4">
        {leading}
        <div className="min-w-0">
          <h1 tabIndex={-1} className="text-display wrap-anywhere outline-none">
            {heading}
          </h1>
          {subtitle && <div className="mt-1 flex flex-col gap-1 text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
      <ShellNotice />
      {children}
    </div>
  );
}

type AdminToolbarProps = {
  /** Id of the filter field, also the focus fallback of the page. */
  filterId: string;
  filterLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** Visible count, read once the person stops typing in the filter. */
  count: string;
  /** More filters, after the text filter (a group select). */
  filters?: ReactNode;
  /** The main action first, then secondary ones. */
  actions?: ReactNode;
  /** Text of the last success; the announcer reads it, so the line is no live region. */
  status: string;
};

/**
 * Render the head of a list on one line without a frame: filter, count, actions; the status line of the last
 * success under it, only while there is one.
 *
 * Escape in a filter that holds text clears it, and stops there; in an empty filter it goes on to the page.
 */
export function AdminToolbar({ filterId, filterLabel, query, onQueryChange, count, filters, actions, status }: AdminToolbarProps) {
  useDebouncedStatus(query, count);
  return (
    <div data-slot="admin-toolbar" className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-xs sm:min-w-56">
          <Label htmlFor={filterId} className="sr-only">
            {filterLabel}
          </Label>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={filterId}
            type="search"
            autoComplete="off"
            placeholder={filterLabel}
            data-focus-fallback=""
            className="pl-9"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape" || query === "") return;
              e.preventDefault();
              e.stopPropagation();
              onQueryChange("");
            }}
          />
        </div>
        {filters}
        <p data-slot="toolbar-count" className="text-caption mr-auto text-muted-foreground tabular-nums">
          {count}
        </p>
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
      {status && (
        <p data-slot="toolbar-status" className="flex items-start gap-1.5 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          <span>{status}</span>
        </p>
      )}
    </div>
  );
}
