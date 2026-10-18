import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { type Language, LANGUAGES, readPreference, resolveLanguage, writePreference } from "../preferences";
import type { Messages } from "./en";
import { MESSAGES } from "./index";

type Locale = {
  language: Language;
  messages: Messages;
  /** Store the person's choice. */
  setLanguage: (language: Language) => void;
};

const LocaleContext = createContext<Locale | null>(null);

/** Provide the interface language, chosen from the stored choice, the browser and `defaultLanguage`. */
export function LocaleProvider({ defaultLanguage, children }: { defaultLanguage: Language; children: ReactNode }) {
  const [choice, setChoice] = useState(() => readPreference("language", LANGUAGES));
  const language = resolveLanguage(choice, navigator.languages ?? [navigator.language], defaultLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<Locale>(
    () => ({
      language,
      messages: MESSAGES[language],
      setLanguage: (next) => {
        writePreference("language", next);
        setChoice(next);
      },
    }),
    [language],
  );
  return <LocaleContext value={value}>{children}</LocaleContext>;
}

/** Return the current language and the setter. */
export function useLocale(): Locale {
  const locale = useContext(LocaleContext);
  if (!locale) throw new Error("useLocale needs a LocaleProvider");
  return locale;
}

/** Return the interface messages in the current language. */
export function useStrings(): Messages {
  return useLocale().messages;
}
