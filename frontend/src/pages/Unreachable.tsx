import { useState } from "react";

import { AuthLayout } from "../components/AuthLayout";
import { PendingButton } from "../components/form/PendingButton";
import { useStrings } from "../i18n/LocaleProvider";
import { useDocumentTitle } from "../lib/page";

/**
 * Screen shown when the API does not answer. `onRetry` reloads the app and resolves to whether the server is
 * still unreachable; on a new failure an alert says so and the focus stays on the button.
 */
export function Unreachable({ onRetry }: { onRetry: () => Promise<boolean> }) {
  const m = useStrings();
  const s = m.unreachable;
  useDocumentTitle(s.title);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState(0);

  async function retry() {
    setPending(true);
    try {
      if (await onRetry()) setFailures((n) => n + 1);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      <h1 tabIndex={-1} className="text-title outline-none">
        {s.title}
      </h1>
      <p className="mt-3">{s.body}</p>
      {failures > 0 && (
        <p key={failures} role="alert" className="mt-4 text-sm font-semibold text-destructive">
          {s.still}
        </p>
      )}
      <PendingButton className="mt-6 w-full" pending={pending} pendingLabel={m.retrying} onClick={() => void retry()}>
        {m.retry}
      </PendingButton>
    </AuthLayout>
  );
}
