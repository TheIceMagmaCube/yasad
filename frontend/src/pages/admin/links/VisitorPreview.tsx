import { LogIn } from "lucide-react";

import { api } from "../../../api";
import { AdminShell } from "../../../components/admin/AdminShell";
import { listHref } from "../../../components/admin/DetailPage";
import { EmptyState } from "../../../components/EmptyState";
import { Alert } from "../../../components/ui/alert";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useAdminCollection } from "../../../lib/admin-collection";
import { HomePreview } from "../HomePreview";
import { LIST } from "./item-edit";

/**
 * Read-only preview of the home page of a visitor who is not signed in: the public links, without groups or
 * favourites. Without any, a visitor gets the sign-in screen, and the page says so.
 */
export function VisitorPreview() {
  const m = useStrings();
  const a = m.access;
  const home = useAdminCollection(api.visitorHome);
  return (
    <AdminShell section="links" title={a.visitorTitle} back={{ href: listHref(LIST), label: m.admin.backTo(m.links.title) }}>
      <div className="flex flex-col gap-10">
        <Alert variant="info" role="note">
          {a.banner}
        </Alert>
        <HomePreview
          home={home}
          label={a.visitorRegion}
          empty={
            <EmptyState icon={LogIn} titleAs="h3" title={a.noPublicTitle}>
              {a.noPublic}
            </EmptyState>
          }
        />
      </div>
    </AdminShell>
  );
}
