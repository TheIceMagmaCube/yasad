import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Tailwind merge that knows the typography and shadow utilities of index.css. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title", "section", "caption"] }],
      shadow: [{ shadow: ["card", "raised"] }],
    },
  },
});

/** Join class names, letting later Tailwind classes override earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
