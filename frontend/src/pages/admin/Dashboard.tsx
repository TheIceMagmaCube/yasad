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

/** Decorative band at the head of the dashboard: the pixel scene and a line drawn at random, like the sign-in screens. */
function Hero({ links }: { links: number }) {
  const m = useStrings();
  const [index] = useState(() => Math.floor(Math.random() * 5));
  const lines = m.links.heroLines(links);
  return (
    <div aria-hidden="true" data-slot="admin-hero" className="relative isolate mb-8 flex h-24 items-end overflow-hidden rounded-(--radius-card) bg-header p-3 forced-colors:hidden sm:h-28 sm:items-center sm:px-6">
      {/* A window on the skyline: the scene keeps its proportions and is cut from the top, so the horizon shows
          whatever the band's width; from sm it takes the right of the band, the line sitting on plain header. */}
      <div className="absolute inset-y-0 right-0 -z-10 w-full overflow-hidden sm:w-[26rem]">
        <PixelScene className="absolute inset-x-0 bottom-0 aspect-[8/5]" />
      </div>
      <p className="max-w-full rounded-md border-2 border-header-active bg-header px-3 py-1.5 font-heading text-sm font-bold text-header-foreground sm:max-w-[calc(100%-27rem)] sm:border-transparent sm:px-0 sm:text-lg">
        {lines[index % lines.length]}
      </p>
    </div>
  );
}

/** Admin home: what the instance holds, then what needs a look, each item a link to the list filtered on it. */
export function Dashboard() {
  const m = useStrings();
  const d = m.dashboard;
  const users = useAdminCollection(api.users);
  const groups = useAdminCollection(api.groups);
  const catalog = useAdminCollection(api.categories);

  const failed = [users, groups, catalog].find((c) => c.status === "error");
  const ready = users.data && groups.data && catalog.data;
  const links = catalog.data?.flatMap((c) => c.links) ?? [];

  const todo: { id: string; n: number; text: string; href: string }[] = [];
  if (users.data && groups.data && catalog.data) {
    const temporary = users.data.filter((u) => u.mustChangePassword).length;
    const disabled = users.data.filter((u) => u.disabled).length;
    const empty = groups.data.filter((g) => g.source === "local" && g.memberIds.length === 0);
    const noGroup = links.filter((l) => l.groups.length === 0).length + catalog.data.filter((c) => c.groups.length === 0).length;
    const unknownIcon = links.filter((l) => l.icon && !l.iconKnown).length;
    const cited = new Set([...catalog.data.flatMap((c) => c.groups), ...links.flatMap((l) => l.groups)]);
    const unseen = groups.data.filter((g) => neverReceived(g) && cited.has(groupRefOf(g))).length;
    todo.push(
      { id: "temporary", n: temporary, text: m.users.attentionTemporary(temporary), href: "/admin/users?state=temporary" },
      { id: "disabled", n: disabled, text: m.users.attentionDisabled(disabled), href: "/admin/users?state=disabled" },
      {
        id: "empty",
        n: empty.length,
        text: m.groups.attentionEmpty(empty.length),
        href: empty.length === 1 ? `/admin/groups/${encodeURIComponent(empty[0]!.id)}` : "/admin/users",
      },
      { id: "noGroup", n: noGroup, text: m.links.attentionNoGroup(noGroup), href: "/admin/links?state=noGroup" },
      { id: "unknownIcon", n: unknownIcon, text: m.links.attentionUnknownIcon(unknownIcon), href: "/admin/links?state=unknownIcon" },
      { id: "newOidc", n: unseen, text: d.unseenGroups(unseen), href: "/admin/links?state=newOidc" },
    );
  }
  const items = todo.filter((item) => item.n > 0);
  const counters = [
    { label: d.counters.people, value: users.data?.length, href: "/admin/users" },
    { label: d.counters.groups, value: groups.data?.filter((g) => g.source !== "system").length, href: "/admin/users" },
    { label: d.counters.categories, value: catalog.data?.length, href: "/admin/links" },
    { label: d.counters.links, value: catalog.data ? links.length : undefined, href: "/admin/links" },
  ];

  return (
    <AdminShell section="dashboard" banner={<Hero links={links.length} />}>
      {failed ? (
        <LoadError attempt={failed.attempt} message={m.errors.generic} pending={failed.retrying} onRetry={failed.retry} />
      ) : (
        <div className="flex flex-col gap-10">
          <ul className="grid grid-cols-2 border-y-[1.5px] border-border sm:grid-cols-4">
            {counters.map((c) => (
              <li key={c.label} className="border-border odd:border-r max-sm:[&:nth-child(-n+2)]:border-b sm:border-r sm:last:border-r-0">
                <Link href={c.href} className="flex flex-col gap-1 px-4 py-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                  <span className="text-sm text-muted-foreground">{c.label}</span>
                  <span className="font-heading text-3xl font-bold tabular-nums">{c.value ?? "-"}</span>
                </Link>
              </li>
            ))}
          </ul>
          <section aria-labelledby="dashboard-todo">
            <h2 id="dashboard-todo" className="text-section mb-3">
              {d.todo}
            </h2>
            {!ready ? (
              <p className="text-muted-foreground">{m.loading}</p>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground">{d.nothing}</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="flex min-h-12 items-center gap-3 px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
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
