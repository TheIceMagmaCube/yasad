import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

import type { HistoryEntry, HistoryObject } from "../../../api";
import { Link } from "../../../components/Link";
import { useLocale, useStrings } from "../../../i18n/LocaleProvider";
import type { Messages } from "../../../i18n/en";
import { formatRelative } from "../../../lib/relative-time";
import { fieldLabel, fieldRows, type ImportSummary, importLines, listText, objectHref, objectLabel, valueText } from "./history-format";

const LINK =
  "inline-flex min-h-11 items-center underline decoration-link-decoration decoration-2 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden";

type HistoryTableProps = {
  /** Read by screen readers only: what the table lists. */
  caption: string;
  entries: HistoryEntry[];
  /** Show the Item column; an item page leaves it out, every entry being about that item. */
  showObject?: boolean;
  /** Prefix of the ids of the rows' buttons and details, unique on the page. */
  idPrefix: string;
  /**
   * Without the Item column, the id of the page's item: an entry that also names another object (the group of a
   * person's membership, the person of a group's) shows it under the action.
   */
  subjectId?: string;
};

/** Return the id of the disclosure button of an entry, to give it the focus. */
export const toggleId = (idPrefix: string, entry: HistoryEntry) => `${idPrefix}-${entry.id}-toggle`;

/**
 * Render entries of the change log as a table, newest first: when, who, action and, on the history page, the item.
 * Each row has a disclosure button that opens a row under it with the exact date and the fields that changed.
 * Below 36rem of table width, when and who go under the action, so the table never scrolls sideways.
 */
