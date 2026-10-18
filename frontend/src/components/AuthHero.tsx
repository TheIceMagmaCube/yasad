import { useState } from "react";

/** One cell run of the drawing: theme fill class, x, y, width, height on the 64 by 22 grid. */
type Cell = readonly [string, number, number, number, number];

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
  // Monitor: bezel, screen, stand, base.
  ["fill-foreground", 21, 2, 22, 14],
  ["fill-foreground", 30, 16, 4, 2],
  ["fill-foreground", 27, 18, 10, 1],
  // Keyboard with its keys.
  ["fill-muted-foreground", 10, 17, 12, 2],
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

/** Animated single cells: steam, sparkles, the power light, a pressed key and the cat's tail. */
const MOVING: readonly (readonly [...Cell, string])[] = [
  ["fill-muted-foreground", 48, 11, 1, 1, "motion-safe:animate-[pixel-steam_2.4s_steps(5)_infinite]"],
  ["fill-muted-foreground", 50, 11, 1, 1, "motion-safe:animate-[pixel-steam_2.4s_steps(5)_800ms_infinite]"],
  ["fill-muted-foreground", 49, 12, 1, 1, "motion-safe:animate-[pixel-steam_2.4s_steps(5)_1600ms_infinite]"],
  ["fill-primary", 45, 2, 1, 3, "motion-safe:animate-[pixel-twinkle_1.8s_steps(2)_infinite]"],
  ["fill-primary", 44, 3, 3, 1, "motion-safe:animate-[pixel-twinkle_1.8s_steps(2)_infinite]"],
  ["fill-primary", 16, 4, 1, 1, "motion-safe:animate-[pixel-twinkle_2.6s_steps(2)_900ms_infinite]"],
  ["fill-primary", 12, 1, 1, 1, "motion-safe:animate-[pixel-twinkle_2.2s_steps(2)_400ms_infinite]"],
  ["fill-primary", 39, 14, 2, 1, "motion-safe:animate-[pixel-twinkle_3s_steps(2)_infinite]"],
  ["fill-primary", 15, 16, 1, 1, "motion-safe:animate-[pixel-type_0.5s_steps(2)_infinite]"],
  ["fill-foreground", 8, 12, 2, 1, "motion-safe:animate-[pixel-sway_2s_steps(2)_infinite]"],
];

function cells(list: readonly Cell[]) {
  return list.map(([fill, x, y, w, h], i) => <rect key={i} className={fill} x={x} y={y} width={w} height={h} />);
}

/** Return one line at random; a new one comes with each visit to the screen. */
function pick(list: readonly string[]) {
  return list[Math.floor(Math.random() * list.length)] ?? "";
}

/**
 * Render the head of the screens before the app: a small animated pixel desk (awake for sign-in, asleep after
 * sign-out), the h1 (the screen's real title, which the router focuses), then a light-hearted line drawn at random
 * from `lines`. Under reduced motion the desk stands still.
 */
export function AuthHero({ title, lines, asleep = false }: { title: string; lines: readonly string[]; asleep?: boolean }) {
  const [line] = useState(() => pick(lines));
  return (
    <div>
      <svg viewBox="0 0 64 22" shapeRendering="crispEdges" aria-hidden="true" focusable="false" className="mb-6 block h-auto w-full">
        {cells(DESK)}
        {asleep ? (
          <>
            {cells(ASLEEP)}
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
        {MOVING.filter(([, x, y]) => !(asleep && x === 39 && y === 14)).map(([fill, x, y, w, h, motion], i) => (
          <rect key={i} className={`pixel-part ${fill} ${motion}`} x={x} y={y} width={w} height={h} />
        ))}
      </svg>
      <h1 tabIndex={-1} className="text-pixel flex items-center gap-2 text-sm text-muted-foreground outline-none">
        <span aria-hidden="true" className="size-2 bg-primary" />
        {title}
      </h1>
      <p className="text-title mt-2 text-balance">{line}</p>
    </div>
  );
}
