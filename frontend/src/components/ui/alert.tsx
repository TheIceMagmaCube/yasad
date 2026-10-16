import { cva } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from "react";

import { claimFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";

type AlertVariant = "info" | "success" | "warning" | "destructive";

const alertVariants = cva("flex gap-3 rounded-lg border p-4 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring", {
  variants: {
    variant: {
      info: "border-info bg-info-surface",
      success: "border-success bg-success-surface",
      warning: "border-warning bg-warning-surface",
      destructive: "border-destructive bg-destructive-surface",
    },
  },
  defaultVariants: { variant: "info" },
});

const ICONS: Record<AlertVariant, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "text-info" },
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  destructive: { icon: CircleAlert, className: "text-destructive" },
};

type AlertProps = Omit<ComponentProps<"div">, "title" | "ref"> & {
  variant?: AlertVariant;
  title?: ReactNode;
  /** Id of the title element, for a form whose fields point at it; generated when omitted. */
  titleId?: string;
  /**
   * Focus the alert when it mounts (error summaries). Give it a new `key` to focus it again.
   * The focus announces it, so it becomes a labelled group instead of a live region, which would be read twice.
   * It claims the focus, so a view change in the same commit leaves it there.
   */
  autoFocus?: boolean;
};

/**
 * Render a message box with a variant icon, an optional title and a body.
 *
 * The role defaults to status for info and success, alert for warning and destructive, and group with
 * `autoFocus`; pass `role` to change it.
 */
function Alert({ variant = "info", title, titleId: givenTitleId, autoFocus = false, role, className, children, ...props }: AlertProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = title ? (givenTitleId ?? `${id}-title`) : undefined;
  const bodyId = children ? `${id}-body` : undefined;
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
    claimFocus();
  }, [autoFocus]);
  const { icon: Icon, className: iconClassName } = ICONS[variant];
  return (
    <div
      ref={ref}
      data-slot="alert"
      role={role ?? (autoFocus ? "group" : variant === "info" || variant === "success" ? "status" : "alert")}
      aria-labelledby={autoFocus ? (titleId ?? bodyId) : undefined}
      aria-describedby={autoFocus && titleId ? bodyId : undefined}
      tabIndex={autoFocus ? -1 : undefined}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconClassName)} />
      <div className="min-w-0 flex-1">
        {title && (
          <p id={titleId} className="font-semibold">
            {title}
          </p>
        )}
        {children && (
          <div id={bodyId} className={cn(title && "mt-1")}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export { Alert, alertVariants };
export type { AlertProps, AlertVariant };
