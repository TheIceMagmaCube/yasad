import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";

import { api, ApiError, type CatalogError, type CatalogImport, type CatalogWarning } from "../api";
import { Button, buttonVariants } from "../components/ui/button";
import { Label } from "../components/ui/label";
import type { Messages } from "../i18n/en";
import { errorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";

type State =
  | { name: "idle" }
  | { name: "preview"; yaml: string; result: CatalogImport; changed: boolean }
  | { name: "invalid"; errors: CatalogError[] }
  | { name: "message"; text: string; tone: "info" | "error" };

const isEmpty = ({ diff }: CatalogImport) =>
  [diff.added, diff.updated, diff.removed].every((part) => part.categories.length === 0 && part.links.length === 0);

/** Return the text of a catalog error, falling back to a generic one for a code this version does not know. */
function errorText(error: CatalogError, s: Messages["catalog"]): string {
  const message = (s.errors as Record<string, (p: CatalogError["params"]) => string>)[error.code] ?? s.errors.invalid;
  return message(error.params ?? {});
}

/** Return the text of a preview warning. */
function warningText(warning: CatalogWarning, s: Messages["catalog"]): string {
  return warning.code === "no_group" ? s.noGroup(warning.kind, warning.id) : s.groupsDifferByCase(warning.groups);
}

function Ids({ label, ids }: { label: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold">{label}</span> {ids.join(", ")}
    </p>
  );
}

/** Admin page: preview then import a catalog file, or export the current catalog. */
export function AdminCatalog() {
  const m = useStrings();
  const s = m.catalog;
  const [state, setState] = useState<State>({ name: "idle" });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (state.name !== "idle") resultRef.current?.focus();
  }, [state]);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.body.code === "invalid_catalog") setState({ name: "invalid", errors: err.body.errors ?? [] });
    else if (err instanceof ApiError && err.body.code === "catalog_managed_by_file") setState({ name: "message", text: s.managedByFile, tone: "error" });
    else setState({ name: "message", text: errorMessage(err, m), tone: "error" });
  };

  async function preview(yaml: string, changed = false) {
    setBusy(true);
    try {
      setState({ name: "preview", yaml, result: await api.previewCatalog(yaml), changed });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    // Cleared so that choosing the same file again, once fixed, fires a new change event.
    e.target.value = "";
    await preview(text);
  }

  async function apply(yaml: string, baseVersion: string) {
    setBusy(true);
    try {
      await api.applyCatalog(yaml, baseVersion);
      setState({ name: "message", text: s.applied, tone: "info" });
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "catalog_changed") await preview(yaml, true);
      else fail(err);
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setState({ name: "idle" });
    fileRef.current?.focus();
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold">{s.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{s.intro}</p>

      <a href="/api/admin/catalog" download="catalog.yaml" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
        {s.export}
      </a>

      <div className="mt-8">
        <Label htmlFor={`${id}-file`}>{s.file}</Label>
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept=".yaml,.yml,application/yaml,text/yaml"
          aria-describedby={`${id}-hint`}
          disabled={busy}
          onChange={(e) => void choose(e)}
          className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground"
        />
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {s.fileHint}
        </p>
      </div>

      <div ref={resultRef} tabIndex={-1} className="mt-6 outline-none" aria-live="polite">
        {state.name === "message" && (
          <p role={state.tone === "error" ? "alert" : "status"} className={`rounded-md border p-3 text-sm ${state.tone === "error" ? "border-destructive text-destructive" : "border-primary"}`}>
            {state.text}
          </p>
        )}

        {state.name === "invalid" && (
          <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
            <p>{s.invalid}</p>
            <ul className="mt-2 list-disc pl-5">
              {state.errors.map((e, i) => (
                <li key={i}>
                  {e.path && <code className="font-mono">{e.path}</code>}
                  {e.path && ": "}
                  {errorText(e, s)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.name === "preview" && (
          <section aria-labelledby={`${id}-preview`} className="rounded-md border p-4">
            <h2 id={`${id}-preview`} className="sr-only">
              {s.title}
            </h2>
            {state.changed && <p className="mb-3 text-sm font-semibold">{s.changed}</p>}
            {isEmpty(state.result) ? (
              <p className="text-sm">{s.noChange}</p>
            ) : (
              <div className="space-y-3">
                {(["added", "updated", "removed"] as const).map((kind) => {
                  const part = state.result.diff[kind];
                  if (part.categories.length + part.links.length === 0) return null;
                  return (
                    <div key={kind} className={kind === "removed" ? "rounded-md border-2 border-destructive p-3" : ""}>
                      <h3 className="font-semibold">{s[kind]}</h3>
                      <Ids label={s.categories} ids={part.categories} />
                      <Ids label={s.links} ids={part.links} />
                    </div>
                  );
                })}
                <Ids label={s.groupsCreated} ids={state.result.diff.groupsCreated} />
                {state.result.diff.warnings.length > 0 && (
                  <div>
                    <h3 className="font-semibold">{s.warnings}</h3>
                    <ul className="list-disc pl-5 text-sm">
                      {state.result.diff.warnings.map((w, i) => (
                        <li key={i}>{warningText(w, s)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {state.result.diff.removed.categories.length + state.result.diff.removed.links.length > 0 && (
                  <p className="text-sm font-semibold text-destructive">
                    {s.removalNotice(state.result.diff.removed.categories.length + state.result.diff.removed.links.length)}
                  </p>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-3">
              {!isEmpty(state.result) && (
                <Button type="button" disabled={busy} onClick={() => void apply(state.yaml, state.result.baseVersion)}>
                  {s.apply}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={reset}>
                {s.cancel}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
