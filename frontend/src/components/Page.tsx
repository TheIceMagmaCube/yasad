import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Named content widths: a form column, readable text, or a full-width list. */
const WIDTHS = {
  form: "max-w-sm",
  reading: "max-w-2xl",
  list: "max-w-none",
} as const;

export type PageWidth = keyof typeof WIDTHS;

/** Hold the content of a page at one of the named widths, always aligned to the start of the main region. */
export function Page({ width, className, children }: { width: PageWidth; className?: string; children: ReactNode }) {
  return (
    <div data-slot="page" data-width={width} className={cn("w-full", WIDTHS[width], className)}>
      {children}
    </div>
  );
}
