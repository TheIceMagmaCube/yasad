import { useEffect } from "react";

import type { HomeData, User } from "../api";
import { CategorySection } from "../components/home/CategorySection";
import { HomeEmptyState } from "../components/home/HomeEmptyState";
import { HomeSkeleton } from "../components/home/HomeSkeleton";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { errorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";
import { useDocumentTitle } from "../lib/page";
import { useHomeData } from "./home/useHomeData";

/**
 * Home page: the categories and links the person may see, in catalog order.
 *
 * `user` is null for an anonymous visitor, who gets the public links in `initial` (nothing is fetched then).
 * `onSessionEnded` runs when the API answers as if nobody were signed in while `user` is set.
 */
export function Home({ user, initial, onSessionEnded }: { user: User | null; initial?: HomeData; onSessionEnded?: () => void }) {
  const strings = useStrings();
  const m = strings.home;
  const title = user ? m.title : m.publicTitle;
  useDocumentTitle(title);
  const { state, retry, retrying } = useHomeData(initial);

  const ended = user !== null && state.status === "ready" && !state.data.signedIn;
  useEffect(() => {
    if (ended) onSessionEnded?.();
  }, [ended, onSessionEnded]);

  return (
    <>
      <PageHeader title={title} />
      {state.status === "loading" ? (
        <HomeSkeleton />
      ) : state.status === "error" ? (
        <div className="space-y-4">
          <Alert key={state.attempt} tone="destructive">
            {m.loadError} {errorMessage(state.error, strings)}
          </Alert>
          <Button variant="outline" pending={retrying} onClick={retry}>
            {m.retry}
          </Button>
        </div>
      ) : state.data.categories.length === 0 ? (
        <HomeEmptyState empty={state.data.empty} />
      ) : (
        <div className="space-y-10">
          {state.data.categories.map((category, index) => (
            <CategorySection key={category.id} category={category} index={index} />
          ))}
        </div>
      )}
    </>
  );
}
