import { type ReactNode, useEffect, useRef } from "react";

import { useStrings } from "../i18n/LocaleProvider";
import { focusPage } from "../lib/focus";
import { PendingButton } from "./form/PendingButton";
import { Alert } from "./ui/alert";

type LoadErrorProps = {
  /** Changes on every failure, so the alert is announced again. */
  attempt: number;
  message: ReactNode;
  pending: boolean;
  onRetry: () => void;
};

/**
 * Render a load failure: an alert, then a Retry button that keeps the focus while it runs and on a new failure.
 * When a retry succeeds and this goes away, the focus moves to the page heading, unless the person has already
 * moved it elsewhere.
 */
export function LoadError({ attempt, message, pending, onRetry }: LoadErrorProps) {
  const m = useStrings();
  const retried = useRef({ value: false });
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const flag = retried.current;
    const node = container.current;
    return () => {
      if (!flag.value) return;
      // The focus falls to the body when the focused Retry button is removed.
      const active = document.activeElement;
      if (!active || active === document.body || node?.contains(active)) focusPage();
    };
  }, []);
  return (
    <div ref={container} data-slot="load-error" className="flex flex-col items-start gap-4">
      <Alert key={attempt} variant="destructive" className="w-full">
        {message}
      </Alert>
      <PendingButton
        variant="outline"
        pending={pending}
        pendingLabel={m.retrying}
        onClick={() => {
          retried.current.value = true;
          onRetry();
        }}
      >
        {m.retry}
      </PendingButton>
    </div>
  );
}
