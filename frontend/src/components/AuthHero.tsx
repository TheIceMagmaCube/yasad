import { useState } from "react";

/** One run of cells of the drawing: theme fill class, x, y, width, height on the 64 by 22 grid. */
type Cell = readonly [string, number, number, number, number];

/** A cell run that moves, with the motion-safe animation class that moves it. */
type MovingCell = readonly [...Cell, string];

const DESK: readonly Cell[] = [
  ["fill-foreground", 0, 19, 64, 1],
  ["fill-foreground", 3, 20, 2, 2],
  ["fill-foreground", 59, 20, 2, 2],
  // Books, and the cat asleep on them.
  ["fill-category-4-fill", 2, 13, 6, 2],
  ["fill-primary", 3, 15, 6, 2],
  ["fill-category-6-fill", 2, 17, 7, 2],
  ["fill-foreground", 3, 10, 5, 3],
  ["fill-foreground", 3, 9, 1, 1],
  ["fill-foreground", 7, 9, 1, 1],
  // Monitor: bezel, stand, base.
  ["fill-foreground", 21, 2, 22, 14],
  ["fill-foreground", 30, 16, 4, 2],
  ["fill-foreground", 27, 18, 10, 1],
  // Keyboard with its keys. In dark mode muted-foreground is too pale for the yellow key pressed into it, so the
  // body is mixed halfway with the page: 3:1 against the key and against the page in every theme.
  ["fill-muted-foreground dark:fill-[color-mix(in_srgb,var(--muted-foreground)_50%,var(--background))]", 10, 17, 12, 2],
  ["fill-card", 11, 17, 1, 1],
  ["fill-card", 13, 17, 1, 1],
  ["fill-card", 17, 17, 1, 1],
  ["fill-card", 19, 17, 1, 1],
  // Mug and its handle.
  ["fill-category-2-fill", 47, 14, 5, 5],
  ["fill-category-2-fill", 52, 15, 2, 1],
  ["fill-category-2-fill", 53, 16, 1, 1],
  ["fill-category-2-fill", 52, 17, 2, 1],
  // Plant pot.
  ["fill-category-6-fill", 56, 14, 7, 1],
  ["fill-category-6-fill", 57, 15, 5, 4],
];

const LEAVES: readonly Cell[] = [
  ["fill-category-5-fill", 59, 8, 1, 6],
  ["fill-category-5-fill", 57, 9, 2, 1],
  ["fill-category-5-fill", 56, 8, 1, 1],
  ["fill-category-5-fill", 60, 7, 2, 1],
  ["fill-category-5-fill", 62, 6, 1, 1],
  ["fill-category-5-fill", 60, 11, 2, 1],
];

/** Screen and face while awake: open eyes (they blink), rosy cheeks, a smile. */
const AWAKE: readonly Cell[] = [
  ["fill-category-3-fill", 23, 4, 18, 10],
  ["fill-category-4-fill", 25, 10, 2, 1],
  ["fill-category-4-fill", 37, 10, 2, 1],
  ["fill-on-fill", 28, 12, 8, 1],
  ["fill-on-fill", 27, 11, 1, 1],
  ["fill-on-fill", 36, 11, 1, 1],
];

const EYES: readonly Cell[] = [
  ["fill-on-fill", 28, 6, 1, 3],
  ["fill-on-fill", 35, 6, 1, 3],
];

/** Screen and face while asleep: dimmed screen, closed eyes, a small open mouth. */
const ASLEEP: readonly Cell[] = [
  ["fill-category-6-fill", 23, 4, 18, 10],
  ["fill-on-fill", 27, 8, 3, 1],
  ["fill-on-fill", 34, 8, 3, 1],
  ["fill-on-fill", 31, 11, 2, 2],
];

/** A 3 by 3 "z" whose top-left cell is at x, y. */
function zed(x: number, y: number): Cell[] {
  return [
    ["fill-foreground", x, y, 3, 1],
    ["fill-foreground", x + 1, y + 1, 1, 1],
    ["fill-foreground", x, y + 2, 3, 1],
  ];
}

const SNORES = [
  { cells: zed(44, 5), motion: "motion-safe:animate-[pixel-float_3s_steps(6)_infinite]" },
  { cells: zed(47, 2), motion: "motion-safe:animate-[pixel-float_3s_steps(6)_1s_infinite]" },
  { cells: zed(50, 0), motion: "motion-safe:animate-[pixel-float_3s_steps(6)_2s_infinite]" },
];

