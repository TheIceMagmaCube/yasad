import { Link } from "../components/Link";
import { Page } from "../components/Page";
import { PageHeader } from "../components/PageHeader";
import { PixelScene } from "../components/PixelScene";
import { buttonVariants } from "../components/ui/button";
import { useStrings } from "../i18n/LocaleProvider";
import { useDocumentTitle } from "../lib/page";

/** Pixel banner with the status code, then the heading, explanation and a link back to the home page. */
function ErrorView({ code, title, body, home }: { code: string; title: string; body: string; home: string }) {
  useDocumentTitle(title);
  return (
    <Page width="reading">
      <div aria-hidden="true" className="panel relative isolate mb-8 flex h-40 items-start overflow-hidden bg-header p-5 sm:h-52">
        <PixelScene time="dusk" className="absolute inset-0 -z-10 size-full" />
        <span className="text-pixel text-6xl leading-none text-header-foreground [text-shadow:0_4px_0_#2a1744] sm:text-7xl">{code}</span>
      </div>
      <PageHeader title={title} description={body} />
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        {home}
      </Link>
    </Page>
  );
}

/** View for a path that matches no page. */
export function NotFound() {
  const m = useStrings().notFound;
  return <ErrorView code="404" title={m.title} body={m.body} home={m.home} />;
}

/** View for an administration path opened by someone who is not an administrator. */
export function Forbidden() {
  const m = useStrings().forbidden;
  return <ErrorView code="403" title={m.title} body={m.body} home={m.home} />;
}
