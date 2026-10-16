import { useEffect, useRef } from "react";

import { useNavigations } from "./router";

/** Whether an element took the focus during the commit being run. */
let claimed = false;

/**
 * Say that the calling component has just moved the focus itself (error summary, focused alert, confirmation or
 * secret panel), so the {@link focusPage} of the same commit leaves it there. Call it right after focusing.
 */
export function claimFocus(): void {
  claimed = true;
  // Effects of one commit run in one task: the claim ends with it.
  queueMicrotask(() => {
    claimed = false;
  });
}

/** Return the page heading, else the main region. */
function pageTarget(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main h1[tabindex="-1"]') ?? document.getElementById("content");
}

/** Move the focus to the page heading, else to the main region, unless a component claimed it in this commit. */
export function focusPage(): void {
  if (claimed) return;
  pageTarget()?.focus();
}

/**
 * Focus the element with `id` once `after` (the reload that follows an action) has settled and the page has
 * rendered. When the element is gone, focus the list filter (`data-focus-fallback`), then the page heading: never
 * the body.
 */
export async function focusById(id: string, after?: Promise<unknown>): Promise<void> {
  await after?.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const target = document.getElementById(id) ?? document.querySelector<HTMLElement>("[data-focus-fallback]") ?? pageTarget();
  target?.focus();
}

/** Focus the page after each client-side navigation, leaving the first load alone. */
export function useFocusOnNavigation(): void {
  const navigations = useNavigations();
  const initial = useRef(navigations);
  useEffect(() => {
    if (navigations !== initial.current) focusPage();
  }, [navigations]);
}

/**
 * Focus the page when `viewKey` changes (signed in or out, temporary password replaced, server back), leaving
 * the first view after loading alone, as the browser placed the focus itself.
 */
export function useFocusOnViewChange(viewKey: string, initialKey = "loading"): void {
  const previous = useRef(viewKey);
  useEffect(() => {
    const from = previous.current;
    previous.current = viewKey;
    if (from !== viewKey && from !== initialKey) focusPage();
  }, [viewKey, initialKey]);
}
