import { type FormEvent, type ReactNode, useId, useState } from "react";

import { cn } from "@/lib/utils";

import { type AdminInstance, api, ApiError, type StoredImage, type UploadedImage } from "../../../api";
import { AdminShell } from "../../../components/admin/AdminShell";
import { ITEM_WIDTH } from "../../../components/admin/DetailPage";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { describedByOf, FieldError } from "../../../components/form/FormField";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { PendingButton, SubmitButton } from "../../../components/form/PendingButton";
import { LoadError } from "../../../components/LoadError";
import { Logo } from "../../../components/Logo";
import { SectionHeader } from "../../../components/SectionHeader";
import { ThemeVignette } from "../../../components/ThemeVignette";
import { FileInput } from "../../../components/ui/file-input";
import type { Messages } from "../../../i18n/en";
import { errorMessage } from "../../../i18n/errors";
import { useLocale, useStrings } from "../../../i18n/LocaleProvider";
import { refreshTabIcon, useInstance, useReloadInstance } from "../../../instance";
import { useAdminCollection } from "../../../lib/admin-collection";
import { useAnnounce } from "../../../lib/announcer";
import { useFormErrors } from "../../../lib/form-errors";
import { type Theme, THEMES } from "../../../preferences";

/** Address of the appearance page. */
export const APPEARANCE = "/admin/appearance";

/** Longest title, as the server checks it. */
export const MAX_TITLE = 60;
/** Largest image and longest side, as the server checks them: said in the hint, the size checked before the upload. */
export const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_IMAGE_SIDE = 2048;
/** Types the server accepts, also the file picker's filter; the server reads the type from the bytes anyway. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
const TYPE_NAMES: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP", "image/svg+xml": "SVG" };

/** Return a size in bytes as people read it: bytes under 1 KiB, else KiB with one decimal at most. */
export function sizeText(bytes: number, language: string, m: Messages): string {
  if (bytes < 1024) return m.appearance.sizes.bytes(new Intl.NumberFormat(language).format(bytes));
  return m.appearance.sizes.kib(new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / 1024));
}

/** Return why an image was refused, with the limit in figures. */
function uploadErrorText(err: unknown, language: string, m: Messages): string {
  const e = m.images.errors;
  if (!(err instanceof ApiError)) return errorMessage(err, m);
  const { code, reason, max } = err.body;
  if (code === "images_full") return e.images_full;
  if (code !== "invalid_image") return errorMessage(err, m);
  switch (reason) {
    case "too_large":
      return e.too_large_max(sizeText(max ?? MAX_IMAGE_BYTES, language, m));
    case "dimensions":
      return e.dimensions(new Intl.NumberFormat(language).format(max ?? MAX_IMAGE_SIDE));
    case "unsupported_type":
    case "unreadable":
    case "animated":
    case "svg_doctype":
    case "svg_too_complex":
      return e[reason];
    default:
      return e.unreadable;
  }
}

/** Return the file's content in base64, as the upload sends it. */
function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * The appearance of the instance, in three blocks saved one at a time: title, logo and default theme. A save
 * changes every page at once, for everyone; it is announced without moving the focus.
 */
export function AppearancePage() {
  const m = useStrings();
  const stored = useAdminCollection(api.adminInstance);
  const reloadInstance = useReloadInstance();
  const announce = useAnnounce();
  const [status, setStatus] = useState("");

  const saved = async (next: AdminInstance, text: string) => {
    stored.setData(() => next);
    await reloadInstance();
    setStatus(text);
    announce(text);
  };

  return (
    <AdminShell section="appearance">
      {stored.status === "error" ? (
        <LoadError attempt={stored.attempt} message={m.errors.generic} pending={stored.retrying} onRetry={stored.retry} />
      ) : !stored.data ? (
        <p className="text-muted-foreground">{m.loading}</p>
      ) : (
        <div className={cn("flex flex-col gap-10", ITEM_WIDTH)}>
          {status && (
            <p data-slot="appearance-status" className="text-sm">
              {status}
            </p>
          )}
          <TitleBlock stored={stored.data} onSaved={saved} />
          <LogoBlock stored={stored.data} onSaved={saved} />
          <ThemeBlock stored={stored.data} onSaved={saved} />
        </div>
      )}
    </AdminShell>
  );
}

type BlockProps = { stored: AdminInstance; onSaved: (next: AdminInstance, text: string) => Promise<void> };

/** A titled block of the page (h2). */
function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="max-w-xl">
      <SectionHeader id={id} title={title} />
      {children}
    </section>
  );
}

