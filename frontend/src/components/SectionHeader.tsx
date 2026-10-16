import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Section actions: right of the title from sm up, below it on narrow screens. */
  actions?: ReactNode;
  /** Id of the h2, for aria-labelledby on the section. */
  id?: string;
  className?: string;
};

/** Render a section heading (h2) with optional description and actions. */
export function SectionHeader({ title, description, actions, id, className }: SectionHeaderProps) {
  return (
    <div className={cn("mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-section">
          {title}
        </h2>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
