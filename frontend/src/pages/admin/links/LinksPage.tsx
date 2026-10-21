import { FileCode2, ListOrdered, Plus } from "lucide-react";
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
import { categoryTone } from "../../../lib/category-tone";
import { prepareFilter } from "../../../lib/filter";
import { focusById } from "../../../lib/focus";
import { groupRefLabel, groupRefOf, neverReceived } from "../../../lib/group-ref";
import { invalidateHome } from "../../../lib/home-store";
import { type EffectiveStatus, effectiveStatus } from "../../../lib/link-status";
import { navigate } from "../../../lib/router";
import { cn } from "../../../lib/utils";
import { AdminCatalog } from "../AdminCatalog";
import { AddLinks } from "./AddLinks";
import { CategoryPage } from "./CategoryPage";
import { categoryHref, isManagedByFile, LIST, linkHref } from "./item-edit";
import { LinkPage } from "./LinkPage";
import { Reorder } from "./Reorder";

const FILTER_ID = "links-filter";
const NEW_ID = "links-new";
const REORDER_ID = "links-reorder";
const linkIdOf = (id: string) => `link-${id}-link`;
const categoryLinkIdOf = (id: string) => `category-${id}-link`;

/** The page of a link or a category, the wizard adding either, or null for the list. */
export type LinksRoute = { kind: "link" | "category"; id: string } | { kind: "new"; type: "link" | "category" } | null;

/** States a list can be narrowed to with `?state=`, as the dashboard links to them. */
const STATES = ["noGroup", "unknownIcon", "neverReceived", "inactive", "down", "statusUnknown"] as const;
type StateFilter = (typeof STATES)[number];

