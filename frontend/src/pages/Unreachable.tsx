import { useState } from "react";

import { AuthLayout } from "../components/AuthLayout";
import { PendingButton } from "../components/form/PendingButton";
import { Alert } from "../components/ui/alert";
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
        <Alert key={failures} variant="destructive" className="mt-5">
          {s.still}
        </Alert>
      )}
      <PendingButton className="mt-6 min-h-11 w-full" pending={pending} pendingLabel={m.retrying} onClick={() => void retry()}>
        {m.retry}
      </PendingButton>
    </AuthLayout>
  );
}
