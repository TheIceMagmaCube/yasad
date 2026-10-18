import { Building2, CirclePlus, Download, PencilLine, Trash2, Users } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { api, ApiError, type CatalogDiff, type CatalogError, type CatalogImport, type CatalogWarning } from "../../api";
import { FormActions } from "../../components/form/FormLayout";
import { PendingButton } from "../../components/form/PendingButton";
import { Link } from "../../components/Link";
import { LoadError } from "../../components/LoadError";
import { Page } from "../../components/Page";
import { SectionHeader } from "../../components/SectionHeader";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { FileInput } from "../../components/ui/file-input";
import type { Messages } from "../../i18n/en";
import { useStrings } from "../../i18n/LocaleProvider";
import { useAdminCollection } from "../../lib/admin-collection";
import { claimFocus, focusById } from "../../lib/focus";
import { invalidateHome } from "../../lib/home-store";
import { AdminPageHeader } from "./AdminLayout";
import { adminErrorText } from "./shared";

const FILE_ID = "catalog-file";
const ACCEPT = ".yaml,.yml,application/yaml,text/yaml";

/** Where the import stands; `n` changes on each new result, so its heading or alert takes the focus again. */
type Step =
  | { name: "idle" }
  | { name: "invalid"; errors: CatalogError[]; n: number }
  | { name: "failed"; text: string; n: number }
  | { name: "preview"; yaml: string; result: CatalogImport; changed: boolean; n: number }
  | { name: "done"; diff: CatalogDiff; n: number };

type Kind = "added" | "updated" | "removed";
const KINDS = ["added", "updated", "removed"] as const satisfies readonly Kind[];

/** Return the value of an own key: an id such as "constructor" must not find what Object.prototype holds. */
const own = <T,>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

const sizeOf = (diff: CatalogDiff, kind: Kind) => diff[kind].categories.length + diff[kind].links.length;
const isEmpty = (diff: CatalogDiff) => KINDS.every((kind) => sizeOf(diff, kind) === 0);

/** Return the text of a catalog file error, falling back to a generic one for a code this version does not know. */
function errorText(error: CatalogError, s: Messages["catalog"]): string {
  const message = (s.errors as Record<string, (p: CatalogError["params"]) => string>)[error.code] ?? s.errors.invalid;
  return message(error.params ?? {});
}

/** Return the source and name of a group reference of the catalog file (`local:Staff`, `oidc:Devs`, `@everyone`). */
function parseRef(ref: string): { source: "local" | "oidc" | "system"; name: string } {
  if (ref.startsWith("@")) return { source: "system", name: ref };
  const at = ref.indexOf(":");
  return { source: ref.slice(0, at) === "oidc" ? "oidc" : "local", name: ref.slice(at + 1) };
}