export function HistoryTable({ caption, entries, showObject = true, idPrefix, subjectId }: HistoryTableProps) {
  const m = useStrings();
  const h = m.history;
  const { language } = useLocale();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const columns = showObject ? 5 : 4;
  const wide = "hidden @min-[36rem]/history:table-cell";

  return (
    <div data-slot="history-table" className="@container/history">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-foreground/70">
            <th scope="col" className="w-12 py-2 pl-1">
              <span className="sr-only">{h.columns.details}</span>
            </th>
            <th scope="col" className={cn("px-3 py-2 font-normal whitespace-nowrap text-muted-foreground", wide)}>
              {h.columns.when}
            </th>
            <th scope="col" className={cn("px-3 py-2 font-normal text-muted-foreground", wide)}>
              {h.columns.who}
            </th>
            <th scope="col" className="px-3 py-2 font-normal text-muted-foreground">
              {h.columns.action}
            </th>
            {showObject && (
              <th scope="col" className="px-3 py-2 font-normal text-muted-foreground">
                {h.columns.object}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const expanded = open.has(entry.id);
            const detailsId = `${idPrefix}-${entry.id}-details`;
            const when = formatRelative(entry.at, language, m);
            const time = (
              <time dateTime={entry.at} title={when.exact ?? undefined}>
                {when.text}
              </time>
            );
            const action = h.actions[entry.action] ?? entry.action;
            const other = showObject ? null : entry.object.id !== subjectId && entry.object.type !== "catalog" ? entry.object : entry.related;
            return (
              <Fragment key={entry.id}>
                <tr
                  data-open={expanded ? "" : undefined}
                  className={cn("align-top data-open:shadow-[inset_4px_0_0_var(--selected)]", expanded ? "border-b border-border" : "border-b-[1.5px] border-border")}
                >
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      id={toggleId(idPrefix, entry)}
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      onClick={() => toggle(entry.id)}
                      className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                    >
                      <ChevronRight aria-hidden="true" className={cn("size-4 motion-safe:transition-transform", expanded && "rotate-90")} />
                      <span className="sr-only">{h.detailsOf(action, objectLabel(entry.object, m))}</span>
                    </button>
                  </td>
                  <td className={cn("px-3 py-3.5 whitespace-nowrap", wide)}>{time}</td>
                  <td className={cn("px-3 py-1 wrap-anywhere", wide)}>
                    <Actor entry={entry} m={m} />
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="font-medium">{action}</span>
                    {other && <ObjectRef object={other} m={m} />}
                    <span className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground @min-[36rem]/history:hidden">
                      {time}
                      <span aria-hidden="true">·</span>
                      <Actor entry={entry} m={m} plain />
                    </span>
                  </td>
                  {showObject && (
                    <td className="px-3 py-1 wrap-anywhere">
                      <ObjectRef object={entry.object} m={m} withType />
                    </td>
                  )}
                </tr>
                <tr id={detailsId} hidden={!expanded} data-slot="history-details" className="border-b-[1.5px] border-border shadow-[inset_4px_0_0_var(--selected)]">
                  <td colSpan={columns} className="px-4 pt-3 pb-5">
                    {expanded && <EntryDetails entry={entry} exact={when.exact} action={action} m={m} />}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Render who wrote an entry: a link to their page while they exist, "System" for YASAD itself. */
function Actor({ entry, m, plain = false }: { entry: HistoryEntry; m: Messages; plain?: boolean }) {
  const actor = entry.actor;
  if (!actor) return <span className={plain ? undefined : "inline-flex min-h-11 items-center"}>{m.history.system}</span>;
  const name = actor.name ?? actor.email ?? actor.id;
  if (plain || !actor.exists) {
    return (
      <span className={plain ? undefined : "inline-flex min-h-11 flex-wrap items-center gap-x-2"}>
        {name}
        {!actor.exists && <span className="text-muted-foreground">({m.history.deleted.user})</span>}
      </span>
    );
  }
  return (
    <Link href={`/admin/users/${encodeURIComponent(actor.id)}`} className={LINK}>
      {name}
    </Link>
  );
}

/** Render an object an entry names: a link to its page while it exists, else its label and that it was deleted. */
function ObjectRef({ object, m, withType = false }: { object: HistoryObject; m: Messages; withType?: boolean }) {
  const label = objectLabel(object, m);
  const href = objectHref(object);
  const deleted = !object.exists && object.type !== "catalog";
  return (
    <span className="flex flex-col">
      {href ? (
        <Link href={href} className={LINK}>
          {label}
        </Link>
      ) : (
        <span className={cn("inline-flex min-h-11 flex-wrap items-center gap-x-2", !withType && "min-h-0")}>
          {label}
          {deleted && <span className="text-muted-foreground">({m.history.deleted[object.type]})</span>}
        </span>
      )}
      {withType && object.type !== "catalog" && <span className="text-caption -mt-2 pb-2 text-muted-foreground">{m.history.types[object.type]}</span>}
    </span>
  );
}

/** Render the detail of an entry: exact date, author, origin, the person of a membership, then the fields. */
function EntryDetails({ entry, exact, action, m }: { entry: HistoryEntry; exact: string | null; action: string; m: Messages }) {
  const h = m.history;
  const source = entry.details?.source as keyof Messages["history"]["sources"] | undefined;
  const facts: [string, ReactNode][] = [[h.at, exact]];
  if (entry.actor?.email) facts.push([h.columns.who, `${entry.actor.name ?? ""} (${entry.actor.email})`]);
  if (source && h.sources[source]) facts.push([h.origin, h.sources[source]]);
  if (entry.related) facts.push([h.member, <ObjectRef key="related" object={entry.related} m={m} />]);
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="mb-2 wrap-anywhere sm:mb-0">{value}</dd>
          </div>
        ))}
      </dl>
      {entry.action === "import" ? <ImportDetails summary={(entry.details ?? {}) as ImportSummary} m={m} /> : <FieldTable entry={entry} action={action} m={m} />}
    </div>
  );
}

/** Render the fields of a change: Field, Before, After, limited to what changed; one value column for a creation or a deletion. */
function FieldTable({ entry, action, m }: { entry: HistoryEntry; action: string; m: Messages }) {
  const h = m.history;
  const { shape, rows } = fieldRows(entry);
  if (entry.action === "member_add" || entry.action === "member_remove") return null;
  if (rows.length === 0) return <p>{h.noFieldChange}</p>;
  const type = entry.object.type;
  return (
    <table className="w-full table-fixed border-collapse text-left text-sm">
      <caption className="sr-only">{h.changesCaption(action, objectLabel(entry.object, m))}</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="w-1/3 py-1.5 pr-3 font-normal text-muted-foreground">
            {h.field}
          </th>
          {shape !== "after" && (
            <th scope="col" className="py-1.5 pr-3 font-normal text-muted-foreground">
              {h.before}
            </th>
          )}
          {shape !== "before" && (
            <th scope="col" className="py-1.5 font-normal text-muted-foreground">
              {h.after}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field} className="border-b border-border/60 align-top last:border-b-0">
            <th scope="row" className="py-1.5 pr-3 font-medium wrap-anywhere">
              {fieldLabel(type, row.field, m)}
            </th>
            {shape !== "after" && <td className="py-1.5 pr-3 wrap-anywhere">{valueText(type, row.field, row.before, m)}</td>}
            {shape !== "before" && <td className="py-1.5 wrap-anywhere">{valueText(type, row.field, row.after, m)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Render the summary of an import: what it added, changed and deleted, the groups it created, and whether values were cut. */
function ImportDetails({ summary, m }: { summary: ImportSummary; m: Messages }) {
  const h = m.history;
  const lines = importLines(summary);
  const groups = summary.groupsCreated ?? [];
  return (
    <div className="flex flex-col gap-3">
      {lines.length === 0 && groups.length === 0 ? (
        <p>{h.import.nothing}</p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
          {lines.map((line) => (
            <div key={line.kind} className="contents">
              <dt className="text-muted-foreground">{h.import[line.kind]}</dt>
              <dd className="mb-2 flex flex-col gap-1 wrap-anywhere sm:mb-0">
                {line.categories.length > 0 && <p>{h.listOf(h.import.categories(line.categories.length), listText(line.categories, m))}</p>}
                {line.links.length > 0 && <p>{h.listOf(h.import.links(line.links.length), listText(line.links, m))}</p>}
              </dd>
            </div>
          ))}
          {groups.length > 0 && (
            <div className="contents">
              <dt className="text-muted-foreground">{h.import.groupsCreated}</dt>
              <dd className="wrap-anywhere">{valueText("catalog", "groups", groups, m)}</dd>
            </div>
          )}
        </dl>
      )}
      {summary.truncated && <p className="text-muted-foreground">{h.import.truncated}</p>}
    </div>
  );
}
