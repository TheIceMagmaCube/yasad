import { type KeyboardEvent, useId, useState } from "react";

import { api, type HomeIcon, type UploadedImage } from "../../../api";
import { Field } from "../../../components/form/Field";
import { describedByOf, FieldError } from "../../../components/form/FormField";
import { PendingButton } from "../../../components/form/PendingButton";
import { LinkIcon } from "../../../components/home/LinkIcon";
import { FileInput } from "../../../components/ui/file-input";
import type { Messages } from "../../../i18n/en";
import { useLocale, useStrings } from "../../../i18n/LocaleProvider";
import { useAnnounce } from "../../../lib/announcer";
import type { FieldProps } from "../../../lib/form-errors";
import { fileProblem, IMAGE_TYPES, imageErrorText, imageSrc, readBase64 } from "../../../lib/images";

/**
 * An image the icon cites. A stored one, read from the link, carries its id only, and `missing` when the server no
 * longer stores it; one just uploaded or fetched also carries what the server said, and `host` for a fetched one
 * (taken from the address typed: the server keeps none).
 */
export type IconImage = { id: string; width?: number; height?: number; sanitized?: boolean; host?: string; missing?: boolean };
export type IconKind = "builtin" | "upload" | "url";
/** What the icon field holds: the option chosen, the built-in name typed, and the image obtained by either other option. */
export type IconChoice = { kind: IconKind; builtin: string; image: IconImage | null };

const IMAGE_REF = /^image:([0-9a-f]{32})$/;
const KINDS: readonly IconKind[] = ["builtin", "upload", "url"];

/** Return the id of the image an icon value cites, or null for any other value. */
export const imageIdOf = (icon: string | null | undefined) => IMAGE_REF.exec(icon ?? "")?.[1] ?? null;

/** Return the choice a stored icon value gives: an image opens on the upload option, `known` false when it is gone. */
export function choiceOf(icon: string | null, known = true): IconChoice {
  const id = imageIdOf(icon);
  return id ? { kind: "upload", builtin: "", image: known ? { id } : { id, missing: true } } : { kind: "builtin", builtin: icon ?? "", image: null };
}

/** Return the icon value to store: the name typed, or the image's reference; null for none. */
export function iconValueOf(choice: IconChoice): string | null {
  if (choice.kind === "builtin") return choice.builtin.trim() || null;
  return choice.image ? `image:${choice.image.id}` : null;
}

/** Return the icon as the home page would draw it; a built-in name the server does not know falls back to the initial. */
function previewIcon(value: string | null): HomeIcon | null {
  if (!value) return null;
  const id = imageIdOf(value);
  if (id) return { set: "image", name: id };
  const colon = value.indexOf(":");
  const set = value.slice(0, colon);
  return set === "si" || set === "lucide" ? { set, name: value.slice(colon + 1) } : null;
}

/** Return what the choice shows, in words: the icon tile is decorative. */
export function iconText(choice: IconChoice, m: Messages): string {
  const t = m.links.icon;
  const value = iconValueOf(choice);
  if (!value) return t.none;
  const image = choice.kind === "builtin" ? null : choice.image;
  if (!image) return t.builtin(value);
  if (image.missing) return t.missing;
  if (image.host) return t.fetchedFrom(image.host);
  return image.width && image.height ? t.uploadedSize(image.width, image.height) : t.uploaded;
}

/** Return the host of an address as typed, or the address itself when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type IconChooserProps = {
  /** The error state of the field, from `useFormErrors().field("icon")`; its id goes on the control shown. */
  field: FieldProps<string>;
  value: IconChoice;
  onChange: (next: IconChoice) => void;
  /** The link's title, for the initial the preview falls back to. */
  title: string;
  /** Classes of the category's tile, so the preview looks as the home page will. */
  tone: string;
  /** Read only: the choice is shown, nothing can be uploaded or fetched. */
  disabled?: boolean;
};

/**
 * The icon of a link, in three options as native radio buttons: a built-in icon by name, an image uploaded, or an
 * image the server fetches once from an address. The image reference is never typed. Choosing a file or fetching
 * never moves the focus: progress and result are announced, and a refusal stays under the control, which describes it.
 */
