import { useEffect } from "react";

import { useInstance } from "../instance";

/** Set the document title to the given parts, most specific first, followed by the instance title. */
export function useDocumentTitle(...parts: string[]): void {
  const { title } = useInstance();
  const text = [...parts, title].join(" - ");
  useEffect(() => {
    document.title = text;
  }, [text]);
}
