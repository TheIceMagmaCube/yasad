/** Return up to two initials of a name (first and last word), whole characters only, or "?" for an empty name. */
export function initialsOf(name: string, language: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => (word ? Array.from(word)[0]! : "");
  const initials = words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
  return initials.toLocaleUpperCase(language) || "?";
}
