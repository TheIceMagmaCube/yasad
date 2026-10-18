import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { useStrings } from "../../i18n/LocaleProvider";
import { claimFocus } from "../../lib/focus";
import { PendingButton } from "../form/PendingButton";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";

type ConfirmPanelProps = {
  question: string;
  /** What the action does, under the question. */
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  /** `destructive` for a deletion, `default` for an action that loses no data (a password reset). */
  variant?: "destructive" | "default";
  /** Run the action; a rejection shows its error in the panel. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  /** Return the text of an error the action rejected with. */
  errorText: (err: unknown) => string;
};

/**
 * Ask to confirm an action in the page itself (no modal: Radix Dialog injects styles the CSP refuses). The panel
 * takes the focus; the confirm button comes first, then Cancel; Escape cancels.
 */
export function ConfirmPanel({ question, children, confirmLabel, pendingLabel, variant = "destructive", onConfirm, onCancel, errorText }: ConfirmPanelProps) {
  const m = useStrings();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    ref.current?.focus();
    claimFocus();
  }, []);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
    } catch (err) {
      setError((prev) => ({ text: errorText(err), n: (prev?.n ?? 0) + 1 }));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={`${id}-question`}
      aria-describedby={children ? `${id}-details` : undefined}
      tabIndex={-1}
      data-slot="confirm-panel"
      className="flex flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
    >
      <p id={`${id}-question`} className="font-semibold wrap-anywhere">
        {question}
      </p>
      {children && (
        <div id={`${id}-details`} className="flex flex-col gap-2 text-sm">
          {children}
        </div>
      )}
      {error && (
        <Alert key={error.n} variant="destructive" autoFocus>
          {error.text}
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <PendingButton variant={variant} pending={pending} pendingLabel={pendingLabel} onClick={() => void confirm()}>
          {confirmLabel}
        </PendingButton>
        <Button variant="outline" onClick={onCancel}>
          {m.admin.cancel}
        </Button>
      </div>
    </div>
  );
}
