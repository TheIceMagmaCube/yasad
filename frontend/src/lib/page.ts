import { useEffect, useRef } from "react";

import { useInstance } from "../instance";
import { useNavigations } from "./router";

/** Set the document title to the given parts, most specific first, followed by the instance title. */
export function useDocumentTitle(...parts: string[]): void {
  const { title } = useInstance();
  const text = [...parts, title].join(" - ");
  useEffect(() => {
    document.title = text;
  }, [text]);
}

/** Move the focus to the page heading, else to the main region. */
export function focusPage(): void {
  const target = document.querySelector<HTMLElement>('main h1[tabindex="-1"]') ?? document.getElementById("content");
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
