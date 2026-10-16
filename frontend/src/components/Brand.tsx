import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

import { useInstance } from "../instance";
import { InstanceLogo } from "./InstanceLogo";
import { Link } from "./Link";

const brandVariants = cva(
  "flex min-w-0 items-center rounded-md font-bold text-header-foreground outline-none focus-visible:ring-2 focus-visible:ring-header-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-header",
  {
    variants: {
      size: {
        header: "gap-2",
        panel: "gap-3 md:flex-col md:items-start",
      },
    },
    defaultVariants: { size: "header" },
  },
);

const logoSizes = { header: "size-6", panel: "size-6 md:size-14" };
const titleSizes = { header: "", panel: "text-lg md:text-3xl" };

type BrandProps = VariantProps<typeof brandVariants> & {
  /** Target of the link. */
  href?: string;
  className?: string;
};

/** Render the instance logo and title as a link to the home page, sized for the header bar or the sign-in panel. */
export function Brand({ size, href = "/", className }: BrandProps) {
  const { title } = useInstance();
  const key = size ?? "header";
  return (
    <Link href={href} data-slot="brand" className={cn(brandVariants({ size }), className)}>
      <InstanceLogo className={cn("shrink-0", logoSizes[key])} />
      <span className={cn("truncate", titleSizes[key])}>{title}</span>
    </Link>
  );
}
