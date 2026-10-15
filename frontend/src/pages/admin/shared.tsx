import { type ReactNode, useEffect, useRef, useState } from "react";

import { ApiError } from "../../api";
import { Button } from "../../components/ui/button";
import type { Messages } from "../../i18n/en";
import { errorMessage, fieldErrorMessage } from "../../i18n/errors";
import { useStrings } from "../../i18n/LocaleProvider";

export const selectClass =
  "mt-1.5 block w-full rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export type Notice = { text: string; tone: "info" | "error"; n: number };

/** Return the text for an error of the admin API: its own messages first, then field and generic ones. */
export function adminErrorText(err: unknown, m: Messages): string {
  if (!(err instanceof ApiError)) return errorMessage(err, m);
  const own = (m.admin.errors as Record<string, string>)[err.body.code];
  if (own) return own;
  const field = Object.values(err.body.fields ?? {})[0];
  return field ? fieldErrorMessage(field, m) : errorMessage(err, m);
}

/** Return the notice state and a setter that counts, so the same text is announced again. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const say = (text: string, tone: Notice["tone"] = "info") => setNotice((prev) => ({ text, tone, n: (prev?.n ?? 0) + 1 }));
  return [notice, say, () => setNotice(null)] as const;
}

/** Announce the result of the last action, and take the focus so keyboard users land on it. */
export function NoticeBox({ notice }: { notice: Notice | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  if (!notice) return null;
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role={notice.tone === "error" ? "alert" : "status"}
      className={`mt-4 rounded-md border p-3 text-sm outline-none ${notice.tone === "error" ? "border-destructive text-destructive" : "border-primary"}`}
    >
      {notice.text}
    </p>
  );
}

/** Show a temporary password once, with a button copying it, until the admin closes it. */
export function TemporaryPassword({ name, password, onDone }: { name: string; password: string; onDone: () => void }) {
  const m = useStrings();
  const a = m.admin;
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="temporary-password-title" className="mt-4 rounded-md border-2 border-primary p-4 outline-none">
      <h2 id="temporary-password-title" className="font-semibold">
        {a.temporaryPassword(name)}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{a.temporaryPasswordHint}</p>
      <p className="mt-3 font-mono text-lg break-all select-all">{password}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(password).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {a.copy}
        </Button>
        <Button type="button" onClick={onDone}>
          {a.done}
        </Button>
        <span role="status" className="text-sm">
          {copied ? a.copied : ""}
        </span>
      </div>
    </section>
  );
}

/** Ask to confirm a deletion in the page itself (no modal: Radix Dialog injects styles the CSP refuses). */
export function ConfirmDelete({ question, children, busy, onConfirm, onCancel }: {
  question: string;
  children?: ReactNode;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const m = useStrings();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-label={question} className="mt-3 rounded-md border-2 border-destructive p-3 text-sm outline-none">
      <p className="font-semibold">{question}</p>
      {children}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={busy} onClick={onConfirm} className="border-destructive text-destructive">
          {m.admin.confirmDelete}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.admin.cancel}
        </Button>
      </div>
    </div>
  );
}
