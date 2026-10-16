import { createContext, useContext, useEffect } from "react";

import { useStrings } from "../i18n/LocaleProvider";
import { useAnnounce } from "../lib/announcer";
import { focusPage } from "../lib/focus";
import { Link } from "./Link";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

/** A message carried from one view to the next (the session ended, for instance). */
export type Notice = { kind: "sessionExpired" };

type ShellNoticeValue = { notice: Notice | null; onDismiss: () => void };

const ShellNoticeContext = createContext<ShellNoticeValue>({ notice: null, onDismiss: () => {} });

export const ShellNoticeProvider = ShellNoticeContext;

/**
 * Render the notice of the app shell, if any, under the page header: a visible message with a Close button. Its
 * text is announced once the view has placed the focus.
 */
export function ShellNotice() {
  const { notice, onDismiss } = useContext(ShellNoticeContext);
  return notice ? <NoticeAlert notice={notice} onDismiss={onDismiss} /> : null;
}

function NoticeAlert({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const m = useStrings();
  const announce = useAnnounce();
  const text = m.signIn.expired;
  useEffect(() => {
    // After the focus effects of this commit, so the focus move does not cut the announcement.
    const timer = setTimeout(() => announce(text), 0);
    return () => clearTimeout(timer);
  }, [text, announce]);
  return (
    <Alert variant="warning" role="note" data-slot="shell-notice" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p>
          {text}{" "}
          {notice.kind === "sessionExpired" && (
            <Link href="/sign-in" className="font-semibold underline underline-offset-4 hover:no-underline">
              {m.signIn.title}
            </Link>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onDismiss();
            focusPage();
          }}
        >
          {m.forms.close}
        </Button>
      </div>
    </Alert>
  );
}