/**
 * Single cells that move in both states: steam, sparkles, the power light, a pressed key and the cat's tail. The big
 * sparkle sits right of the snores' path, so a rising "z" never passes under it.
 */
const MOVING: readonly MovingCell[] = [
  ["fill-muted-foreground", 48, 11, 1, 1, "motion-safe:animate-[pixel-steam_2.4s_steps(5)_infinite]"],
  ["fill-muted-foreground", 50, 11, 1, 1, "motion-safe:animate-[pixel-steam_2.4s_steps(5)_800ms_infinite]"],
  ["fill-muted-foreground", 49, 12, 1, 1, "motion-safe:animate-[pixel-steam_2.4s_steps(5)_1600ms_infinite]"],
  ["fill-primary", 57, 1, 1, 3, "motion-safe:animate-[pixel-twinkle_1.8s_steps(2)_infinite]"],
  ["fill-primary", 56, 2, 3, 1, "motion-safe:animate-[pixel-twinkle_1.8s_steps(2)_infinite]"],
  ["fill-primary", 16, 4, 1, 1, "motion-safe:animate-[pixel-twinkle_2.6s_steps(2)_900ms_infinite]"],
  ["fill-primary", 12, 1, 1, 1, "motion-safe:animate-[pixel-twinkle_2.2s_steps(2)_400ms_infinite]"],
  ["fill-primary", 15, 16, 1, 1, "motion-safe:animate-[pixel-type_0.5s_steps(2)_infinite]"],
  ["fill-foreground", 8, 12, 2, 1, "motion-safe:animate-[pixel-sway_2s_steps(2)_infinite]"],
];

/** The power light of the monitor, lit while awake only; on the cream bezel of dark mode, yellow would not show. */
const POWER: MovingCell = ["fill-primary dark:fill-primary-shade", 39, 14, 2, 1, "motion-safe:animate-[pixel-twinkle_3s_steps(2)_infinite]"];

function cells(list: readonly Cell[]) {
  return list.map(([fill, x, y, w, h], i) => <rect key={i} className={fill} x={x} y={y} width={w} height={h} />);
}

type AuthHeroProps = {
  /** The screen's title, rendered as its h1. */
  title: string;
  /** Light-hearted lines; one is drawn at random under the title. */
  lines: readonly string[];
  /** Draw the desk asleep, for the screen after signing out. */
  asleep?: boolean;
};

/**
 * Render the head of the sign-in and signed-out screens: a small animated pixel desk, the h1 (the screen's real
 * title, which the router focuses), then a line drawn from `lines`. The drawing only uses theme fills, and under
 * reduced motion it stands still.
 */
export function AuthHero({ title, lines, asleep = false }: AuthHeroProps) {
  // The index is drawn once per visit, not the string: a language change then shows the same line in the new
  // language instead of leaving the old one under a translated page.
  const [index] = useState(() => Math.floor(Math.random() * lines.length));
  const line = lines[index % lines.length] ?? "";
  const moving = asleep ? MOVING : [...MOVING, POWER];
  return (
    <div>
      <svg
        viewBox="0 0 64 22"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
        data-state={asleep ? "asleep" : "awake"}
        className="mb-6 block h-auto w-full forced-colors:hidden"
      >
        {cells(DESK)}
        {asleep ? (
          <>
            {cells(ASLEEP)}
            {/* The snores fade in and out while they rise; standing still, they stay shown. */}
            {SNORES.map(({ cells: z, motion }, i) => (
              <g key={i} className={`pixel-part opacity-0 motion-reduce:opacity-100 ${motion}`}>
                {cells(z)}
              </g>
            ))}
          </>
        ) : (
          <>
            {cells(AWAKE)}
            <g className="pixel-part motion-safe:animate-[pixel-blink_5s_steps(1)_infinite]">{cells(EYES)}</g>
          </>
        )}
        <g className="pixel-part motion-safe:animate-[pixel-sway_3s_steps(2)_infinite]">{cells(LEAVES)}</g>
        {moving.map(([fill, x, y, w, h, motion], i) => (
          <rect key={i} className={`pixel-part ${fill} ${motion}`} x={x} y={y} width={w} height={h} />
        ))}
      </svg>
      <h1 tabIndex={-1} className="text-pixel flex items-center gap-2 text-sm text-muted-foreground outline-none">
        <span aria-hidden="true" className="size-2 shrink-0 bg-primary forced-colors:hidden" />
        {title}
      </h1>
      <p className="text-title mt-2 text-balance">{line}</p>
    </div>
  );
}
