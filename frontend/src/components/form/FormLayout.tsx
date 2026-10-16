import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Stack the fields of a form with even gaps. */
export function FormStack({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-5", className)}>{children}</div>;
}

/**
 * Lay out the form buttons: the main action first, then Cancel. `stretch` gives each button the full width, as on
 * the sign-in screens.
 */
export function FormActions({ stretch = false, className, children }: { stretch?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn(stretch ? "flex flex-col gap-3 *:w-full" : "flex flex-wrap items-center gap-3", className)}>{children}</div>;
}
