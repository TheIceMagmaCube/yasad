import { cn } from "@/lib/utils";

import { useInstance } from "../instance";
import { InstanceLogo } from "./InstanceLogo";
import { Link } from "./Link";

const BASE =
  "flex min-w-0 items-center rounded-md font-bold text-header-foreground outline-none focus-visible:ring-2 focus-visible:ring-header-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-header";

/** Classes of each size: the header bar, or the panel of the sign-in screens. */
const SIZES = {
  header: { root: "gap-2", logo: "size-6", title: "" },
  panel: { root: "gap-3 md:flex-col md:items-start", logo: "size-6 md:size-14", title: "text-lg md:text-3xl" },
} as const;

type BrandProps = {
  size?: keyof typeof SIZES;
  /** Target of the link. */
  href?: string;
  className?: string;
};

/** Render the instance logo and title as a link to the home page, sized for the header bar or the sign-in panel. */
export function Brand({ size = "header", href = "/", className }: BrandProps) {
  const { title } = useInstance();
  const classes = SIZES[size];
  return (
    <Link href={href} data-slot="brand" className={cn(BASE, classes.root, className)}>
      <InstanceLogo className={cn("shrink-0", classes.logo)} />
      <span className={cn("truncate", classes.title)}>{title}</span>
    </Link>
  );
}
