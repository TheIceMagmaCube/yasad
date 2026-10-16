import { useEffect, useRef, useState } from "react";

import type { User } from "../api";
import { CategorySection } from "../components/home/CategorySection";
import { HomeEmptyState } from "../components/home/HomeEmptyState";
import { HomeSkeleton } from "../components/home/HomeSkeleton";
import { PageHeader } from "../components/PageHeader";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { errorMessage } from "../i18n/errors";
import { useStrings } from "../i18n/LocaleProvider";
import { homeKey, type HomeState, loadHome, useHomeEntry } from "../lib/home-store";
import { focusPage, useDocumentTitle } from "../lib/page";

const LOADING: HomeState = { status: "loading" };

/**
 * Home page: the categories and links the person may see, in catalog order.
 *
 * The data comes from the shared home store. A signed-in person gets a fresh request on every visit, with the
 * skeleton meanwhile; an anonymous visitor gets the public links the app already stored (fetched only when
 * missing). An answer for another viewer never reaches it: the store drops it and the app reloads the session.
 */
export function Home({ user }: { user: User | null }) {
  const strings = useStrings();
  const m = strings.home;
  const title = user ? m.title : m.publicTitle;
  useDocumentTitle(title);
  const key = homeKey(user);
  const entry = useHomeEntry(key);
  const state = entry?.state ?? LOADING;
  const retrying = state.status === "error" && entry?.pending === true;
  const loading = state.status === "loading";

  useEffect(() => {
    if (user) loadHome(key, { reset: true });
    else if (entry?.state.status !== "ready") loadHome(key);
    // Loaded once per visit and viewer; the entry itself may change meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Whether the status region has been registered: it is filled only after mount, so screen readers announce the change. */
  const [statusReady, setStatusReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStatusReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  /** Whether to focus the page heading once a retry succeeds, since the focused button goes away. */
  const focusAfterRetry = useRef(false);
  const retryAndRefocus = () => {
    focusAfterRetry.current = true;
    loadHome(key);
  };
  useEffect(() => {
    if (state.status === "error") return;
    if (focusAfterRetry.current && state.status === "ready") focusPage();
    focusAfterRetry.current = false;
  }, [state]);

  return (
    <>
      <PageHeader title={title} />
      <p role="status" className="sr-only">
        {statusReady && loading ? m.loading : ""}
      </p>
      {loading ? (
        <HomeSkeleton />
      ) : state.status === "error" ? (
        <div className="space-y-4">
          <Alert key={state.attempt} tone="destructive">
            {m.loadError} {errorMessage(state.error, strings)}
          </Alert>
          <Button variant="outline" pending={retrying} onClick={retryAndRefocus}>
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