/** Admin page: preview then import a catalog file, or export the current catalog. */
export function AdminCatalog() {
  const m = useStrings();
  const s = m.catalog;
  const state = useAdminCollection(api.catalogState);
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<{ text: string; n: number } | null>(null);
  const counter = useRef(0);
  const next = () => ++counter.current;

  /** Return the text of an import request error that is not about the file itself. */
  const requestErrorText = (err: unknown) =>
    err instanceof ApiError && err.body.code === "catalog_managed_by_file" ? s.managedByFile : adminErrorText(err, m);

  async function preview(yaml: string, changed = false) {
    try {
      setStep({ name: "preview", yaml, result: await api.previewCatalog(yaml), changed, n: next() });
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "invalid_catalog") setStep({ name: "invalid", errors: err.body.errors ?? [], n: next() });
      else setStep({ name: "failed", text: requestErrorText(err), n: next() });
    }
  }

  async function choose(file: File) {
    setFileName(file.name);
    setApplyError(null);
    setChecking(true);
    try {
      await preview(await file.text());
    } finally {
      setChecking(false);
    }
  }

  async function apply(yaml: string, baseVersion: string) {
    setApplying(true);
    setApplyError(null);
    try {
      const result = await api.applyCatalog(yaml, baseVersion);
      invalidateHome();
      setStep({ name: "done", diff: result.diff, n: next() });
      void state.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "catalog_changed") await preview(yaml, true);
      else setApplyError((prev) => ({ text: requestErrorText(err), n: (prev?.n ?? 0) + 1 }));
    } finally {
      setApplying(false);
    }
  }

  /** Go back to choosing a file, with the focus on the file input. */
  const restart = () => {
    setStep({ name: "idle" });
    setFileName(null);
    setApplyError(null);
    void focusById(FILE_ID);
  };

  const catalog = state.data;
  return (
    <Page width="reading">
      <AdminPageHeader tab="catalog" description={catalog ? s.summary(catalog.categories, catalog.links, catalog.groups) : undefined} />
      {state.status === "error" && <LoadError attempt={state.attempt} message={s.loadError} pending={state.retrying} onRetry={state.retry} />}
      {state.status === "loading" && <div aria-hidden="true" data-slot="catalog-skeleton" className="appear-delayed h-24 rounded-[var(--radius-card)] bg-muted motion-safe:animate-pulse" />}
      {catalog && (
        <div className="flex flex-col gap-10">
          <section aria-labelledby="catalog-import" className="flex flex-col gap-4">
            <SectionHeader id="catalog-import" title={s.importTitle} className="mb-0" />
            {catalog.managedByFile ? (
              <Alert variant="info" title={s.managedByFileTitle}>
                {s.managedByFile}
              </Alert>
            ) : (
              <>
                <p id="catalog-file-hint" className="text-sm text-muted-foreground">
                  {s.importHelp}
                </p>
                <FileInput
                  id={FILE_ID}
                  label={s.chooseFile}
                  fileName={fileName}
                  pending={checking}
                  pendingLabel={s.checking}
                  accept={ACCEPT}
                  aria-describedby="catalog-file-hint"
                  onFile={(file) => void choose(file)}
                />
                {step.name === "invalid" && (
                  <div className="flex flex-col items-start gap-3">
                    <Alert key={step.n} variant="destructive" autoFocus title={s.invalidTitle} className="w-full">
                      <ul className="list-disc space-y-1 pl-5">
                        {step.errors.map((e, i) => (
                          <li key={i}>
                            {e.path && <code className="font-mono">{e.path}</code>}
                            {e.path && ": "}
                            {errorText(e, s)}
                          </li>
                        ))}
                      </ul>
                    </Alert>
                    <Button variant="outline" onClick={restart}>
                      {s.chooseAnother}
                    </Button>
                  </div>
                )}
                {step.name === "failed" && (
                  <Alert key={step.n} variant="destructive" autoFocus>
                    {step.text}
                  </Alert>
                )}
                {step.name === "preview" && (
                  <Preview
                    key={step.n}
                    result={step.result}
                    changed={step.changed}
                    applying={applying}
                    error={applyError}
                    onApply={() => void apply(step.yaml, step.result.baseVersion)}
                    onCancel={restart}
                  />
                )}
                {step.name === "done" && <Result key={step.n} diff={step.diff} onAnother={restart} />}
              </>
            )}
          </section>
          <ExportSection />
        </div>
      )}
    </Page>
  );
}

/** Render a section heading (h2) that takes the focus when it appears, unless `focus` is false. */
function FocusedHeading({ id, focus = true, children }: { id: string; focus?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.focus();
    claimFocus();
    // Only when it appears: the preview gets a new key for each new result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <h2 ref={ref} id={id} tabIndex={-1} className="text-section outline-none">
      {children}
    </h2>
  );
}

type PreviewProps = {
  result: CatalogImport;
  changed: boolean;
  applying: boolean;
  error: { text: string; n: number } | null;
  onApply: () => void;
  onCancel: () => void;
};

/**
 * Show what importing the file changes, by kind of change, categories by title with their links nested under
 * them and the ids beside, then the groups to create and the warnings. With deletions, the import button says
 * how many items go: the preview listing them is the confirmation.
 */
