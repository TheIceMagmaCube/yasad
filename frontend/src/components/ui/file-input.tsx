import { LoaderCircle, Upload } from "lucide-react";
import type { ChangeEvent, ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { buttonVariants } from "./button";

type FileInputProps = Omit<ComponentProps<"input">, "type" | "onChange" | "value" | "disabled"> & {
  id: string;
  /** Text of the button that opens the file picker. */
  label: string;
  /** Name of the chosen file, shown beside the button. */
  fileName?: string | null;
  /** Whether the chosen file is being checked: further choices are ignored meanwhile. */
  pending?: boolean;
  /** Text of the button while pending. */
  pendingLabel?: string;
  onFile: (file: File) => void;
};

/**
 * Render a file input as a button-styled label and the chosen file name.
 *
 * The input stays in the page (visually hidden, never disabled, so the focus never falls to the body); its
 * value is emptied after each choice, so the same file can be chosen again.
 */
function FileInput({ id, label, fileName, pending = false, pendingLabel, onFile, className, "aria-describedby": describedBy, ...props }: FileInputProps) {
  const m = useStrings();
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (pending || !file) return;
    onFile(file);
  };
  return (
    <div data-slot="file-input" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <input
        id={id}
        type="file"
        className="peer sr-only"
        aria-describedby={[`${id}-name`, describedBy].filter(Boolean).join(" ")}
        onChange={handleChange}
        {...props}
      />
      <label
        htmlFor={id}
        className={buttonVariants({
          variant: "outline",
          className: "cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
        })}
      >
        {pending ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Upload aria-hidden="true" />}
        {pending && pendingLabel ? pendingLabel : label}
      </label>
      <span id={`${id}-name`} className="min-w-0 text-sm wrap-anywhere text-muted-foreground">
        {fileName || m.forms.noFile}
      </span>
    </div>
  );
}

export { FileInput };