/** The instance title: empty goes back to YASAD. */
function TitleBlock({ stored, onSaved }: BlockProps) {
  const m = useStrings();
  const t = m.appearance.title;
  const [title, setTitle] = useState(stored.title ?? "");
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors(["title"], "appearance-title");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (!errors.check({ title: value.length > MAX_TITLE && m.fieldErrors.invalid_title })) return;
    setBusy(true);
    try {
      const next = await api.updateInstance({ title: value || null });
      setTitle(next.title ?? "");
      await onSaved(next, t.saved);
    } catch (err) {
      errors.failWith(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block title={t.heading}>
      <form noValidate onSubmit={submit}>
        <FormStack>
          <ErrorSummary errors={errors} labels={{ title: t.label }} />
          <div className="flex flex-col gap-1">
            <Field label={t.label} hint={t.hint} maxLength={MAX_TITLE} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} {...errors.field("title")} />
            {/* The limit is in the hint: the count only helps the eye, and would be read again at every key. */}
            <p aria-hidden="true" className="text-caption self-end text-muted-foreground tabular-nums">
              {t.count(title.trim().length, MAX_TITLE)}
            </p>
          </div>
          <FormActions>
            <SubmitButton pending={busy} pendingLabel={m.appearance.saving}>
              {t.save}
            </SubmitButton>
          </FormActions>
        </FormStack>
      </form>
    </Block>
  );
}

/** The logo on the header's key cap, in light and dark side by side; the first copy carries the text. */
function LogoPreview({ src, alt }: { src: string | null; alt: string }) {
  const m = useStrings();
  const { theme } = useInstance();
  return (
    <div data-slot="logo-preview" className="flex gap-3">
      {(["light", "dark"] as const).map((mode, i) => (
        <span key={mode} data-theme={theme} data-mode={mode} className="flex flex-col items-center gap-1.5 rounded-md bg-header p-3 text-header-foreground">
          <span className="pixel-corners flex size-14 items-center justify-center border-b-[3px] border-primary-shade bg-primary p-2 text-primary-foreground">
            {src ? <img src={src} alt={i === 0 ? alt : ""} className="size-full object-contain" /> : <Logo className="size-full" />}
          </span>
          <span aria-hidden="true" className="text-caption">
            {mode === "light" ? m.appearance.logo.light : m.appearance.logo.dark}
          </span>
        </span>
      ))}
    </div>
  );
}

const isStored = (logo: AdminInstance["logo"]): logo is StoredImage => logo !== null && "id" in logo;

/**
 * The logo: a file is checked here first (size, type), then uploaded at once, and the preview shows it; saving
 * makes it the logo. Choosing a file never moves the focus: progress and result are announced, and a refusal stays
 * under the field, which describes it.
 */
