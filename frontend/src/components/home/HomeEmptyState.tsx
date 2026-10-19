import { FolderOpen, Layers, Lock, UserRoundX } from "lucide-react";

import type { HomeEmpty } from "@/api";
import { useStrings } from "@/i18n/LocaleProvider";

import { EmptyState } from "../EmptyState";
import { Link } from "../Link";
import { buttonVariants } from "../ui/button";

// The underline of the link button, so inline links read the same everywhere.
const stepLink =
  "rounded-sm font-semibold text-foreground underline decoration-link-decoration decoration-2 underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Explain why the home page shows no link, from the code the API sends. An admin with an empty catalog gets the
 * three setup steps; nobody else is pointed at the administration pages. An unknown or missing code reads as
 * "nothing visible".
 */
export function HomeEmptyState({ empty }: { empty: HomeEmpty | null }) {
  const m = useStrings().home.empty;
  switch (empty) {
    case "catalog_empty":
      return (
        <EmptyState icon={FolderOpen} titleAs="h2" title={m.catalog.title}>
          <p>{m.catalog.body}</p>
          <ol className="mt-4 list-inside list-decimal space-y-2 text-left text-foreground sm:text-center">
            <li>
              <Link href="/admin/links/file" className={stepLink}>
                {m.catalog.import}
              </Link>
            </li>
            <li>
              <Link href="/admin/groups" className={stepLink}>
                {m.catalog.groups}
              </Link>
            </li>
            <li>
              <Link href="/admin/groups" className={stepLink}>
                {m.catalog.members}
              </Link>
            </li>
          </ol>
          <p className="mt-4">
            {m.catalog.accounts}{" "}
            <Link href="/admin/users" className={stepLink}>
              {m.catalog.users}
            </Link>
            .
          </p>
        </EmptyState>
      );
    case "admin_no_access":
      return (
        <EmptyState
          icon={Lock}
          titleAs="h2"
          title={m.adminNoAccess.title}
          actions={
            <>
              <Link href="/admin/groups" className={buttonVariants()}>
                {m.adminNoAccess.manageGroups}
              </Link>
              <Link href="/admin/links" className={buttonVariants({ variant: "outline" })}>
                {m.adminNoAccess.manageCatalog}
              </Link>
            </>
          }
        >
          {m.adminNoAccess.body}
        </EmptyState>
      );
    case "no_groups":
      return (
        <EmptyState icon={UserRoundX} titleAs="h2" title={m.noGroups.title}>
          {m.noGroups.body}
        </EmptyState>
      );
    default:
      return (
        <EmptyState icon={Layers} titleAs="h2" title={m.nothingVisible.title}>
          {m.nothingVisible.body}
        </EmptyState>
      );
  }
}
