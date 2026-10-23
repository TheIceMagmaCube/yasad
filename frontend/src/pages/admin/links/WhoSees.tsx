import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { type AdminCategory, type AdminGroup, type AdminLink, type AdminUser, api, type Audience, type LinkExplanation } from "../../../api";
import { PaneSection, useQueryState } from "../../../components/admin/DetailPage";
import { StateMark } from "../../../components/admin/StateMark";
import { PendingButton } from "../../../components/form/PendingButton";
import { Link } from "../../../components/Link";
import { LoadError } from "../../../components/LoadError";
import { Alert } from "../../../components/ui/alert";
import { Label } from "../../../components/ui/label";
import { NativeSelect } from "../../../components/ui/native-select";
import { useStrings } from "../../../i18n/LocaleProvider";
import { type AdminCollection, useAdminCollection } from "../../../lib/admin-collection";
import { useAnnounce } from "../../../lib/announcer";
import { groupRefLabel, groupRefOf, parseGroupRef } from "../../../lib/group-ref";
import { type AccessFixes, AccessReasons, reasonLines } from "../AccessReasons";
import { groupHref } from "../people/hrefs";

const LINK_CLASS = "underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground";

/**
 * Load who sees an item, and read it again whenever `revision` changes: a save can change the groups or the state
 * the count follows.
 */
function useAudience(load: () => Promise<Audience>, revision: number): AdminCollection<Audience> {
  const audience = useAdminCollection(load);
  const { refresh } = audience;
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    void refresh();
  }, [revision, refresh]);
  return audience;
}

