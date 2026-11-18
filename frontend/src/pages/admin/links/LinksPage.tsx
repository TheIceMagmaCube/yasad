import { ArrowDown, ArrowLeft, ArrowUp, FileCode2, ListOrdered, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { type AdminCategory, type AdminGroup, type AdminLink, api, type EditWarning, type HomeIcon } from "../../../api";
import { AdminShell, AdminToolbar } from "../../../components/admin/AdminShell";
import { AdminTable, type Column, RowLink } from "../../../components/admin/AdminTable";
import { listHref, rememberRow, useQueryState, useRestoreRow } from "../../../components/admin/DetailPage";
import { StateMark } from "../../../components/admin/StateMark";
import { EmptyState } from "../../../components/EmptyState";
import { LinkIcon } from "../../../components/home/LinkIcon";
import { Link } from "../../../components/Link";
import { LoadError } from "../../../components/LoadError";
import { Alert } from "../../../components/ui/alert";
import { Button, buttonVariants } from "../../../components/ui/button";
import type { Messages } from "../../../i18n/en";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useAdminCollection } from "../../../lib/admin-collection";
import { useListFeedback } from "../../../lib/admin-list";
import { useAnnounce } from "../../../lib/announcer";
import { categoryTone } from "../../../lib/category-tone";
import { prepareFilter } from "../../../lib/filter";
import { focusById } from "../../../lib/focus";
import { groupRefLabel, groupRefOf, neverReceived } from "../../../lib/group-ref";
import { invalidateHome } from "../../../lib/home-store";
import { navigate } from "../../../lib/router";
import { cn } from "../../../lib/utils";
import { AdminCatalog } from "../AdminCatalog";
import { adminErrorText } from "../shared";
import { AddLinks } from "./AddLinks";
import { CategoryPane, LinkPane } from "./LinkPane";

const LIST = "/admin/links";
const FILTER_ID = "links-filter";
export const linkHref = (id: string) => `${LIST}/${encodeURIComponent(id)}`;
export const categoryHref = (id: string) => `${LIST}/categories/${encodeURIComponent(id)}`;
const linkIdOf = (id: string) => `link-${id}-link`;
const categoryLinkIdOf = (id: string) => `category-${id}-link`;

type Attention = "noGroup" | "unknownIcon" | "newOidc";
const ATTENTIONS: readonly string[] = ["noGroup", "unknownIcon", "newOidc"];

/** Return the icon of a stored link as the home page draws it; an unknown one draws the first letter. */
function iconOf(link: AdminLink): HomeIcon | null {
  if (!link.icon || !link.iconKnown) return null;
  const [set, name] = link.icon.split(":");
  return set === "si" || set === "lucide" ? { set, name: name! } : null;
}

/** Return the host of an address, or the address itself when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Return the first two group names, and how many more there are. */
function groupsText(refs: string[], m: Messages) {
  if (refs.length === 0) return <span className="text-muted-foreground">{m.links.noGroups}</span>;
  const shown = refs.slice(0, 2).map(groupRefLabel);
  const more = refs.length - shown.length;
  return (
    <span>
      {shown.join(", ")}
      {more > 0 && <span className="ml-1.5 text-muted-foreground">{m.users.more(more)}</span>}
    </span>
  );
}

/** Return the one mark of an abnormal link: no group first, then inactive, then an unknown icon; none when all is well. */
function stateOf(link: AdminLink, m: Messages, unseen: ReadonlySet<string>) {
  if (link.groups.length === 0) return <StateMark tone="destructive">{m.links.states.noGroup}</StateMark>;
  if (link.groups.some((g) => unseen.has(g))) return <StateMark tone="warning">{m.links.states.newOidc}</StateMark>;
  if (!link.active) return <StateMark tone="muted">{m.links.states.inactive}</StateMark>;
  if (link.icon && !link.iconKnown) return <StateMark tone="warning">{m.links.states.unknownIcon}</StateMark>;
  return null;
}

/** Return the provider groups only typed, never received in a sign-in, by reference. */
function unseenOidc(groups: AdminGroup[] | null): Set<string> {
  return new Set((groups ?? []).filter(neverReceived).map(groupRefOf));
}

