import { Link } from "../components/Link";
import { Page } from "../components/Page";
import { buttonVariants } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { useDocumentTitle } from "../lib/page";

/** Heading, explanation and a link back to the home page. */
function ErrorView({ title, body, home }: { title: string; body: string; home: string }) {
  useDocumentTitle(title);
  return (
    <Page width="reading">
      <h1 tabIndex={-1} className="text-2xl font-bold outline-none">
        {title}
      </h1>
      <p className="mt-2">{body}</p>
      <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
        {home}
      </Link>
    </Page>
  );
}

/** View for a path that matches no page. */
export function NotFound() {
  const m = useStrings().notFound;
  return <ErrorView title={m.title} body={m.body} home={m.home} />;
}

/** View for an administration path opened by someone who is not an administrator. */
export function Forbidden() {
  const m = useStrings().forbidden;
  return <ErrorView title={m.title} body={m.body} home={m.home} />;
}
