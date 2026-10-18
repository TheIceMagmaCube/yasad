import { cn } from "@/lib/utils";

/*
 * Decorative pixel-art city at sunset, on a 160 by 100 grid. The geometry is drawn once and merged into one path per
 * colour slot; light mode paints it as a warm afternoon, dark mode as dusk. The sun sits in the middle, so both a
 * tall panel (cropped at the sides) and a short strip (cropped at the top) keep it in view.
 */

const W = 160;
const H = 100;
/** First row of the street. */
const GROUND = 84;
const SUN = { cx: 80, cy: 75, r: 18 };
/** Half width of the valley under the sun, where hills and blocks stay low. */
const VALLEY = 24;

type Slot =
  | "sky0"
  | "sky1"
  | "sky2"
  | "sky3"
  | "sky4"
  | "sky5"
  | "sky6"
  | "star"
  | "starHi"
  | "cloud"
  | "sun"
  | "sunHi"
  | "bird"
  | "hill"
  | "cityFar"
  | "city"
  | "window"
  | "windowHi"
  | "tower"
  | "beacon"
  | "ground"
  | "lane"
  | "lamp"
  | "lampLight"
  | "pool";

/**
 * Colours of each slot; null leaves the slot out (no stars by day). The palette is artwork, like a picture: no text
 * or control relies on it (the signs over it carry their own background), so it stays outside the theme tokens.
 */
type Palette = Record<Slot, string | null>;

const DAY: Palette = {
  sky0: "#7fa9d4",
  sky1: "#95b9dc",
  sky2: "#adc9e2",
  sky3: "#c8d9e6",
  sky4: "#e6e3d8",
  sky5: "#f7dcb0",
  sky6: "#fcca8a",
  star: null,
  starHi: null,
  cloud: "#fffdf8",
  sun: "#ffd84d",
  sunHi: "#fff0b8",
  bird: "#4a4560",
  hill: "#a9b7cf",
  cityFar: "#7d84a3",
  city: "#4a4560",
  window: "#8fb4d6",
  windowHi: "#c8d9e6",
  tower: "#4a4560",
  beacon: "#e04a3a",
  ground: "#3a3648",
  lane: "#ffd84d",
  lamp: "#2a2734",
  lampLight: "#8c8270",
  pool: null,
};

const DUSK: Palette = {
  sky0: "#0e0d14",
  sky1: "#1b1230",
  sky2: "#2a1744",
  sky3: "#4a1f4f",
  sky4: "#8a3b4a",
  sky5: "#d8693f",
  sky6: "#ff9a3c",
  star: "#fbf5e9",
  starHi: "#ffd84d",
  cloud: "#5c2450",
  sun: "#ffd84d",
  sunHi: "#ffe58a",
  bird: "#0b0a10",
  hill: "#2a1744",
  cityFar: "#1b1230",
  city: "#0b0a10",
  window: "#ffd84d",
  windowHi: "#fbf5e9",
  tower: "#0b0a10",
  beacon: "#ff5a4d",
  ground: "#0b0a10",
  lane: "#3a3448",
  lamp: "#1e1c28",
  lampLight: "#ffd84d",
  pool: "#3b2f16",
};

/** Sky bands from the top; each boundary is dithered over two rows. */
const SKY: readonly [number, Slot][] = [
  [0, "sky0"],
  [24, "sky1"],
  [38, "sky2"],
  [50, "sky3"],
  [59, "sky4"],
  [66, "sky5"],
  [72, "sky6"],
];