export function IconChooser({ field, value, onChange, title, tone, disabled = false }: IconChooserProps) {
  const m = useStrings();
  const t = m.links.icon;
  const { language } = useLocale();
  const announce = useAnnounce();
  const name = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [url, setUrl] = useState("https://");
  const [problem, setProblem] = useState<{ kind: IconKind; text: string } | null>(null);
  const [busy, setBusy] = useState<"upload" | "fetch" | null>(null);

  const refuse = (kind: IconKind, text: string) => {
    setProblem({ kind, text });
    announce(text);
  };
  const obtained = (image: UploadedImage, kind: IconKind, host?: string) => {
    onChange({ ...value, kind, image: { id: image.id, width: image.width, height: image.height, sanitized: image.sanitized, host } });
    announce(t.ready);
  };

  async function choose(file: File) {
    setFileName(file.name);
    setProblem(null);
    const local = fileProblem(file, language, m);
    if (local) return refuse("upload", local);
    setBusy("upload");
    announce(t.uploading);
    try {
      obtained(await api.uploadImage(await readBase64(file)), "upload");
    } catch (err) {
      refuse("upload", imageErrorText(err, language, m));
    } finally {
      setBusy(null);
    }
  }

  async function fetchFrom() {
    setProblem(null);
    const typed = url.trim();
    if (!/^https?:\/\/\S+$/.test(typed)) return refuse("url", m.fieldErrors.invalid_url);
    setBusy("fetch");
    try {
      obtained(await api.fetchImage(typed), "url", hostOf(typed));
    } catch (err) {
      refuse("url", imageErrorText(err, language, m));
    } finally {
      setBusy(null);
    }
  }

  // Enter in the address fetches, rather than submitting the form around it.
  const onUrlKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!busy) void fetchFrom();
  };

  const localError = problem?.kind === value.kind ? problem.text : undefined;
  const error = localError ?? field.error;
  const hintId = `${field.id}-hint`;
  const image = value.kind === "builtin" ? null : value.image;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 text-sm leading-none font-medium">{m.links.fields.icon}</legend>
      <div className="flex flex-col">
        {KINDS.map((kind) => (
          <label key={kind} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <input
              type="radio"
              name={name}
              value={kind}
              checked={value.kind === kind}
              // Locked while an image is on its way: its arrival writes the option it was asked from.
              disabled={disabled || busy !== null}
              onChange={() => onChange({ ...value, kind })}
              className="size-4 shrink-0 cursor-pointer accent-selected disabled:cursor-not-allowed"
            />
            {t.kind[kind]}
          </label>
        ))}
      </div>
      {value.kind === "builtin" && (
        <Field
          {...field}
          label={t.name}
          hint={m.links.fields.iconHint}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          inputClassName="font-mono"
          value={value.builtin}
          onChange={(e) => onChange({ ...value, builtin: e.target.value })}
        />
      )}
      {value.kind === "upload" && !disabled && (
        <div className="flex flex-col gap-1.5">
          <p id={hintId} className="text-sm text-muted-foreground">
            {t.hint}
          </p>
          <FileInput
            id={field.id}
            label={t.file}
            fileName={fileName}
            pending={busy === "upload"}
            pendingLabel={t.uploading}
            accept={IMAGE_TYPES.join(",")}
            aria-invalid={error || field.invalid ? true : undefined}
            aria-describedby={describedByOf({ id: field.id, error, invalid: field.invalid, describedBy: field.describedBy, hint: t.hint })}
            onFile={(file) => void choose(file)}
          />
          {error && <FieldError id={`${field.id}-error`}>{error}</FieldError>}
        </div>
      )}
      {value.kind === "url" && !disabled && (
        <div className="flex flex-col gap-2">
          <Field
            {...field}
            error={error}
            label={t.url}
            hint={t.urlHint}
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onUrlKey}
          />
          <div>
            <PendingButton type="button" variant="outline" pending={busy === "fetch"} pendingLabel={t.fetching} onClick={() => void fetchFrom()}>
              {t.fetch}
            </PendingButton>
          </div>
        </div>
      )}
      <div data-slot="icon-preview" className="flex items-center gap-3">
        <LinkIcon icon={previewIcon(iconValueOf(value))} title={title} className={tone} />
        <p className="text-sm">{iconText(value, m)}</p>
      </div>
      {image?.sanitized && <p className="text-sm">{t.sanitized}</p>}
    </fieldset>
  );
}

/** Render the stored icon under the field after a conflict: an image as a thumbnail and words, never its reference. */
export function CurrentIcon({ icon }: { icon: string | null }) {
  const m = useStrings();
  const id = imageIdOf(icon);
  return (
    <p data-slot="current-value" className="flex items-center gap-2 border-l-2 border-warning pl-2 text-sm wrap-anywhere">
      {id && <img src={imageSrc(id)} alt="" className="size-6 rounded-sm bg-card object-contain" />}
      {m.links.current(id ? m.links.icon.uploaded : icon || m.links.empty)}
    </p>
  );
}