/** Admin page: one table per category in the stored order, a reorder mode, and the detail of the item open. */
export function LinksPage({ open }: { open: { kind: "link" | "category"; id: string } | null }) {
  const m = useStrings();
  const s = m.links;
  const catalog = useAdminCollection(api.categories);
  const groups = useAdminCollection(api.groups);
  const state = useAdminCollection(api.catalogState);
  const feedback = useListFeedback();
  const [query, setQuery] = useQueryState("q");
  // A state the dashboard links to, as `?state=`.
  const [stateParam, setStateParam] = useQueryState("state");
  const attention = ATTENTIONS.includes(stateParam) ? (stateParam as Attention) : null;
  const [reordering, setReordering] = useState(false);
  // Warnings of a creation, shown in the pane of the new item, which replaces the creation form.
  const [createdWarnings, setCreatedWarnings] = useState<Record<string, EditWarning[]>>({});
  const managed = state.data?.managedByFile ?? false;

  const categories = catalog.data;
  const allLinks = useMemo(() => (categories ?? []).flatMap((c) => c.links), [categories]);
  const unseen = useMemo(() => unseenOidc(groups.data), [groups.data]);
  const filter = useMemo(() => prepareFilter(allLinks, (l) => [l.title, l.url, ...l.keywords]), [allLinks]);
  const matched = useMemo(() => new Set(filter(query).map((l) => l.id)), [filter, query]);

  const linkAttention: Record<Attention, (l: AdminLink) => boolean> = {
    noGroup: (l) => l.groups.length === 0,
    unknownIcon: (l) => Boolean(l.icon) && !l.iconKnown,
    newOidc: (l) => l.groups.some((g) => unseen.has(g)),
  };
  const categoryAttention: Record<Attention, (c: AdminCategory) => boolean> = {
    noGroup: (c) => c.groups.length === 0,
    unknownIcon: () => false,
    newOidc: (c) => c.groups.some((g) => unseen.has(g)),
  };

  const filtering = query.trim() !== "" || attention !== null;
  const visible = (categories ?? [])
    .map((c) => {
      const links = c.links.filter((l) => matched.has(l.id) && (!attention || linkAttention[attention](l)));
      const keep = !filtering || links.length > 0 || (attention !== null && categoryAttention[attention](c));
      return keep ? { ...c, links } : null;
    })
    .filter((c): c is AdminCategory => c !== null);

  const openId = open && open.id !== "new" ? open.id : null;
  useRestoreRow(LIST, open === null && categories !== null && !reordering);
  const close = () => history.back();
  const changeQuery = (next: string) => {
    setQuery(next);
    feedback.clearForFilter();
  };

  const columns = (index: number): Column<AdminLink>[] => [
    {
      id: "icon",
      header: s.columns.icon,
      headerHidden: true,
      cell: (l) => <LinkIcon icon={iconOf(l)} title={l.title} className={cn("size-8 [&_svg]:size-5 [&>span]:text-base", categoryTone(index).tile)} />,
      className: "w-14 pr-0",
    },
    {
      id: "title",
      header: s.columns.title,
      cell: (l) => (
        <div className="flex min-w-0 flex-col">
          <span className="wrap-anywhere">
            <RowLink id={linkIdOf(l.id)} href={linkHref(l.id)} listBase={LIST}>
              {l.title}
            </RowLink>
          </span>
          <span className="truncate text-[0.8125rem] text-muted-foreground @min-[36rem]/table:hidden">{hostOf(l.url)}</span>
        </div>
      ),
      className: "@min-[36rem]/table:w-[32%] @min-[48rem]/table:w-[26%]",
    },
    {
      id: "address",
      header: s.columns.address,
      cell: (l) => <span className="block max-w-[16rem] truncate text-muted-foreground">{hostOf(l.url)}</span>,
      className: "hidden @min-[36rem]/table:table-cell @min-[36rem]/table:w-[30%] @min-[48rem]/table:w-[24%]",
    },
    {
      id: "groups",
      header: s.columns.groups,
      cell: (l) => groupsText(l.groups, m),
      className: "hidden @min-[48rem]/table:table-cell",
    },
    {
      id: "state",
      header: s.columns.state,
      cell: (l) => stateOf(l, m, unseen),
      className: "w-[42%] @min-[36rem]/table:w-[30%] @min-[48rem]/table:w-[21%]",
    },
  ];

  const openCategory = open?.kind === "category" && openId ? (categories?.find((c) => c.id === openId) ?? null) : null;
  const openLink = open?.kind === "link" && openId ? (allLinks.find((l) => l.id === openId) ?? null) : null;
  const replaceLink = (link: AdminLink) =>
    catalog.setData((all) =>
      all.map((c) => ({ ...c, links: c.id === link.categoryId ? (c.links.some((l) => l.id === link.id) ? c.links.map((l) => (l.id === link.id ? link : l)) : [...c.links, link]) : c.links.filter((l) => l.id !== link.id) })),
    );
  const saved = (text: string) => {
    feedback.say(text);
    invalidateHome();
    void groups.refresh();
  };

  if (open && !categories) {
    return (
      <AdminShell section="links" title={m.loading}>
        {catalog.status === "error" ? <LoadError attempt={catalog.attempt} message={s.loadError} pending={catalog.retrying} onRetry={catalog.retry} /> : null}
      </AdminShell>
    );
  }
  if (open && categories && open.id === "new") {
    return (
      <AdminShell section="links" title={m.admin.add} back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }}>
        <AddLinks
          categories={categories}
          groups={groups.data ?? []}
          initialType={open.kind}
          onLinkCreated={(link, warnings) => {
            replaceLink(link);
            setCreatedWarnings((prev) => ({ ...prev, [link.id]: warnings }));
            saved(s.created(link.title));
            rememberRow(LIST, linkIdOf(link.id));
            navigate(listHref(LIST));
          }}
          onCategoryCreated={(category, warnings) => {
            setCreatedWarnings((prev) => ({ ...prev, [category.id]: warnings }));
            catalog.setData((all) => [...all, category]);
            saved(s.created(category.title));
            rememberRow(LIST, categoryLinkIdOf(category.id));
            navigate(listHref(LIST));
          }}
        />
      </AdminShell>
    );
  }
  if (open && categories) {
    if (open.kind === "link" && openLink) {
      return (
        <LinkPane
          key={open.id}
          link={openLink}
          categories={categories}
          groups={groups.data ?? []}
          readOnly={managed}
          onClose={close}
          warnings={createdWarnings[open.id]}
          onSaved={(link, created, warnings) => {
            replaceLink(link);
            if (created) setCreatedWarnings((prev) => ({ ...prev, [link.id]: warnings }));
            saved(created ? s.created(link.title) : s.saved(link.title));
            if (created) navigate(linkHref(link.id), { replace: true });
          }}
          onDeleted={(link) => {
            const index = categories.find((c) => c.id === link.categoryId)?.links.findIndex((l) => l.id === link.id) ?? 0;
            feedback.bury({ id: link.id, text: s.deleted(link.title), variant: "success", index: Math.max(0, index), section: link.categoryId });
            catalog.setData((all) => all.map((c) => ({ ...c, links: c.links.filter((l) => l.id !== link.id) })));
            invalidateHome();
            navigate(listHref(LIST));
          }}
        />
      );
    }
    if (open.kind === "category" && openCategory) {
      return (
        <CategoryPane
          key={open.id}
          category={openCategory}
          warnings={createdWarnings[open.id]}
          groups={groups.data ?? []}
          readOnly={managed}
          onClose={close}
          onSaved={(category, created, warnings) => {
            if (created) setCreatedWarnings((prev) => ({ ...prev, [category.id]: warnings }));
            catalog.setData((all) => (created ? [...all, category] : all.map((c) => (c.id === category.id ? { ...category, links: c.links } : c))));
            saved(created ? s.created(category.title) : s.saved(category.title));
            if (created) navigate(categoryHref(category.id), { replace: true });
          }}
          onDeleted={(category) => {
            catalog.setData((all) => all.filter((c) => c.id !== category.id));
            feedback.say(s.deleted(category.title));
            invalidateHome();
            navigate(listHref(LIST));
            void focusById(FILTER_ID);
          }}
        />
      );
    }
    return (
      <AdminShell section="links" title={m.admin.errors.not_found} back={{ href: LIST, label: m.admin.backTo(s.title) }}>
        <p className="text-muted-foreground">{m.notFound.body}</p>
      </AdminShell>
    );
  }

  const count = !categories ? "" : filtering ? s.countFiltered(visible.reduce((n, c) => n + c.links.length, 0), allLinks.length) : s.count(allLinks.length);

  return (
    <AdminShell section="links">
      {catalog.status === "error" ? (
        <LoadError attempt={catalog.attempt} message={s.loadError} pending={catalog.retrying} onRetry={catalog.retry} />
      ) : reordering && categories ? (
        <Reorder
          categories={categories}
          onOrder={(update) => catalog.setData(update)}
          onDone={() => {
            setReordering(false);
            void focusById("links-reorder");
          }}
        />
      ) : (
        <>
          <AdminToolbar
            filterId={FILTER_ID}
            filterLabel={s.filter}
            query={query}
            onQueryChange={changeQuery}
            count={count}
            status={feedback.status}
            actions={
              <>
                {!managed && (
                  <>
                    <Link id="links-new" href={`${LIST}/new`} className={buttonVariants()} onClick={() => rememberRow(LIST, "links-new")}>
                      <Plus aria-hidden="true" />
                      {m.admin.add}
                    </Link>
                    <Button id="links-reorder" variant="outline" onClick={() => setReordering(true)}>
                      <ListOrdered aria-hidden="true" />
                      {s.reorder}
                    </Button>
                  </>
                )}
                <Link href={`${LIST}/file`} className={buttonVariants({ variant: "ghost" })}>
                  <FileCode2 aria-hidden="true" />
                  {s.file}
                </Link>
              </>
            }
          />
          {managed && (
            <Alert variant="info" className="mb-4">
              {s.managedByFile}
            </Alert>
          )}
          {attention && (
            <p className="mb-4 flex flex-wrap items-center gap-x-3 text-sm">
              <span>
                {m.admin.filtered} {s.states[attention]}
              </span>
              <button
                type="button"
                onClick={() => setStateParam("")}
                className="inline-flex min-h-11 items-center underline decoration-link-decoration decoration-2 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {m.admin.attentionClear}
              </button>
            </p>
          )}
          {!categories ? (
            <div aria-hidden="true" className="appear-delayed h-64 rounded-(--radius-card) bg-muted motion-safe:animate-pulse" />
          ) : visible.length === 0 ? (
            <EmptyState
              title={m.admin.noMatch(query.trim())}
              actions={
                <Button
                  variant="outline"
                  onClick={() => {
                    changeQuery("");
                    setStateParam("");
                    void focusById(FILTER_ID);
                  }}
                >
                  {m.admin.clearFilter}
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-8">
              {visible.map((category) => {
                const index = categories.findIndex((c) => c.id === category.id);
                return (
                  <section key={category.id} aria-labelledby={categoryLinkIdOf(category.id)}>
                    <div className="mb-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1">
                      <h2 className="text-section flex items-center gap-2.5">
                        <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-[2px] forced-colors:hidden", categoryTone(index).bar)} />
                        <Link
                          id={categoryLinkIdOf(category.id)}
                          href={categoryHref(category.id)}
                          onClick={() => rememberRow(LIST, categoryLinkIdOf(category.id))}
                          className="outline-none hover:underline hover:decoration-link-decoration hover:decoration-2 hover:underline-offset-4 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {category.title}
                        </Link>
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {category.groups.length > 0 ? category.groups.map(groupRefLabel).join(", ") : <StateMark tone="destructive">{s.states.noGroup}</StateMark>}
                      </p>
                    </div>
                    {category.links.length === 0 && !filtering ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">{s.emptyCategory}</p>
                    ) : (
                      <AdminTable
                        caption={s.caption(category.title)}
                        columns={columns(index)}
                        sections={[{ id: category.id, rows: category.links }]}
                        tombstones={feedback.tombstones.filter((t) => t.section === category.id)}
                        fixed
                      />
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}

type ReorderProps = {
  categories: AdminCategory[];
  onOrder: (update: (categories: AdminCategory[]) => AdminCategory[]) => void;
  onDone: () => void;
};

/** Return `items` ordered as `order`, the ones it does not name kept at the end. */
function sortBy<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

/**
 * Reorder mode, in two views chosen first: the categories alone, or the links under their category (whose headings
 * do not move). Each move is saved at once; the focus stays on the button pressed and the new position is
 * announced. At either end the button is aria-disabled, so it keeps its place in the tab order.
 */
function Reorder({ categories, onOrder, onDone }: ReorderProps) {
  const m = useStrings();
  const s = m.links;
  const announce = useAnnounce();
  const [target, setTarget] = useState<"categories" | "links">("categories");
  const [error, setError] = useState<{ text: string; n: number } | null>(null);

  async function move(kind: "category" | "link", item: { id: string; title: string }, direction: "up" | "down", buttonId: string, within?: string) {
    setError(null);
    try {
      const { order } = kind === "category" ? await api.moveCategory(item.id, direction) : await api.moveLink(item.id, direction);
      onOrder((all) => (kind === "category" ? sortBy(all, order) : all.map((c) => (c.links.some((l) => l.id === item.id) ? { ...c, links: sortBy(c.links, order) } : c))));
      invalidateHome();
      void focusById(buttonId);
      const position = order.indexOf(item.id) + 1;
      announce(within ? s.positionIn(item.title, position, order.length, within) : s.position(item.title, position, order.length));
    } catch (err) {
      setError((prev) => ({ text: adminErrorText(err, m), n: (prev?.n ?? 0) + 1 }));
    }
  }

  const moves = (kind: "category" | "link", item: { id: string; title: string }, index: number, total: number, within?: string) => (
    <div className="flex shrink-0 gap-1">
      {(["up", "down"] as const).map((direction) => {
        const id = `${kind}-${item.id}-${direction}`;
        const edge = direction === "up" ? index === 0 : index === total - 1;
        const label = kind === "category" ? (direction === "up" ? s.moveCategoryUp : s.moveCategoryDown) : direction === "up" ? s.moveLinkUp : s.moveLinkDown;
        return (
          <Button
            key={direction}
            id={id}
            variant="outline"
            className="px-3"
            aria-label={label(item.title)}
            aria-disabled={edge || undefined}
            onClick={() => !edge && void move(kind, item, direction, id, within)}
          >
            {direction === "up" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
            <span className="max-sm:sr-only">{direction === "up" ? s.moveUp : s.moveDown}</span>
          </Button>
        );
      })}
    </div>
  );

  const segment =
    "inline-flex min-h-11 items-center px-4 text-sm outline-none first:rounded-l-md last:rounded-r-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-pressed:bg-accent aria-pressed:font-bold aria-pressed:shadow-[inset_0_-3px_0_var(--selected)] hover:bg-accent";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="group" aria-label={s.reorder} className="mr-auto inline-flex divide-x-[1.5px] divide-border rounded-md border-[1.5px] border-border bg-card">
          <button type="button" aria-pressed={target === "categories"} onClick={() => setTarget("categories")} className={segment}>
            {s.reorderCategories}
          </button>
          <button type="button" aria-pressed={target === "links"} onClick={() => setTarget("links")} className={segment}>
            {s.reorderLinks}
          </button>
        </div>
        <Button onClick={onDone}>
          <ArrowLeft aria-hidden="true" />
          {s.done}
        </Button>
      </div>
      {error && (
        <Alert key={error.n} variant="destructive" autoFocus className="mb-4">
          {error.text}
        </Alert>
      )}
      {target === "categories" ? (
        <ol className="flex max-w-2xl flex-col divide-y divide-border border-y-[1.5px] border-border">
          {categories.map((category, ci) => (
            <li key={category.id} className="flex min-h-14 items-center gap-3 py-1.5">
              <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-[2px] forced-colors:hidden", categoryTone(ci).bar)} />
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="font-bold">{category.title}</span>
                <span className="ml-2 text-sm text-muted-foreground">{s.linkCount(category.links.length)}</span>
              </span>
              {moves("category", category, ci, categories.length)}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex max-w-2xl flex-col gap-6">
          {categories.map((category, ci) => (
            <section key={category.id} aria-labelledby={`reorder-${category.id}`}>
              <h2 id={`reorder-${category.id}`} className="text-section mb-1 flex items-center gap-2.5">
                <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-[2px] forced-colors:hidden", categoryTone(ci).bar)} />
                {category.title}
              </h2>
              {category.links.length === 0 ? (
                <p className="pl-6 text-sm text-muted-foreground">{s.emptyCategory}</p>
              ) : (
                <ol className="ml-1.5 flex flex-col divide-y divide-border border-l-2 border-border">
                  {category.links.map((link, li) => (
                    <li key={link.id} className="flex min-h-12 items-center gap-3 py-1 pl-4">
                      <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{li + 1}</span>
                      <span className="min-w-0 flex-1 wrap-anywhere">{link.title}</span>
                      {moves("link", link, li, category.links.length, category.title)}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** The YAML import and export, moved under Links as they were. */
export function LinksFilePage() {
  const m = useStrings();
  return (
    <AdminShell section="links" title={m.links.fileTitle}>
      <Link
        href={LIST}
        className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-sm underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {m.admin.backTo(m.links.title)}
      </Link>
      <AdminCatalog />
    </AdminShell>
  );
}