function LogoBlock({ stored, onSaved }: BlockProps) {
  const m = useStrings();
  const l = m.appearance.logo;
  const { language } = useLocale();
  const { logo: shownLogo } = useInstance();
  const announce = useAnnounce();
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState<UploadedImage | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "save" | "remove" | null>(null);
  const errors = useFormErrors(["file"], "appearance-logo");
  const current = stored.logo;

  const refuse = (text: string) => {
    setUploadError(text);
    announce(text);
  };

  async function choose(file: File) {
    setFileName(file.name);
    setUploadError(null);
    errors.reset();
    setPending(null);
    if (file.size > MAX_IMAGE_BYTES) return refuse(m.images.errors.too_large(sizeText(file.size, language, m), sizeText(MAX_IMAGE_BYTES, language, m)));
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return refuse(m.images.errors.unsupported_type);
    setBusy("upload");
    announce(l.uploading);
    try {
      setPending(await api.uploadImage(await readBase64(file)));
      announce(l.uploaded);
    } catch (err) {
      refuse(uploadErrorText(err, language, m));
    } finally {
      setBusy(null);
    }
  }

  async function save(logo: string | null, text: string) {
    setBusy(logo ? "save" : "remove");
    try {
      const next = await api.updateInstance({ logo });
      setPending(null);
      setFileName(null);
      refreshTabIcon(logo ?? "default");
      await onSaved(next, text);
    } catch (err) {
      errors.failWith(err, { codes: { unknown_image: { message: m.images.errors.unknown_image, field: "file" } } });
      if (err instanceof ApiError && err.body.code === "unknown_image") setPending(null);
    } finally {
      setBusy(null);
    }
  }

  const shown = pending ?? (isStored(current) ? current : null);
  const details = shown && l.details(TYPE_NAMES[shown.type] ?? shown.type, shown.width, shown.height, sizeText(shown.size, language, m));
  const fileId = errors.fieldId("file");
  const field = errors.field("file");
  const error = uploadError ?? field.error;
  const hintId = `${fileId}-hint`;
  return (
    <Block title={l.heading}>
      <FormStack>
        <ErrorSummary errors={errors} labels={{ file: l.file }} />
        <div className="flex flex-col gap-2">
          {/* A logo set outside the app is shown as the header shows it, from the public settings. */}
          <LogoPreview src={shown ? `/api/images/${shown.id}` : current ? shownLogo : null} alt={pending ? l.next : l.current} />
          <p data-slot="logo-details" className="text-sm text-muted-foreground">
            {pending && <span className="block font-bold text-foreground">{l.next}</span>}
            {details ?? (current && !isStored(current) ? l.legacy : l.byDefault)}
          </p>
          {pending?.sanitized && <p className="text-sm">{l.sanitized}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <p id={hintId} className="text-sm text-muted-foreground">
            {l.hint}
          </p>
          <FileInput
            id={fileId}
            label={l.file}
            fileName={fileName}
            pending={busy === "upload"}
            pendingLabel={l.uploading}
            accept={IMAGE_TYPES.join(",")}
            aria-invalid={error || field.invalid ? true : undefined}
            aria-describedby={describedByOf({ id: fileId, error: error ?? undefined, invalid: field.invalid, describedBy: field.describedBy, hint: l.hint })}
            onFile={(file) => void choose(file)}
          />
          {error && <FieldError id={`${fileId}-error`}>{error}</FieldError>}
        </div>
        {(pending || current) && (
          <FormActions>
            {pending && (
              <PendingButton type="button" pending={busy === "save"} pendingLabel={m.appearance.saving} onClick={() => void save(pending.id, l.saved)}>
                {l.save}
              </PendingButton>
            )}
            {current && (
              <PendingButton type="button" variant="outline" pending={busy === "remove"} pendingLabel={l.removing} onClick={() => void save(null, l.removed)}>
                {l.remove}
              </PendingButton>
            )}
          </FormActions>
        )}
      </FormStack>
    </Block>
  );
}

/** The default theme, as radio cards with a vignette of each mode; applied only once saved, as it changes everyone's. */
function ThemeBlock({ stored, onSaved }: BlockProps) {
  const m = useStrings();
  const t = m.appearance.theme;
  const name = useId();
  const [theme, setTheme] = useState<Theme>(stored.theme ?? "default");
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors(["theme"], "appearance-theme");

  async function submit(e: FormEvent) {
    e.preventDefault();
    errors.reset();
    setBusy(true);
    try {
      // The default theme is the absence of a setting: choosing it again goes back to YASAD's default.
      await onSaved(await api.updateInstance({ theme: theme === "default" ? null : theme }), t.saved);
    } catch (err) {
      errors.failWith(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block title={t.heading}>
      <form noValidate onSubmit={submit}>
        <FormStack>
          <ErrorSummary errors={errors} labels={{ theme: t.legend }} />
          <fieldset id={errors.fieldId("theme")} aria-describedby={`${name}-hint`}>
            <legend className="sr-only">{t.legend}</legend>
            <p id={`${name}-hint`} className="mb-3 text-sm text-muted-foreground">
              {t.hint}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {THEMES.map((x) => (
                <label
                  key={x}
                  className="flex cursor-pointer flex-col overflow-hidden rounded-md border-[1.5px] border-border bg-card text-card-foreground has-checked:border-foreground has-checked:shadow-[0_0_0_2px_var(--selected)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background has-[:focus-visible]:outline-hidden"
                >
                  <span className="flex h-16 border-b border-border forced-colors:hidden">
                    <ThemeVignette mode="light" theme={x} />
                    <ThemeVignette mode="dark" theme={x} />
                  </span>
                  <span className="flex min-h-11 items-center gap-2 px-2.5 text-sm">
                    <input
                      type="radio"
                      name={name}
                      value={x}
                      checked={theme === x}
                      onChange={() => setTheme(x)}
                      className="size-4 shrink-0 cursor-pointer accent-selected outline-none"
                    />
                    {t.names[x]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormActions>
            <SubmitButton pending={busy} pendingLabel={m.appearance.saving}>
              {t.save}
            </SubmitButton>
          </FormActions>
        </FormStack>
      </form>
    </Block>
  );
}
