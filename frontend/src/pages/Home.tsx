import type { User } from "../api";
import { useStrings } from "../i18n/LocaleProvider";

export function Home({ user }: { user: User }) {
  const m = useStrings().home;
  return (
    <>
      <h1 className="text-2xl font-bold">{m.title}</h1>
      <p className="mt-2">{m.signedInAs(user.name)}</p>
      <p className="mt-6 text-sm text-muted-foreground">{m.placeholder}</p>
    </>
  );
}
