import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Element of the title: a heading when the empty state stands for a whole section. */
  titleAs?: "p" | "h2" | "h3";
  className?: string;
};

/** Render a placeholder for an empty page or list: decorative icon, title, text and optional actions, on a dashed card. */
export function EmptyState({ icon: Icon, title, children, actions, titleAs: Title = "p", className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center rounded-xl border border-dashed bg-card px-4 py-10 text-center text-card-foreground sm:px-8", className)}
    >
      {Icon && (
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-6" />
        </span>
      )}
      <Title className="text-base font-semibold">{title}</Title>
      {children && <div className="mt-1 max-w-prose text-sm text-muted-foreground">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
