import type { Language } from "../preferences";
import { en, type Messages } from "./en";
import { fr } from "./fr";

/** Interface messages of each language. */
export const MESSAGES: Record<Language, Messages> = { en, fr };