/** Deterministic pseudo-random numbers, so the scene is the same on every render. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Draw the scene; later slots in the returned order paint over earlier ones. */
function draw(): [Slot, string][] {
  const paths = new Map<Slot, string[]>();
  const rect = (slot: Slot, x: number, y: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const list = paths.get(slot) ?? [];
    list.push(`M${x} ${y}h${w}v${h}h${-w}z`);
    paths.set(slot, list);
  };
  const rand = random(11);

  // Each band's slot also holds the dots dithered into the band above; slots paint in first-use order, top down.
  SKY.forEach(([top, slot], i) => {
    const bottom = SKY[i + 1]?.[0] ?? GROUND;
    rect(slot, 0, top, W, bottom - top);
    if (i === 0) return;
    for (let row = 0; row < 2; row++) {
      const y = top - 2 + row;
      for (let x = (row + y) % 2; x < W; x += row === 0 ? 4 : 2) rect(slot, x, y, 1, 1);
    }
  });

  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * 44);
    rect(i % 6 === 0 ? "starHi" : "star", x, y, 1, 1);
  }
  // Two bright stars drawn as small crosses.
  for (const [x, y] of [
    [38, 14],
    [126, 22],
  ] as const) {
    rect("starHi", x, y - 1, 1, 3);
    rect("starHi", x - 1, y, 3, 1);
  }

  for (let dy = -SUN.r; dy <= 0; dy++) {
    const half = Math.floor(Math.sqrt(SUN.r * SUN.r - dy * dy));
    // Retro gaps across the lower half of the sun.
    if (dy > -8 && (dy + 8) % 3 === 2) continue;
    rect(dy < -11 ? "sunHi" : "sun", SUN.cx - half, SUN.cy + dy, half * 2, 1);
  }

  // Long thin clouds, one of them across the sun.
  for (const [x, y, w] of [
    [12, 30, 26],
    [20, 31, 12],
    [60, 20, 20],
    [66, 21, 9],
    [82, 47, 22],
    [104, 40, 30],
    [112, 41, 16],
    [58, 64, 22],
    [86, 62, 18],
  ] as const) {
    rect("cloud", x, y, w, 1);
  }

  // A few birds heading home.
  for (const [x, y] of [
    [68, 34],
    [75, 30],
    [90, 38],
  ] as const) {
    rect("bird", x, y, 1, 1);
    rect("bird", x + 1, y + 1, 1, 1);
    rect("bird", x + 2, y, 1, 1);
  }

  // Far hills, stepped.
  let hill = 72;
  for (let x = 0; x < W; x += 4) {
    hill = Math.max(66, Math.min(76, hill + Math.floor(rand() * 5) - 2));
    const top = Math.abs(x + 2 - SUN.cx) < VALLEY ? Math.max(hill, 79) : hill;
    rect("hill", x, top, 4, GROUND - top);
  }

  // Far skyline: low blocks, no windows.
  for (let x = 0; x < W; ) {
    const w = 5 + Math.floor(rand() * 6);
    const h = Math.abs(x + w / 2 - SUN.cx) < VALLEY ? 3 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 9);
    rect("cityFar", x, GROUND - h, w, h);
    x += w;
  }

  // Near skyline, lower in the middle so the sun shows between the towers.
  for (let x = 0; x < W; ) {
    const w = 7 + Math.floor(rand() * 8);
    const centre = Math.abs(x + w / 2 - SUN.cx) < VALLEY - 2;
    const h = centre ? 3 + Math.floor(rand() * 4) : 12 + Math.floor(rand() * 22);
    const top = GROUND - h;
    rect("city", x, top, w, h);
    if (!centre && rand() > 0.55) rect("city", x + Math.floor(w / 2), top - 4, 1, 4);
    if (!centre && rand() > 0.7) rect("city", x + 1, top - 2, 3, 2);
    for (let wy = top + 2; wy < GROUND - 2; wy += 3) {
      for (let wx = x + 1; wx < x + w - 1; wx += 2) {
        const lit = rand();
        if (lit > 0.8) rect(lit > 0.95 ? "windowHi" : "window", wx, wy, 1, 1);
      }
    }
    x += w + Math.floor(rand() * 3);
  }

  // A radio tower with a red beacon, right of the sun.
  const tower = { x: 112, top: 40 };
  rect("tower", tower.x, tower.top, 2, GROUND - tower.top);
  for (let y = tower.top + 6; y < GROUND; y += 6) rect("tower", tower.x - 1, y, 4, 1);
  rect("beacon", tower.x, tower.top - 2, 2, 2);

  rect("ground", 0, GROUND, W, H - GROUND);
  // Lane marks in the middle of the street.
  for (let x = 2; x < W; x += 8) rect("lane", x, GROUND + 7, 4, 1);

  // Street lamps framing the sun, with a dithered pool of light on the pavement.
  for (const x of [52, 108]) {
    rect("lamp", x, GROUND - 14, 1, 16);
    rect("lamp", x - 1, GROUND - 15, 3, 1);
    rect("lampLight", x - 1, GROUND - 14, 3, 1);
    for (let dx = -4; dx <= 4; dx++) if ((dx + x) % 2 === 0) rect("pool", x + dx, GROUND + 2, 1, 1);
    for (let dx = -2; dx <= 2; dx++) if ((dx + x) % 2 === 1) rect("pool", x + dx, GROUND + 3, 1, 1);
  }

  return [...paths].map(([slot, parts]) => [slot, parts.join("")]);
}

const PATHS = draw();

function Scene({ palette, className }: { palette: Palette; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className={cn("size-full", className)}
    >
      {PATHS.map(([slot, d]) => {
        const fill = palette[slot];
        return fill ? <path key={slot} d={d} fill={fill} /> : null;
      })}
    </svg>
  );
}

type PixelSceneProps = {
  /** `auto` follows the light or dark mode; `dusk` keeps the dark scene, for light text drawn straight over it. */
  time?: "auto" | "dusk";
  className?: string;
};

/** Render the scene, cropped to cover its box from the bottom; it is decoration only, so forced colors drop it. */
export function PixelScene({ time = "auto", className }: PixelSceneProps) {
  return (
    <div aria-hidden="true" data-slot="pixel-scene" className={cn("overflow-hidden forced-colors:hidden", className)}>
      {time === "auto" && <Scene palette={DAY} className="block dark:hidden" />}
      <Scene palette={DUSK} className={time === "auto" ? "hidden dark:block" : "block"} />
    </div>
  );
}
