/* ─── Sweet Cascade 1024 — Game Configuration ───────────────── */

export const GRID_COLS = 7;
export const GRID_ROWS = 7;
export const TOTAL_CELLS = GRID_COLS * GRID_ROWS; // 49

/* ─── Design dimensions ─────────────────────────────────────── */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

/* ─── Cluster Pays — minimum symbols to form a cluster ──────── */
export const MIN_CLUSTER_SIZE = 5;

/* ─── Multiplier mechanics ──────────────────────────────────── */
export const MULTIPLIER_BASE = 2;
export const MULTIPLIER_MAX = 1024;

/* ─── Max win cap ─────────────────────────────────────────────── */
export const MAX_WIN_MULTIPLIER = 25000;

/* ─── Symbols ───────────────────────────────────────────────── */
export interface SymbolDef {
  id: string;
  name: string;
  tier: 'major' | 'minor' | 'scatter';
  weight: number;
  color: number;
}

export const SYMBOLS: SymbolDef[] = [
  // Majors (3)
  { id: 'major_star',    name: 'Candy Star',       tier: 'major',   weight: 6,  color: 0xff69b4 },
  { id: 'major_heart',   name: 'Jelly Heart',      tier: 'major',   weight: 7,  color: 0xff8c00 },
  { id: 'major_crystal', name: 'Crystal Gem',       tier: 'major',   weight: 8,  color: 0x00bfff },
  // Minors (4)
  { id: 'minor_red',     name: 'Red Gummy',         tier: 'minor',   weight: 14, color: 0xff4444 },
  { id: 'minor_green',   name: 'Green Gummy',       tier: 'minor',   weight: 14, color: 0x44ff44 },
  { id: 'minor_purple',  name: 'Purple Gummy',      tier: 'minor',   weight: 14, color: 0xbb44ff },
  { id: 'minor_yellow',  name: 'Yellow Gummy',      tier: 'minor',   weight: 14, color: 0xffdd44 },
  // Scatter (1)
  { id: 'scatter',       name: 'Gumball Machine',   tier: 'scatter', weight: 3,  color: 0xffd700 },
];

export const REEL_SYMBOLS = SYMBOLS.filter(s => s.tier !== 'scatter');
export const ALL_SYMBOL_IDS = SYMBOLS.map(s => s.id);

/* ─── Cluster payout table: { symbolId: { clusterSize: multiplier } }
   Cluster sizes: 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15+
───────────────────────────────────────────────────────────────── */
export const CLUSTER_PAYOUTS: Record<string, Record<number, number>> = {
  // Majors — highest payouts
  major_star:    { 5: 5,   6: 7,   7: 10,  8: 15,  9: 20,  10: 30,  11: 40,  12: 60,  13: 80,  14: 100, 15: 150 },
  major_heart:   { 5: 4,   6: 5,   7: 8,   8: 12,  9: 15,  10: 25,  11: 35,  12: 50,  13: 65,  14: 85,  15: 120 },
  major_crystal: { 5: 3,   6: 4,   7: 6,   8: 10,  9: 12,  10: 20,  11: 28,  12: 40,  13: 55,  14: 70,  15: 100 },
  // Minors — lower payouts
  minor_red:     { 5: 1.5, 6: 2,   7: 3,   8: 4,   9: 5,   10: 8,   11: 10,  12: 14,  13: 18,  14: 22,  15: 30  },
  minor_green:   { 5: 1.2, 6: 1.8, 7: 2.5, 8: 3.5, 9: 4.5, 10: 7,   11: 9,   12: 12,  13: 16,  14: 20,  15: 25  },
  minor_purple:  { 5: 1,   6: 1.5, 7: 2,   8: 3,   9: 4,   10: 6,   11: 8,   12: 10,  13: 14,  14: 18,  15: 22  },
  minor_yellow:  { 5: 0.8, 6: 1.2, 7: 1.8, 8: 2.5, 9: 3.5, 10: 5,   11: 7,   12: 9,   13: 12,  14: 16,  15: 20  },
};

/** Get payout multiplier for a symbol and cluster size */
export function getClusterPayout(symbolId: string, clusterSize: number): number {
  const table = CLUSTER_PAYOUTS[symbolId];
  if (!table) return 0;
  if (clusterSize < MIN_CLUSTER_SIZE) return 0;
  // Use the closest bracket (cap at 15+)
  const key = Math.min(clusterSize, 15);
  return table[key] ?? 0;
}

/* ─── Free spins config ─────────────────────────────────────── */
export const FREE_SPINS_TABLE: Record<number, number> = {
  3: 10,
  4: 12,
  5: 15,
  6: 20,
  7: 30,
};

/* ─── RTP tuning factor — applied to all payouts at calculation time ── */
export const RTP_FACTOR = 0.527;

/* ─── Bonus buy costs (multiplier of bet) ───────────────────── */
export const BONUS_BUY_STANDARD = 100;
export const BONUS_BUY_SUPER = 500;

/* ─── FS scatter retrigger boost (bonus buy modes get more retriggers) ─ */
export const FS_SCATTER_BOOST_STANDARD = 21.5;
export const FS_SCATTER_BOOST_SUPER = 24;

/* ─── Bet Steps ─────────────────────────────────────────────── */
export const BET_STEPS = [
  0.20, 0.40, 1.00, 2.00, 4.00, 10.00, 20.00, 50.00, 100.00, 200.00,
];

/* ─── Hit frequency target ──────────────────────────────────── */
export const TARGET_HIT_RATE = 0.30; // ~30%

/* ─── Multiplier spot color tiers ───────────────────────────── */
export const MULTIPLIER_COLORS: { max: number; color: number; glow: boolean }[] = [
  { max: 8,    color: 0xffa500, glow: false },  // Orange
  { max: 64,   color: 0xff69b4, glow: true  },  // Pink/Purple + neon
  { max: 512,  color: 0x00bfff, glow: true  },  // Electric Blue + sparks
  { max: 1024, color: 0xff4500, glow: true  },  // Fire/Rainbow + pulse
];

export function getMultiplierColor(mult: number): { color: number; glow: boolean } {
  for (const tier of MULTIPLIER_COLORS) {
    if (mult <= tier.max) return tier;
  }
  return MULTIPLIER_COLORS[MULTIPLIER_COLORS.length - 1];
}
