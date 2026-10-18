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

/** Render a placeholder for an empty page or list: decorative icon, title, text and optional actions, on a dashed, sunken slot. */
export function EmptyState({ icon: Icon, title, children, actions, titleAs: Title = "p", className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("sunken flex flex-col items-center rounded-(--radius-card) border-2 border-dashed border-control-ring bg-card px-4 py-10 text-center text-card-foreground sm:px-8", className)}
    >
      {Icon && (
        <span className="pixel-corners mb-4 flex size-14 items-center justify-center bg-primary text-primary-foreground">
          <Icon aria-hidden="true" className="size-6" />
        </span>
      )}
      <Title className="font-heading text-lg font-bold">{title}</Title>
      {children && <div className="mt-1 max-w-prose text-sm text-muted-foreground">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
