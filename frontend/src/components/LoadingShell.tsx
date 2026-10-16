import { useStrings } from "../i18n/LocaleProvider";
import { useAnnounceAfter } from "../lib/announcer";
import { useDocumentTitle } from "../lib/page";
import { AppShell } from "./AppShell";
import { PageSkeleton } from "./PageSkeleton";

/** Delay before the loading shell shows and says so: a quick start stays silent and blank. */
const LOADING_DELAY = 300;

/** Render the screen shown while the app finds out who is there: the brand alone and a page placeholder. */
export function LoadingShell() {
  const m = useStrings();
  useDocumentTitle(m.loading);
  useAnnounceAfter(true, m.loading, LOADING_DELAY);
  return (
    <div data-slot="loading-shell" className="appear-delayed">
      <AppShell user={null} path="/" minimal>
        <PageSkeleton />
      </AppShell>
    </div>
  );
}