function Preview({ result, changed, applying, error, onApply, onCancel }: PreviewProps) {
  const m = useStrings();
  const s = m.catalog;
  const { diff } = result;
  const removed = sizeOf(diff, "removed");
  const created = diff.groupsCreated.map(parseRef);
  return (
    <section aria-labelledby="catalog-preview" data-slot="catalog-preview" className="panel flex flex-col gap-4 p-4 sm:p-6">
      <FocusedHeading id="catalog-preview" focus={!changed}>
        {s.previewTitle}
      </FocusedHeading>
      {changed && (
        <Alert variant="warning" autoFocus>
          {s.changed}
        </Alert>
      )}
      {isEmpty(diff) ? (
        <>
          <p>{s.noChange}</p>
          <div>
            <Button variant="outline" onClick={onCancel}>
              {s.chooseAnother}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>{s.previewSummary(sizeOf(diff, "added"), sizeOf(diff, "updated"), removed)}</p>
          {KINDS.map((kind) => sizeOf(diff, kind) > 0 && <ChangeBlock key={kind} kind={kind} diff={diff} />)}
          {created.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-heading font-bold">{s.groupsToCreate}</h3>
              <ul className="flex flex-wrap gap-2">
                {created.map((g) => (
                  <li key={`${g.source}:${g.name}`}>
                    <GroupBadge source={g.source} name={g.name} />
                  </li>
                ))}
              </ul>
              {(["local", "oidc"] as const).map(
                (source) =>
                  created.some((g) => g.source === source) && (
                    <p key={source} className="text-sm text-muted-foreground">
                      {s.groupHelp[source]}
                    </p>
                  ),
              )}
            </div>
          )}
          {diff.warnings.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-heading font-bold">{s.warnings}</h3>
              <ul className="list-disc space-y-2 pl-5 text-sm">
                {diff.warnings.map((w, i) => (
                  <li key={i}>
                    <WarningText warning={w} diff={diff} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <Alert key={error.n} variant="destructive" autoFocus>
              {error.text}
            </Alert>
          )}
          <FormActions>
            <PendingButton variant={removed > 0 ? "destructive" : "default"} pending={applying} pendingLabel={s.importing} onClick={onApply}>
              {removed > 0 ? s.applyAndDelete(removed) : s.apply}
            </PendingButton>
            <Button variant="outline" onClick={onCancel}>
              {s.cancel}
            </Button>
          </FormActions>
        </>
      )}
    </section>
  );
}

const KIND_ICONS = { added: CirclePlus, updated: PencilLine, removed: Trash2 } as const;

/** List the categories and links of one kind of change, each link under the title of its category. */
function ChangeBlock({ kind, diff }: { kind: Kind; diff: CatalogDiff }) {
  const m = useStrings();
  const s = m.catalog;
  const Icon = KIND_ICONS[kind];
  const { labels } = diff;
  const listed = new Set(diff[kind].categories);
  // Changed categories first, in file order, then the unchanged ones holding a changed link.
  const order = [...diff[kind].categories];
  const linksOf = new Map<string, string[]>();
  for (const id of diff[kind].links) {
    const categoryId = own(labels.links, id)?.categoryId ?? "";
    if (!linksOf.has(categoryId)) linksOf.set(categoryId, []);
    linksOf.get(categoryId)!.push(id);
    if (!order.includes(categoryId)) order.push(categoryId);
  }
  const suffix = kind === "removed" ? <span className="sr-only">, {s.removedSuffix}</span> : null;
  return (
    <div className={kind === "removed" ? "flex flex-col gap-2 rounded-lg border-[1.5px] border-destructive bg-destructive-surface p-4" : "flex flex-col gap-2 rounded-lg border-[1.5px] p-4"}>
      <h3 className="flex items-center gap-2 font-heading font-bold">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {s[kind]}
      </h3>
      <ul className="flex flex-col gap-2 text-sm">
        {order.map((categoryId) => (
          <li key={categoryId}>
            {listed.has(categoryId) ? (
              <p className="wrap-anywhere">
                <span className="font-semibold">{own(labels.categories, categoryId) ?? categoryId}</span> <Id value={categoryId} />
                {suffix}
              </p>
            ) : (
              <p className="wrap-anywhere text-muted-foreground">{s.inCategory(own(labels.categories, categoryId) ?? categoryId)}</p>
            )}
            {linksOf.has(categoryId) && (
              <ul className="mt-1 ml-1 flex flex-col gap-1 border-l border-border pl-3">
                {linksOf.get(categoryId)!.map((id) => (
                  <li key={id} className="wrap-anywhere">
                    {own(labels.links, id)?.title ?? id} <Id value={id} />
                    {suffix}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Render a catalog id beside its title, in the muted monospace the admins write it in. */
function Id({ value }: { value: string }) {
  return <code className="font-mono text-xs text-muted-foreground">{value}</code>;
}

/** Render a group with its source badge. */
function GroupBadge({ source, name }: { source: "local" | "oidc" | "system"; name: string }) {
  const m = useStrings();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">
        {source === "oidc" ? <Building2 aria-hidden="true" /> : <Users aria-hidden="true" />}
        {m.groups.source[source]}
      </Badge>
      <span className="text-sm font-semibold wrap-anywhere">{name}</span>
    </span>
  );
}

/** Render a preview warning, citing titles rather than ids. */
function WarningText({ warning, diff }: { warning: CatalogWarning; diff: CatalogDiff }) {
  const m = useStrings();
  const s = m.catalog;
  const { labels } = diff;
  switch (warning.code) {
    case "no_group":
      return <>{s.noGroup(warning.kind, warning.kind === "category" ? (own(labels.categories, warning.id) ?? warning.id) : (own(labels.links, warning.id)?.title ?? warning.id))}</>;
    case "unknown_icon":
      return <>{s.unknownIcon(own(labels.links, warning.id)?.title ?? warning.id)}</>;
    case "groups_differ_by_case":
      return (
        <div className="flex flex-col gap-1.5">
          <p>{s.groupsDifferByCase}</p>
          <ul className="flex flex-wrap gap-3">
            {warning.groups.map((ref) => {
              const g = parseRef(ref);
              return (
                <li key={ref}>
                  <GroupBadge source={g.source} name={g.name} />
                </li>
              );
            })}
          </ul>
        </div>
      );
  }
}

/** Show the outcome of an import, focused: counts, local groups to fill, and a way to import another file. */
function Result({ diff, onAnother }: { diff: CatalogDiff; onAnother: () => void }) {
  const m = useStrings();
  const s = m.catalog;
  const local = diff.groupsCreated.map(parseRef).filter((g) => g.source === "local");
  return (
    <section aria-labelledby="catalog-result" data-slot="catalog-result" className="panel flex flex-col items-start gap-3 p-4 sm:p-6">
      <FocusedHeading id="catalog-result">{s.resultTitle}</FocusedHeading>
      <p>{s.resultSummary(sizeOf(diff, "added"), sizeOf(diff, "updated"), sizeOf(diff, "removed"))}</p>
      {local.length > 0 && (
        <div className="flex flex-col gap-1">
          <p>
            {s.localGroupsCreated} {local.map((g) => g.name).join(", ")}
          </p>
          <Link href="/admin/groups" className="font-semibold underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground">
            {s.goToGroups}
          </Link>
        </div>
      )}
      <Button variant="outline" onClick={onAnother}>
        {s.importAnother}
      </Button>
    </section>
  );
}

/** Download the current catalog as a file; a failure is shown, focused, and saves nothing. */
function ExportSection() {
  const m = useStrings();
  const s = m.catalog;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(0);

  async function download() {
    setPending(true);
    setError(0);
    try {
      const url = URL.createObjectURL(await api.exportCatalog());
      const a = document.createElement("a");
      a.href = url;
      a.download = "catalog.yaml";
      document.body.append(a);
      a.click();
      a.remove();
      // Kept a moment, so the browser has started the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError((n) => n + 1);
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="catalog-export" className="flex flex-col items-start gap-4">
      <SectionHeader id="catalog-export" title={s.exportTitle} description={s.exportHelp} className="mb-0" />
      <PendingButton variant="outline" pending={pending} pendingLabel={s.preparing} onClick={() => void download()}>
        <Download aria-hidden="true" />
        {s.export}
      </PendingButton>
      {error > 0 && (
        <Alert key={error} variant="destructive" autoFocus className="w-full">
          {s.exportFailed}
        </Alert>
      )}
    </section>
  );
}
