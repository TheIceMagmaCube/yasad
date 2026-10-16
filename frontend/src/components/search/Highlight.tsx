import type { ReactNode } from "react";

import type { Highlighted } from "@/lib/search";

/**
 * Render `text` with its `ranges` in <mark> elements, as React children (never as HTML). The mark is bold and
 * underlined in the text colour, so it does not rely on colour and keeps the text contrast.
 */
export function Highlight({ text, ranges }: Highlighted) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="bg-transparent font-semibold text-inherit underline decoration-2 underline-offset-2">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
