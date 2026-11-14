import { type AdminGroup, type AdminUser, api, type GroupSource, type LinkExplanation } from "../../../api";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminTable, type Column, RowLink } from "../../../components/admin/AdminTable";
import { PaneSection, useQueryState, useRestoreRow } from "../../../components/admin/DetailPage";
import { StateMark } from "../../../components/admin/StateMark";
import { HomeEmptyState } from "../../../components/home/HomeEmptyState";
import { Link } from "../../../components/Link";
import { LoadError } from "../../../components/LoadError";
import { Alert } from "../../../components/ui/alert";
import { NativeSelect } from "../../../components/ui/native-select";
import { useLocale, useStrings } from "../../../i18n/LocaleProvider";
import { useAdminCollection } from "../../../lib/admin-collection";
import { useDebouncedStatus } from "../../../lib/announcer";
import { formatRelative } from "../../../lib/relative-time";
import { AccessReasons } from "../AccessReasons";
import { HomePreview, PreviewSkeleton } from "../HomePreview";
import { linkFromPreviewHref } from "../links/item-edit";
import { groupHref, personHref, previewHref } from "./hrefs";

type HeldGroup = { id: string | null; name: string; source: GroupSource };
type StateFilter = "hidden" | "visible";

const STATE_ID = "access-state";
const rowIdOf = (id: string) => `access-${id}-link`;

/**
 * Return the groups a person holds: `@everyone` and `@authenticated`, which every signed-in person holds without a
 * `user_group` row, then their own groups by name.
 */
function heldGroups(user: AdminUser, groups: AdminGroup[]): HeldGroup[] {
  const system = ["everyone", "authenticated"].map((name) => ({
    id: groups.find((g) => g.source === "system" && g.name === name)?.id ?? null,
    name,
    source: "system" as const,
  }));
  const own = [...user.groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.source.localeCompare(b.source));
  return [...system, ...own];
}

/**
 * Read-only preview of a person's home page, built from the admin API and never from a session: the administrator
 * stays signed in as themselves. Under the banners, the groups they hold, their home page as they get it, and every
 * link of the catalog with why they do not see it. Nothing here writes, and nothing goes in the home store.
 */
export function PersonPreview({ user, groups }: { user: AdminUser; groups: AdminGroup[] }) {
  const m = useStrings();
  const a = m.access;
  const { language } = useLocale();
  const home = useAdminCollection(() => api.previewHome(user.id));
  const links = useAdminCollection(() => api.accessLinks(user.id));
  const base = previewHref(user.id);
  const [stateParam, setStateParam] = useQueryState("state");
  const state: StateFilter = stateParam === "visible" ? "visible" : "hidden";
  const all = links.data;
  const shown = (all ?? []).filter((l) => l.visible === (state === "visible"));
  const count = all ? a.count(state, shown.length, all.length) : "";
  useDebouncedStatus(state, count);
  useRestoreRow(base, all !== null);
  const readAt = formatRelative(user.lastSignInAt, language, m).exact;

  const columns: Column<LinkExplanation>[] = [
    {
      id: "link",
      header: a.columns.link,
      sortValue: (l) => l.title,
      cell: (l) => (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="wrap-anywhere">
            <RowLink id={rowIdOf(l.id)} href={linkFromPreviewHref(l.id, user.id)} listBase={base}>
              {l.title}
            </RowLink>
          </span>
          <span className="text-[0.8125rem] text-muted-foreground @min-[40rem]/table:hidden">{l.categoryTitle}</span>
          <div className="mt-1 @min-[48rem]/table:hidden">
            <AccessReasons link={l} />
          </div>
        </div>
      ),
      className: "w-full max-w-0 @min-[48rem]/table:w-56 @min-[48rem]/table:max-w-none",
    },
    {
      id: "category",
      header: a.columns.category,
      sortValue: (l) => l.categoryTitle,
      cell: (l) => <span className="wrap-anywhere">{l.categoryTitle}</span>,
      className: "hidden @min-[40rem]/table:table-cell",
    },
    {
      id: "state",
      header: a.columns.state,
      cell: (l) => (l.visible ? <span>{a.states.visible}</span> : <StateMark tone="warning">{a.states.hidden}</StateMark>),
      className: "whitespace-nowrap",
    },
    {
      id: "reasons",
      header: a.columns.reasons,
      cell: (l) => <AccessReasons link={l} />,
      className: "hidden @min-[48rem]/table:table-cell",
    },
  ];

  return (
    <AdminShell section="users" title={a.title(user.name)} back={{ href: personHref(user.id), label: m.admin.backTo(user.name) }}>
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <Alert variant="info" role="note">
            {a.banner}
          </Alert>
          {user.disabled && (
            <Alert variant="warning" role="note">
              {a.disabled}
            </Alert>
          )}
          {user.mustChangePassword && (
            <Alert variant="warning" role="note">
              {a.temporary}
            </Alert>
          )}
          {user.origin === "oidc" && (
            <Alert variant="info" role="note">
              {readAt ? a.providerReadAt(readAt) : a.providerNever}
            </Alert>
          )}
        </div>

        <PaneSection title={a.groups}>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {heldGroups(user, groups).map((g) => {
              const name = g.source === "system" ? `@${g.name}` : g.name;
              return (
                <li key={`${g.source}:${g.name}`} className="min-w-0 wrap-anywhere">
                  {g.id ? (
                    <Link href={groupHref(g.id)} className="underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                  <span className="text-muted-foreground"> · {m.groups.source[g.source]}</span>
                </li>
              );
            })}
          </ul>
        </PaneSection>

        <HomePreview
          home={home}
          label={a.region(user.name)}
          pinsLabel={a.pinsOf(user.name)}
          empty={<HomeEmptyState empty={home.data?.empty ?? null} titleAs="h3" ownGroups={false} />}
        />

        <PaneSection title={a.links}>
          {links.status === "error" ? (
            <LoadError attempt={links.attempt} message={a.linksLoadError} pending={links.retrying} onRetry={links.retry} />
          ) : !all ? (
            <PreviewSkeleton />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <label htmlFor={STATE_ID} className="text-sm font-semibold">
                    {a.show}
                  </label>
                  <NativeSelect id={STATE_ID} className="w-48" value={state} onChange={(e) => setStateParam(e.target.value === "visible" ? "visible" : "")}>
                    <option value="hidden">{a.filters.hidden}</option>
                    <option value="visible">{a.filters.visible}</option>
                  </NativeSelect>
                </div>
                <p className="text-caption text-muted-foreground tabular-nums">{count}</p>
              </div>
              {shown.length === 0 ? (
                <p className="py-4 text-muted-foreground">{all.length === 0 ? a.emptyCatalog : state === "hidden" ? a.noneHidden : a.noneVisible}</p>
              ) : (
                <AdminTable caption={a.linksCaption(user.name)} columns={columns} sections={[{ id: "all", rows: shown }]} />
              )}
            </>
          )}
        </PaneSection>
      </div>
    </AdminShell>
  );
}
