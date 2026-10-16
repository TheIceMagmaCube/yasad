import type { User } from "../api";
import { useStrings } from "../i18n/LocaleProvider";
import { useDocumentTitle } from "../lib/page";

export function Home({ user }: { user: User }) {
  const strings = useStrings();
  const m = strings.home;
  useDocumentTitle(strings.nav.home);
  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-bold outline-none">
        {m.title}
      </h1>
      <p className="mt-2">{m.signedInAs(user.name)}</p>
      <p className="mt-6 text-sm text-muted-foreground">{m.placeholder}</p>
    </>
  );
}
