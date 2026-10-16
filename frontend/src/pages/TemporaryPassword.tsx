import type { User } from "../api";
import { PasswordForm } from "../components/account/PasswordForm";
import { AuthLayout } from "../components/AuthLayout";
import { Button } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { useDocumentTitle } from "../lib/page";

/**
 * The step that replaces a temporary password, in the sign-in layout: nothing else of YASAD opens before it is
 * done, and the person can sign out instead.
 */
export function TemporaryPassword({ user, onDone, onSignOut }: { user: User; onDone: () => void; onSignOut: () => void }) {
  const m = useStrings();
  useDocumentTitle(m.changePassword.title);
  return (
    <AuthLayout
      actions={
        <Button variant="ghost" size="sm" onClick={onSignOut}>
          {m.userMenu.signOut}
        </Button>
      }
    >
      <PasswordForm mode="temporary" user={user} onDone={onDone} />
    </AuthLayout>
  );
}
