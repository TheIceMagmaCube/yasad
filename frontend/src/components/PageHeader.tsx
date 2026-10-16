import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Short context line above the title (section name, parent page). */
  eyebrow?: ReactNode;
  /** Page actions: right of the title from sm up, below it on narrow screens. */
  actions?: ReactNode;
  className?: string;
};

/** Render the page heading: an h1 the router can focus (tabIndex -1), with optional eyebrow, description and actions. */
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-caption mb-1 text-muted-foreground">{eyebrow}</p>}
        <h1 tabIndex={-1} className="text-title outline-none">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-prose text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </header>
  );
}
