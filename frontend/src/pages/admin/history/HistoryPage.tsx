import { type FormEvent, useEffect, useRef, useState } from "react";

import { ApiError, api, type HistoryActor, type HistoryEntry } from "../../../api";
import { AdminShell } from "../../../components/admin/AdminShell";
import { Field } from "../../../components/form/Field";
import { PendingButton } from "../../../components/form/PendingButton";
import { SelectField } from "../../../components/form/SelectField";
import { LoadError } from "../../../components/LoadError";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useNavigations } from "../../../lib/router";
import { filtersQuery, filtersSearch, HISTORY, HISTORY_TYPES, type HistoryFilters, NO_FILTERS, objectLabel, readFilters, sameFilters } from "./history-format";
import { HistoryTable, toggleId } from "./HistoryTable";

type Load =
  | { status: "loading" }
  | { status: "error"; attempt: number; invalid: boolean; retrying: boolean }
  | { status: "ready"; entries: HistoryEntry[]; next: number | null };

/**
 * Page of the change log: filters applied on submit and kept in the address, then the entries newest first, a page
 * at a time. Read only.
 */
export function HistoryPage() {
  const m = useStrings();
  const h = m.history;
  const [applied, setApplied] = useState<HistoryFilters>(() => readFilters(location.search));
  const [draft, setDraft] = useState<HistoryFilters>(applied);
  const [formError, setFormError] = useState("");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [more, setMore] = useState<{ pending: boolean; failed: boolean }>({ pending: false, failed: false });
  const [actors, setActors] = useState<HistoryActor[]>([]);
  // Only the latest request applies: a filter applied while a page loads drops that page.
  const latest = useRef(0);
  const focusAfter = useRef<string | null>(null);

  // A link to this page with other filters (the browser's Back, an item's "All the history") applies them.
  const navigations = useNavigations();
  const appliedRef = useRef(applied);
  useEffect(() => {
    appliedRef.current = applied;
  });
  useEffect(() => {
    const next = readFilters(location.search);
    if (sameFilters(next, appliedRef.current)) return;
    setApplied(next);
    setDraft(next);
    setLoad({ status: "loading" });
    setMore({ pending: false, failed: false });
  }, [navigations]);

  useEffect(() => {
    let live = true;
    api.historyActors().then(
      (list) => live && setActors(list),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const n = ++latest.current;
    api.history(filtersQuery(applied)).then(
      (page) => n === latest.current && setLoad({ status: "ready", entries: page.entries, next: page.next }),
      (err: unknown) =>
        n === latest.current &&
        setLoad((prev) => ({
          status: "error",
          attempt: (prev.status === "error" ? prev.attempt : 0) + 1,
          invalid: err instanceof ApiError && err.body.code === "invalid_input",
          retrying: false,
        })),
    );
  }, [applied, reload]);

  // The first entry of a page loaded with "More entries" takes the focus once it shows.
  useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  const apply = (next: HistoryFilters) => {
    setFormError("");
    setMore({ pending: false, failed: false });
    setDraft(next);
    // Emptied first, so the status region announces the new count even when it is the same.
    setLoad({ status: "loading" });
    if (!sameFilters(next, applied)) setApplied(next);
    else setReload((r) => r + 1);
    history.replaceState(history.state, "", HISTORY + filtersSearch(next));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.from && draft.to && draft.to < draft.from) {
      setFormError(h.datesReversed);
      document.getElementById("history-to")?.focus();
      return;
    }
    apply(draft);
  }

  async function loadMore() {
    if (load.status !== "ready" || load.next === null || more.pending) return;
    const n = latest.current;
    setMore({ pending: true, failed: false });
    try {
      const page = await api.history({ ...filtersQuery(applied), before: load.next });
      if (n !== latest.current) return;
      if (page.entries[0]) focusAfter.current = toggleId("history", page.entries[0]);
      setLoad({ status: "ready", entries: [...load.entries, ...page.entries], next: page.next });
      setMore({ pending: false, failed: false });
    } catch {
      if (n === latest.current) setMore({ pending: false, failed: true });
    }
  }

  const filtered = !sameFilters(applied, NO_FILTERS);
  const entries = load.status === "ready" ? load.entries : [];
  const knownActor = draft.actor === "" || draft.actor === "none" || actors.some((a) => a.id === draft.actor);
  const objectEntry = applied.object ? entries.find((e) => e.object.id === applied.object) : undefined;
  const objectName = applied.object
    ? (objectEntry ? objectLabel(objectEntry.object, m) : entries.find((e) => e.related?.id === applied.object)?.related?.label) ?? applied.object
    : "";

  return (
    <AdminShell section="history">
      <form aria-label={h.filters} noValidate onSubmit={submit} className="mb-6 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
          <SelectField id="history-actor" label={h.actor} value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })}>
            <option value="">{h.allActors}</option>
            <option value="none">{h.system}</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.exists ? a.name : `${a.name} (${h.deleted.user})`}
              </option>
            ))}
            {!knownActor && <option value={draft.actor}>{draft.actor}</option>}
          </SelectField>
          <SelectField id="history-type" label={h.type} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="">{h.allTypes}</option>
            {HISTORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {h.types[type]}
              </option>
            ))}
          </SelectField>
          <Field id="history-from" label={h.from} type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <Field
            id="history-to"
            label={h.to}
            type="date"
            value={draft.to}
            error={formError || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{h.apply}</Button>
            {filtered && (
              <Button type="button" variant="ghost" onClick={() => apply(NO_FILTERS)}>
                {h.clear}
              </Button>
            )}
          </div>
        </div>
        {applied.object && (
          <p className="flex flex-wrap items-center gap-x-3 text-sm">
            <span className="wrap-anywhere">{h.objectFilter(objectName)}</span>
            <Button
              type="button"
              variant="link"
              className="h-11 px-0"
              onClick={() => {
                apply({ ...applied, object: "" });
                // The button goes away with the filter: the focus stays in the form.
                document.getElementById("history-actor")?.focus();
              }}
            >
              {h.clearObject}
            </Button>
          </p>
        )}
      </form>

      <p role="status" className="text-caption mb-2 text-muted-foreground tabular-nums">
        {load.status === "ready" ? h.count(load.entries.length, load.next !== null) : ""}
      </p>

      {load.status === "error" && (
        <LoadError
          attempt={load.attempt}
          message={load.invalid ? h.invalidFilter : h.loadError}
          pending={load.retrying}
          onRetry={() => {
            if (load.invalid) apply(NO_FILTERS);
            else {
              setLoad({ ...load, retrying: true });
              setReload((r) => r + 1);
            }
          }}
        />
      )}
      {load.status === "ready" &&
        (entries.length === 0 ? (
          <p>{filtered ? h.noMatch : h.empty}</p>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <div className="w-full">
              <HistoryTable caption={h.caption} entries={entries} idPrefix="history" />
            </div>
            {more.failed && (
              <Alert variant="destructive" className="w-full">
                {h.moreError}
              </Alert>
            )}
            {load.next !== null && (
              <PendingButton variant="outline" pending={more.pending} pendingLabel={h.loadingMore} onClick={() => void loadMore()}>
                {h.more}
              </PendingButton>
            )}
          </div>
        ))}
    </AdminShell>
  );
}
