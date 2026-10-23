import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { api } from "../../api";
import { AdminShell } from "../../components/admin/AdminShell";
import { Link } from "../../components/Link";
import { LoadError } from "../../components/LoadError";
import { PixelScene } from "../../components/PixelScene";
import { useStrings } from "../../i18n/LocaleProvider";
import { useAdminCollection } from "../../lib/admin-collection";
import { groupRefOf, neverReceived } from "../../lib/group-ref";
import { groupHref } from "./people/hrefs";

/**
 * Render the decorative band at the head of the dashboard: the pixel scene and a line drawn at random. It says
 * nothing the page does not, so assistive technologies skip it and forced colors drop it.
 */
function Hero({ links }: { links: number | null }) {
  const m = useStrings();
  // As on the sign-in screen, the draw is kept, not the string: a language change shows the same line translated.
  const [draw] = useState(() => Math.random());
  const lines = links === null ? [] : m.dashboard.heroLines(links);
  return (
    <div
      aria-hidden="true"
      data-slot="admin-hero"
      className="relative isolate mb-8 flex h-24 items-end overflow-hidden rounded-(--radius-card) bg-header p-3 forced-colors:hidden sm:h-28 sm:items-center sm:px-6"
    >
      {/* The scene keeps its proportions and is cut from the top, so the horizon shows at any width; from sm it
          takes the right of the band and the line sits on plain header colour. */}
      <div className="absolute inset-y-0 right-0 -z-10 w-full overflow-hidden sm:w-[26rem]">
        <PixelScene className="absolute inset-x-0 bottom-0 aspect-[8/5]" />
      </div>
      {lines.length > 0 && (
        <p className="max-w-full rounded-md border-2 border-header-active bg-header px-3 py-1.5 font-heading text-sm font-bold text-header-foreground sm:max-w-[calc(100%-27rem)] sm:border-transparent sm:px-0 sm:text-lg">
          {lines[Math.floor(draw * lines.length)]}
        </p>
      )}
    </div>
  );
}

const ITEM =
  "flex min-h-12 items-center gap-3 px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden";

/** Admin home: what the instance holds, then what needs a look, each item a link to the list filtered on it. */
export function Dashboard() {
  const m = useStrings();
  const d = m.dashboard;
  const users = useAdminCollection(api.users);
  const groups = useAdminCollection(api.groups);
  const state = useAdminCollection(api.catalogState);
  const catalog = useAdminCollection(api.categories);

  const failed = [users, groups, state, catalog].find((c) => c.status === "error");

  const todo: { id: string; n: number; text: string; href: string }[] = [];
  if (users.data && groups.data && catalog.data) {
    const links = catalog.data.flatMap((c) => c.links);
    const empty = groups.data.filter((g) => g.source === "local" && g.memberIds.length === 0);
    const noGroup = catalog.data.filter((c) => c.groups.length === 0).length + links.filter((l) => l.groups.length === 0).length;
    const unknownIcon = links.filter((l) => l.icon && !l.iconKnown).length;
    // Only groups the catalog names: a provider group nobody refers to opens nothing, so its name cannot be wrong.
    const cited = new Set([...catalog.data.flatMap((c) => c.groups), ...links.flatMap((l) => l.groups)]);
    const unseen = groups.data.filter((g) => neverReceived(g) && cited.has(groupRefOf(g))).length;
    const temporary = users.data.filter((u) => u.mustChangePassword).length;
    const disabled = users.data.filter((u) => u.disabled).length;
    todo.push(
      { id: "temporary", n: temporary, text: m.users.attentionTemporary(temporary), href: "/admin/users?state=temporary" },
      { id: "disabled", n: disabled, text: m.users.attentionDisabled(disabled), href: "/admin/users?state=disabled" },
      { id: "empty", n: empty.length, text: m.groups.attentionEmpty(empty.length), href: empty.length === 1 ? groupHref(empty[0]!.id) : "/admin/users" },
      { id: "noGroup", n: noGroup, text: d.noGroup(noGroup), href: "/admin/links?state=noGroup" },
      { id: "unknownIcon", n: unknownIcon, text: d.unknownIcon(unknownIcon), href: "/admin/links?state=unknownIcon" },
      { id: "neverReceived", n: unseen, text: d.unseenGroups(unseen), href: "/admin/links?state=neverReceived" },
    );
  }
  const items = todo.filter((item) => item.n > 0);
  const counters = [
    { id: "people", value: users.data?.length, href: "/admin/users" },
    { id: "groups", value: groups.data?.filter((g) => g.source !== "system").length, href: "/admin/users" },
    { id: "categories", value: state.data?.categories, href: "/admin/links" },
    { id: "links", value: state.data?.links, href: "/admin/links" },
  ] as const;

  return (
    <AdminShell section="dashboard" banner={<Hero links={state.data?.links ?? null} />}>
      {failed ? (
        <LoadError attempt={failed.attempt} message={m.errors.generic} pending={failed.retrying} onRetry={failed.retry} />
      ) : (
        <div className="flex flex-col gap-10">
          <ul data-slot="dashboard-counters" className="grid grid-cols-2 border-y-[1.5px] border-border sm:grid-cols-4">
            {counters.map((c) => (
              <li key={c.id} className="border-border odd:border-r max-sm:[&:nth-child(-n+2)]:border-b sm:border-r sm:last:border-r-0">
                <Link href={c.href} className="flex flex-col gap-1 px-4 py-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden">
                  <span className="text-sm text-muted-foreground">{d.counters[c.id]}</span>
                  <span className="font-heading text-3xl font-bold tabular-nums">{c.value ?? "-"}</span>
                </Link>
              </li>
            ))}
          </ul>
          <section aria-labelledby="dashboard-todo">
            <h2 id="dashboard-todo" className="text-section mb-3">
              {d.todo}
            </h2>
            {!(users.data && groups.data && catalog.data) ? (
              <p className="text-muted-foreground">{m.loading}</p>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground">{d.nothing}</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className={ITEM}>
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning forced-colors:bg-[CanvasText]" />
                      <span className="flex-1">{item.text}</span>
                      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AdminShell>
  );
}