/** Render group references, each linked to the page of its group; a reference no group stands for stays text. */
function GroupLinks({ refs, groups }: { refs: string[]; groups: AdminGroup[] }) {
  const m = useStrings();
  if (refs.length === 0) return <p className="text-muted-foreground">{m.links.noGroups}</p>;
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-1">
      {refs.map((ref) => {
        const group = groups.find((g) => groupRefOf(g) === ref);
        const label = groupRefLabel(ref);
        return (
          <li key={ref} className="min-w-0 wrap-anywhere">
            {group ? (
              <Link href={groupHref(group.id)} className={LINK_CLASS}>
                {label}
              </Link>
            ) : (
              label
            )}
            <span className="text-muted-foreground"> · {m.groups.source[parseGroupRef(ref).source]}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Render one list of groups under its own heading (h3). */
function GroupList({ title, refs, groups }: { title: string; refs: string[]; groups: AdminGroup[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-heading font-bold wrap-anywhere">{title}</h3>
      <GroupLinks refs={refs} groups={groups} />
    </div>
  );
}

/**
 * Render how many people see the item and whether a visitor does, or why that could not be read. A read after a save
 * that fails keeps the old counts, so it says they may no longer match the item.
 */
function AudienceFacts({ audience, people, error }: { audience: AdminCollection<Audience>; people: (n: number) => string; error: string }) {
  const w = useStrings().access.who;
  if (audience.status === "error") return <LoadError attempt={audience.attempt} message={error} pending={audience.retrying} onRetry={audience.retry} />;
  // Keyed on the count, so each failed read is announced again.
  const stale = audience.refreshFailures > 0 && (
    <Alert key={audience.refreshFailures} variant="warning">
      {w.audienceStale}
    </Alert>
  );
  const data = audience.data;
  // The two lines keep their place while loading, so the section does not jump.
  return (
    <>
      {stale}
      <ul className="flex flex-col gap-1 tabular-nums" aria-busy={data ? undefined : true}>
        <li>{data ? people(data.people) : " "}</li>
        <li>{data ? (data.public ? w.public : w.notPublic) : " "}</li>
      </ul>
    </>
  );
}

/** Section of a category page: its groups, who sees at least one of its links, and whether a visitor does. */
export function CategoryWhoSees({ category, groups }: { category: AdminCategory; groups: AdminGroup[] }) {
  const w = useStrings().access.who;
  const audience = useAudience(() => api.categoryAccess(category.id), category.revision);
  return (
    <PaneSection title={w.category}>
      <GroupLinks refs={category.groups} groups={groups} />
      <p>{w.categoryRule}</p>
      <AudienceFacts audience={audience} people={w.categoryPeople} error={w.categoryAudienceError} />
    </PaneSection>
  );
}

type Result = { status: "ready"; userId: string; explanation: LinkExplanation } | { status: "error" } | { status: "choose" };

type LinkWhoSeesProps = {
  /** The link as stored, never the form being edited. */
  link: AdminLink;
  /** Its category as stored; undefined only while the catalog read lags behind a move. */
  category: AdminCategory | undefined;
  groups: AdminGroup[];
  people: AdminCollection<AdminUser[]>;
  /** Where the reasons that concern the link itself are fixed on its page. */
  fixes: Omit<AccessFixes, "category">;
  categoryHref: string;
};

/**
 * Section of a link page: the groups of the link and of its category, who sees it, and why one person does or does
 * not. The person chosen is kept in `?as=`; only the button sends the request, so going through the options with
 * the keyboard sends and announces nothing. Opened with `?as=`, the explanation is shown at once, unannounced: it is
 * part of the page that opened.
 */
export function LinkWhoSees({ link, category, groups, people, fixes, categoryHref }: LinkWhoSeesProps) {
  const m = useStrings();
  const w = m.access.who;
  const announce = useAnnounce();
  const selectId = useId();
  const resultId = useId();
  const [as, setAs] = useQueryState("as");
  const [chosen, setChosen] = useState(as);
  const [result, setResult] = useState<Result | null>(null);
  // Opened with ?as=, the explanation is on its way.
  const [pending, setPending] = useState(as !== "");
  const audience = useAudience(async () => (await api.linkAccess(link.id)).audience, link.revision);
  const latest = useRef(0);
  // The latest request, its answer shown or not, and whether that answer is still to be read out: a save reads the
  // explanation again for that person.
  const asked = useRef<{ userId: string; say: boolean } | null>(as ? { userId: as, say: false } : null);
  const list = people.data;
  const nameOf = (id: string) => list?.find((u) => u.id === id)?.name ?? id;
  const value = list?.some((u) => u.id === chosen) ? chosen : "";

  /**
   * Explain the link for `userId`; `say` reads the result out, for an explanation the button asked for. Whoever
   * shows the button pending sets it; this clears it once the latest request ends.
   */
  async function explain(userId: string, say: boolean) {
    const n = ++latest.current;
    asked.current = { userId, say };
    try {
      const answer = await api.linkAccess(link.id, userId);
      if (n !== latest.current) return;
      if (!answer.explanation) throw new Error("no explanation");
      const explanation = answer.explanation;
      setResult({ status: "ready", userId, explanation });
      if (say) {
        const verdict = explanation.visible ? w.sees(nameOf(userId)) : w.doesNotSee(nameOf(userId));
        announce([verdict, ...reasonLines(explanation, m).flatMap((l) => (l.hint ? [l.text, l.hint] : [l.text]))].join(" "));
      }
    } catch {
      if (n !== latest.current) return;
      setResult({ status: "error" });
      if (say) announce(w.explainError);
    } finally {
      if (n === latest.current) {
        setPending(false);
        asked.current = { userId, say: false };
      }
    }
  }

  // The effects below call the explain of the latest render, without running again when it changes.
  const explainNow = useRef(explain);
  useLayoutEffect(() => {
    explainNow.current = explain;
  });

  // Opened with ?as=, from a preview row: the explanation comes with the page.
  const opened = useRef(as);
  useEffect(() => {
    if (opened.current) void explainNow.current(opened.current, false);
  }, []);

  // A save changes what the explanation says: read it again for the person last asked for, silently as the page
  // announces the save, unless the answer it replaces was still to be read out.
  const seen = useRef(link.revision);
  useEffect(() => {
    if (seen.current === link.revision) return;
    seen.current = link.revision;
    if (asked.current) void explainNow.current(asked.current.userId, asked.current.say);
  }, [link.revision]);

  const onExplain = () => {
    if (!value) {
      latest.current++;
      asked.current = null;
      setAs("");
      setPending(false);
      setResult({ status: "choose" });
      announce(w.chooseFirst);
      return;
    }
    setAs(value);
    setPending(true);
    void explain(value, true);
  };

  return (
    <PaneSection title={w.link}>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <GroupList title={w.linkGroups} refs={link.groups} groups={groups} />
        {category && <GroupList title={w.categoryGroups(category.title)} refs={category.groups} groups={groups} />}
      </div>
      <p>{w.linkRule}</p>
      <AudienceFacts audience={audience} people={w.linkPeople} error={w.linkAudienceError} />
      <div className="mt-3 flex flex-col gap-3">
        <h3 className="font-heading font-bold">{w.why}</h3>
        {people.status === "error" ? (
          <LoadError attempt={people.attempt} message={w.peopleError} pending={people.retrying} onRetry={people.retry} />
        ) : !list ? (
          <p className="text-muted-foreground">{m.loading}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={selectId}>{w.person}</Label>
              <NativeSelect id={selectId} className="w-72 max-w-full" value={value} aria-describedby={result ? resultId : undefined} onChange={(e) => setChosen(e.target.value)}>
                <option value="">{w.choose}</option>
                {list.map((u) => (
                  <option key={u.id} value={u.id}>
                    {`${u.name} (${u.email})`}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <PendingButton type="button" variant="outline" pending={pending} pendingLabel={w.explaining} onClick={onExplain}>
              {w.explain}
            </PendingButton>
          </div>
        )}
        <div id={resultId} className="flex flex-col gap-2">
          {result?.status === "choose" && <p>{w.chooseFirst}</p>}
          {result?.status === "error" && <p className="text-destructive">{w.explainError}</p>}
          {result?.status === "ready" &&
            (result.explanation.visible ? (
              <p className="font-semibold wrap-anywhere">{w.sees(nameOf(result.userId))}</p>
            ) : (
              <>
                <StateMark tone="warning" className="text-base font-semibold wrap-anywhere">
                  {w.doesNotSee(nameOf(result.userId))}
                </StateMark>
                <AccessReasons link={result.explanation} fixes={{ ...fixes, category: categoryHref }} />
              </>
            ))}
        </div>
      </div>
    </PaneSection>
  );
}
