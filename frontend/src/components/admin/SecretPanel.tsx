import { CircleCheck, Copy, KeyRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useStrings } from "../../i18n/LocaleProvider";
import { useAnnounce } from "../../lib/announcer";
import { claimFocus } from "../../lib/focus";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type SecretPanelProps = {
  /** Name of the person the temporary password is for. */
  name: string;
  password: string;
  /** Take the focus on mount; false when the person had moved on before the request ended. */
  autoFocus?: boolean;
  onDone: () => void;
};

/**
 * Show a temporary password once, in the person's row, until the admin says they have noted it. It takes the
 * focus unless told otherwise. Give it the key `${userId}:${password}`, so a new password starts over.
 *
 * Copy writes to the clipboard when the browser allows it; otherwise (plain HTTP on a local network, refused
 * permission) the text is selected for Ctrl+C, and a line says so.
 */
export function SecretPanel({ name, password, autoFocus = true, onDone }: SecretPanelProps) {
  const m = useStrings();
  const a = m.admin;
  const id = useId();
  const announce = useAnnounce();
  const ref = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "unavailable">("idle");
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
    claimFocus();
    // Only on mount: a later prop change must not pull the focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyPassword() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("No clipboard");
      await navigator.clipboard.writeText(password);
      setCopy("copied");
      announce(a.copied);
    } catch {
      setCopy("unavailable");
      input.current?.focus();
      input.current?.select();
    }
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      data-slot="secret-panel"
      className="panel flex max-w-xl flex-col gap-3 p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden"
    >
      <p id={`${id}-title`} className="flex items-center gap-3 font-heading text-base font-bold wrap-anywhere">
        <span aria-hidden="true" className="pixel-corners flex size-8 shrink-0 items-center justify-center bg-primary text-primary-foreground">
          <KeyRound className="size-4" />
        </span>
        {a.temporaryPassword(name)}
      </p>
      <p className="text-sm text-muted-foreground">{a.temporaryPasswordHint}</p>
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor={`${id}-value`}>{a.temporaryPasswordLabel}</Label>
        <Input
          ref={input}
          id={`${id}-value`}
          readOnly
          value={password}
          spellCheck={false}
          className="h-11 font-mono text-base tracking-wider md:text-base"
          aria-describedby={copy === "unavailable" ? `${id}-copy` : undefined}
        />
      </div>
      {copy === "unavailable" && (
        <p id={`${id}-copy`} className="text-sm">
          {a.copyUnavailable}
        </p>
      )}
      {copy === "copied" && (
        <p className="flex items-center gap-1.5 text-sm">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
          {a.copied}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => void copyPassword()}>
          <Copy aria-hidden="true" />
          {a.copy}
        </Button>
        <Button onClick={onDone}>{a.noted}</Button>
      </div>
    </section>
  );
}