/** Return the icon of a stored link as the home page draws it; an unknown one draws the first letter. */
function iconOf(link: AdminLink): HomeIcon | null {
  if (!link.icon || !link.iconKnown) return null;
  const colon = link.icon.indexOf(":");
  const set = link.icon.slice(0, colon);
  return set === "si" || set === "lucide" ? { set, name: link.icon.slice(colon + 1) } : null;
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

/**
 * Return the one mark of an abnormal link: no group first, then a group never received, inactive, down, unknown icon,
 * status unknown. An inactive link is never checked, so it carries no status mark; an up link carries none either.
 */
function stateOf(link: AdminLink, status: EffectiveStatus | null, m: Messages, unseen: ReadonlySet<string>) {
  if (link.groups.length === 0) return <StateMark tone="destructive">{m.links.states.noGroup}</StateMark>;
  if (link.groups.some((g) => unseen.has(g))) return <StateMark tone="warning">{m.links.states.neverReceived}</StateMark>;
  if (!link.active) return <StateMark tone="muted">{m.links.states.inactive}</StateMark>;
  if (status?.state === "down") return <StateMark tone="destructive">{m.links.states.down}</StateMark>;
  if (link.icon && !link.iconKnown) return <StateMark tone="warning">{m.links.states.unknownIcon}</StateMark>;
  if (status?.state === "unknown") return <StateMark tone="muted">{m.links.states.statusUnknown}</StateMark>;
  return null;
}

/** Return the provider groups only typed, never received in a sign-in, by reference. */
function unseenOidc(groups: AdminGroup[] | null): Set<string> {
  return new Set((groups ?? []).filter(neverReceived).map(groupRefOf));
}

/**
 * Admin section of the catalog: one table per category in the stored order, a reorder mode, the pages of a link or
 * a category, and the wizard adding either. One component for all of them, so the loaded catalog and the filter stay
 * while going from the list to a page and back.
 */
export function LinksPage({ open }: { open: LinksRoute }) {
  const m = useStrings();
  const s = m.links;
  const catalog = useAdminCollection(api.categories);
  const groups = useAdminCollection(api.groups);
  const state = useAdminCollection(api.catalogState);
  const feedback = useListFeedback();
  const [query, setQuery] = useQueryState("q");
  const [stateParam, setStateParam] = useQueryState("state");
  const stateFilter = (STATES as readonly string[]).includes(stateParam) ? (stateParam as StateFilter) : null;
  const [reordering, setReordering] = useState(false);
  // Warnings of a creation, shown on the page of the new item when it is opened.
  const [createdWarnings, setCreatedWarnings] = useState<Record<string, EditWarning[]>>({});
  const managed = state.data?.managedByFile ?? false;
  const checks = state.data?.checks ?? null;
  // Read once, as the people list does, so every row and the filter judge staleness at the same instant.
  const [now] = useState(() => Date.now());
  const statusOf = (l: AdminLink) => effectiveStatus(l, checks, now);

  const categories = catalog.data;
  const allLinks = useMemo(() => (categories ?? []).flatMap((c) => c.links), [categories]);
  const unseen = useMemo(() => unseenOidc(groups.data), [groups.data]);
  const linkFilter = useMemo(() => prepareFilter(allLinks, (l) => [l.title, l.url, ...l.keywords]), [allLinks]);
  const categoryFilter = useMemo(() => prepareFilter(categories ?? [], (c) => [c.title]), [categories]);
  const matched = useMemo(() => new Set(linkFilter(query).map((l) => l.id)), [linkFilter, query]);
  const titleMatched = useMemo(() => new Set(query.trim() ? categoryFilter(query).map((c) => c.id) : []), [categoryFilter, query]);

  const linkState: Record<StateFilter, (l: AdminLink) => boolean> = {
    noGroup: (l) => l.groups.length === 0,
    unknownIcon: (l) => Boolean(l.icon) && !l.iconKnown,
    neverReceived: (l) => l.groups.some((g) => unseen.has(g)),
    inactive: (l) => !l.active,
    down: (l) => l.active && statusOf(l)?.state === "down",
    statusUnknown: (l) => l.active && statusOf(l)?.state === "unknown",
  };
  const categoryState: Record<StateFilter, (c: AdminCategory) => boolean> = {
    noGroup: (c) => c.groups.length === 0,
    unknownIcon: () => false,
    neverReceived: (c) => c.groups.some((g) => unseen.has(g)),
    inactive: () => false,
    down: () => false,
    statusUnknown: () => false,
  };

  const filtering = query.trim() !== "" || stateFilter !== null;
  // A category whose title matches shows all its links, even none; a category in the state asked shows even without links.
  const visible = (categories ?? []).flatMap((c) => {
    const links = c.links.filter((l) => (matched.has(l.id) || titleMatched.has(c.id)) && (!stateFilter || linkState[stateFilter](l)));
    const keep =
      !filtering ||
      links.length > 0 ||
      (stateFilter === null && titleMatched.has(c.id)) ||
      (stateFilter !== null && !query.trim() && categoryState[stateFilter](c));
    return keep ? [{ ...c, links }] : [];
  });

  useRestoreRow(LIST, open === null && categories !== null && !reordering);
  const changeQuery = (next: string) => {
    setQuery(next);
    feedback.clearForFilter();
  };
  const onManaged = () => void state.refresh();
  const replaceLink = (link: AdminLink) =>
    catalog.setData((all) =>
      all.map((c) => {
        if (c.id !== link.categoryId) return { ...c, links: c.links.filter((l) => l.id !== link.id) };
        return { ...c, links: c.links.some((l) => l.id === link.id) ? c.links.map((l) => (l.id === link.id ? link : l)) : [...c.links, link] };
      }),
    );
  const warningsText = (warnings: EditWarning[]) => warnings.map((w) => s.warnings[w]).join(" ");
  /** Say a write went through, with its warnings, and drop what the home page and the group list hold. */
  const saved = (text: string, warnings: EditWarning[]) => {
    feedback.say([text, warningsText(warnings)].filter(Boolean).join(" "));
    invalidateHome();
    void groups.refresh();
    // The number of checked links may have changed.
    void state.refresh();
  };

  /** Go back to the list as it was left, filter kept, the focus on the row `linkId` when it shows. */
  const backToList = (linkId: string) => {
    const href = listHref(LIST);
    rememberRow(LIST, linkId);
    navigate(href);
  };

  const failed = catalog.status === "error" ? catalog : groups.status === "error" ? groups : null;
  if (open && (!categories || !groups.data)) {
    return (
      <AdminShell section="links" title={m.loading}>
        {failed ? <LoadError attempt={failed.attempt} message={s.loadError} pending={failed.retrying} onRetry={failed.retry} /> : null}
      </AdminShell>
    );
  }
  if (open?.kind === "new" && categories && groups.data) {
    return (
      <AdminShell section="links" title={m.admin.add} back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }}>
        {managed ? (
          <Alert variant="info">{s.managedByFile}</Alert>
        ) : (
          <AddLinks
            categories={categories}
            groups={groups.data}
            initialType={open.type}
            onManaged={onManaged}
            onLinkCreated={(link, warnings) => {
              replaceLink(link);
              setCreatedWarnings((prev) => ({ ...prev, [link.id]: warnings }));
              saved(s.created(link.title), warnings);
              backToList(linkIdOf(link.id));
            }}
            onCategoryCreated={(category, warnings) => {
              catalog.setData((all) => [...all, category]);
              setCreatedWarnings((prev) => ({ ...prev, [category.id]: warnings }));
              saved(s.created(category.title), warnings);
              backToList(categoryLinkIdOf(category.id));
            }}
          />
        )}
      </AdminShell>
    );
  }
  if (open?.kind === "link" && categories && groups.data) {
    const link = allLinks.find((l) => l.id === open.id);
    if (!link) return <Missing />;
    return (
      <LinkPage
        key={link.id}
        link={link}
        categories={categories}
        groups={groups.data}
        readOnly={managed}
        onManaged={onManaged}
        warnings={createdWarnings[link.id]}
        onSaved={(updated) => {
          replaceLink(updated);
          saved(s.saved(updated.title), []);
        }}
        onDeleted={(deleted) => {
          const index = categories.find((c) => c.id === deleted.categoryId)?.links.findIndex((l) => l.id === deleted.id) ?? 0;
          feedback.bury({ id: deleted.id, text: s.deleted(deleted.title), variant: "success", index: Math.max(0, index), section: deleted.categoryId });
          catalog.setData((all) => all.map((c) => ({ ...c, links: c.links.filter((l) => l.id !== deleted.id) })));
          invalidateHome();
          void groups.refresh();
          // The number of checked links may have changed.
          void state.refresh();
          navigate(listHref(LIST));
        }}
      />
    );
  }
  if (open?.kind === "category" && categories && groups.data) {
    const category = categories.find((c) => c.id === open.id);
    if (!category) return <Missing />;
    return (
      <CategoryPage
        key={category.id}
        category={category}
        groups={groups.data}
        readOnly={managed}
        onManaged={onManaged}
        warnings={createdWarnings[category.id]}
        onSaved={(updated) => {
          catalog.setData((all) => all.map((c) => (c.id === updated.id ? updated : c)));
          saved(s.saved(updated.title), []);
        }}
        onDeleted={(deleted) => {
          catalog.setData((all) => all.filter((c) => c.id !== deleted.id));
          feedback.say(s.deleted(deleted.title));
          invalidateHome();
          void groups.refresh();
          // Its links went with it, checked ones included.
          void state.refresh();
          navigate(listHref(LIST));
          void focusById(FILTER_ID);
        }}
      />
    );
  }

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
      cell: (l) => stateOf(l, statusOf(l), m, unseen),
      className: "w-[42%] @min-[36rem]/table:w-[30%] @min-[48rem]/table:w-[21%]",
    },
  ];

  const shownLinks = visible.reduce((n, c) => n + c.links.length, 0);
  const count = !categories ? "" : filtering ? s.countFiltered(shownLinks, allLinks.length) : s.count(allLinks.length);
  const clearFilters = () => {
    changeQuery("");
    setStateParam("");
    void focusById(FILTER_ID);
  };

  return (
    <AdminShell section="links">
      {catalog.status === "error" ? (
        <LoadError attempt={catalog.attempt} message={s.loadError} pending={catalog.retrying} onRetry={catalog.retry} />
      ) : reordering && categories && !managed ? (
        <Reorder
          categories={categories}
          onOrder={(update) => catalog.setData(update)}
          onRefused={(err) => {
            void catalog.refresh();
            if (isManagedByFile(err)) onManaged();
          }}
          onDone={() => {
            setReordering(false);
            void focusById(REORDER_ID);
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
                    <Link id={NEW_ID} href={`${LIST}/new`} className={buttonVariants()} onClick={() => rememberRow(LIST, NEW_ID)}>
                      <Plus aria-hidden="true" />
                      {m.admin.add}
                    </Link>
                    <Button id={REORDER_ID} variant="outline" disabled={!categories || categories.length === 0} onClick={() => setReordering(true)}>
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
          {checks && checks.capacity !== null && checks.checked > checks.capacity && (
            <Alert variant="warning" className="mb-4">
              {s.checks.overloaded(checks.checked, checks.capacity)}
            </Alert>
          )}
          {catalog.refreshFailures > 0 && (
            <Alert key={catalog.refreshFailures} variant="warning" className="mb-4">
              {m.admin.refreshFailed}
            </Alert>
          )}
          {stateFilter && (
            <p data-slot="state-filter" className="mb-4 flex flex-wrap items-center gap-x-3 text-sm">
              <span>
                {m.admin.filtered} {s.states[stateFilter]}
              </span>
              <button
                type="button"
                onClick={() => {
                  setStateParam("");
                  feedback.clearForFilter();
                }}
                className="inline-flex min-h-11 items-center underline decoration-link-decoration decoration-2 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              >
                {m.admin.attentionClear}
              </button>
            </p>
          )}
          {!categories ? (
            <div aria-hidden="true" className="appear-delayed h-64 rounded-(--radius-card) bg-muted motion-safe:animate-pulse" />
          ) : categories.length === 0 ? (
            <EmptyState title={s.emptyTitle}>{!managed && <p>{s.emptyBody}</p>}</EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState
              title={query.trim() ? m.admin.noMatch(query.trim()) : s.noneInState}
              actions={
                <Button variant="outline" onClick={clearFilters}>
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
                          className="outline-none hover:underline hover:decoration-link-decoration hover:decoration-2 hover:underline-offset-4 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                        >
                          {category.title}
                        </Link>
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {category.groups.length > 0 ? (
                          category.groups.map(groupRefLabel).join(", ")
                        ) : (
                          <StateMark tone="destructive">{s.states.noGroup}</StateMark>
                        )}
                      </p>
                    </div>
                    {category.links.length === 0 && feedback.tombstones.every((t) => t.section !== category.id) ? (
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

/** Page for an address whose item no longer exists. */
function Missing() {
  const m = useStrings();
  return (
    <AdminShell section="links" title={m.admin.errors.not_found} back={{ href: LIST, label: m.admin.backTo(m.links.title) }}>
      <p className="text-muted-foreground">{m.notFound.body}</p>
    </AdminShell>
  );
}

/** The YAML import and export, under Links. */
export function LinksFilePage() {
  const m = useStrings();
  return (
    <AdminShell section="links" title={m.links.fileTitle} back={{ href: listHref(LIST), label: m.admin.backTo(m.links.title) }}>
      <AdminCatalog />
    </AdminShell>
  );
}
