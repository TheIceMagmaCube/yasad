import { useStrings } from "../../i18n/LocaleProvider";
import { Button } from "../ui/button";

/**
 * Bar of the manage mode, placed after the categories: fixed at the bottom of the window and aligned on the app
 * column, static at the end of the page on a low screen (index.css, `.pins-bar`). Its Done closes the mode like the
 * panel's. The spacer before it keeps the end of the page clear of the fixed bar; a static bar needs none.
 */
export function ManageBar({ onDone }: { onDone(): void }) {
  const m = useStrings().home.pins;
  return (
    <>
      <div aria-hidden="true" className="h-20 [@media(max-height:30rem)]:hidden" />
      <div className="pins-bar border-t-[1.5px] border-border bg-card text-card-foreground">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
          <p className="font-heading font-bold">{m.bar}</p>
          <Button variant="outline" aria-label={m.doneName} onClick={onDone}>
            {m.done}
          </Button>
        </div>
      </div>
    </>
  );
}
