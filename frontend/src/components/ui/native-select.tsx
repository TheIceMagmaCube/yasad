import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const SIZES = {
  default: "h-10 pr-9 pl-3 text-base md:text-sm",
  sm: "h-9 pr-8 pl-2 text-sm",
} as const;

type NativeSelectProps = Omit<ComponentProps<"select">, "size"> & { controlSize?: keyof typeof SIZES };

/**
 * Render a native select styled like the inputs, with a drawn chevron (no data URI image, so the CSP is
 * unchanged). Forced colors mode gets the system control back. `className` applies to the select itself.
 */
function NativeSelect({ className, controlSize = "default", ...props }: NativeSelectProps) {
  return (
    <div data-slot="native-select" className="relative min-w-0">
      <select
        className={cn(
          "sunken w-full min-w-0 appearance-none rounded-md border-[1.5px] border-input bg-card text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive forced-colors:appearance-auto",
          SIZES[controlSize],
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className={cn("pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground forced-colors:hidden", controlSize === "sm" ? "right-2" : "right-3")}
      />
    </div>
  );
}

export { NativeSelect };
export type { NativeSelectProps };
