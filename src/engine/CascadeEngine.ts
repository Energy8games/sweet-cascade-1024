/* ─── Cascade / Tumble Engine ─────────────────────────────────── */
import { GRID_COLS, GRID_ROWS, TOTAL_CELLS, SYMBOLS, REEL_SYMBOLS } from '../config/gameConfig';
import type { CellData } from './ClusterEngine';

/* ── Scatter probability table (cumulative, 0→1) ─────────────
   Base game targets:
   3 scatters ≈ 1:350   → 0.002857
   4 scatters ≈ 1:5000  → 0.0002
   5 scatters ≈ 1:26000 → 0.0000385
   6 scatters ≈ 1:125000→ 0.000008
   7 scatters → extremely rare ≈ 1:1000000
   ─────────────────────────────────────────────────────────────── */
const SCATTER_PROBS_BASE = [
  { count: 7, cumProb: 0.000001 },
  { count: 6, cumProb: 0.000009 },
  { count: 5, cumProb: 0.0000475 },
  { count: 4, cumProb: 0.0002475 },
  { count: 3, cumProb: 0.003105 },
];

/** During free spins: retrigger ≈ 1:45 spins (less generous) */
const SCATTER_PROBS_FREESPINS = [
  { count: 7, cumProb: 0.0000002 },
  { count: 6, cumProb: 0.000002 },
  { count: 5, cumProb: 0.00001 },
  { count: 4, cumProb: 0.00005 },
  { count: 3, cumProb: 0.000700 },
];

/** Pick how many scatters should appear on a fresh grid */
function rollScatterCount(isFreeSpins: boolean, scatterBoost: number = 1): number {
  const table = isFreeSpins ? SCATTER_PROBS_FREESPINS : SCATTER_PROBS_BASE;
  const r = Math.random();
  for (const entry of table) {
    const prob = scatterBoost > 1 ? Math.min(entry.cumProb * scatterBoost, 0.99) : entry.cumProb;
    if (r < prob) return entry.count;
  }
  return 0; // no scatters this spin
}

/**
 * Remove winning positions from the grid and cascade remaining symbols down.
 * Fill empty spots from the top with new random symbols.
 * Returns the new grid state.
 */
export function cascadeGrid(
  grid: CellData[],
  positionsToRemove: Set<number>,
  allowScatter: boolean = true,
): CellData[] {
  const newGrid: (CellData | null)[] = [...grid];

  // 1. Remove winning symbols
  for (const pos of positionsToRemove) {
    newGrid[pos] = null;
  }

  // 2. Gravity: for each column, pull symbols down
  for (let col = 0; col < GRID_COLS; col++) {
    // Collect non-null cells in this column (bottom to top)
    const columnCells: CellData[] = [];
    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      const idx = row * GRID_COLS + col;
      if (newGrid[idx] !== null) {
        columnCells.push(newGrid[idx]!);
      }
    }

    // Place them at the bottom
    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      const idx = row * GRID_COLS + col;
      const fillIdx = GRID_ROWS - 1 - row;
      if (fillIdx < columnCells.length) {
        newGrid[idx] = { ...columnCells[fillIdx], row, col };
      } else {
        // Fill with new random symbol
        newGrid[idx] = {
          id: pickRandomSymbol(allowScatter),
          row,
          col,
        };
      }
    }
  }

  return newGrid as CellData[];
}

/**
 * Generate a fresh random grid (for initial spin).
 * Uses controlled scatter distribution instead of per-cell scatter weight.
 */
export function generateGrid(allowScatter: boolean = true, isFreeSpins: boolean = false, scatterBoost: number = 1): CellData[] {
  const grid: CellData[] = [];

  // Determine scatter positions via probability table
  const scatterPositions = new Set<number>();
  if (allowScatter) {
    const numScatters = rollScatterCount(isFreeSpins, scatterBoost);
    if (numScatters > 0) {
      // Pick unique random columns (max 1 scatter per column)
      const cols = Array.from({ length: GRID_COLS }, (_, i) => i);
      for (let i = cols.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cols[i], cols[j]] = [cols[j], cols[i]];
      }
      const count = Math.min(numScatters, GRID_COLS);
      for (let k = 0; k < count; k++) {
        const col = cols[k];
        const row = Math.floor(Math.random() * GRID_ROWS);
        scatterPositions.add(row * GRID_COLS + col);
      }
    }
  }

  for (let i = 0; i < TOTAL_CELLS; i++) {
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;
    grid.push({
      id: scatterPositions.has(i) ? 'scatter' : pickRandomSymbol(false),
      row,
      col,
    });
  }
  return grid;
}

function pickRandomSymbol(allowScatter: boolean): string {
  const pool = allowScatter ? SYMBOLS : REEL_SYMBOLS;
  const totalWeight = pool.reduce((s, sym) => s + sym.weight, 0);
  let r = Math.random() * totalWeight;
  for (const sym of pool) {
    r -= sym.weight;
    if (r <= 0) return sym.id;
  }
  return pool[pool.length - 1].id;
}

/**
 * Count scatters on the grid
 */
export function countScatters(grid: CellData[]): number {
  return grid.filter(c => c.id === 'scatter').length;
}

/* ── Bonus-buy scatter distribution (always 3+) ──────────────
   Weighted probabilities for bonus-buy:
   3 scatters: 70%
   4 scatters: 18%
   5 scatters: 8%
   6 scatters: 3%
   7 scatters: 1%
   ──────────────────────────────────────────────────────────── */
const BONUS_BUY_SCATTER_WEIGHTS = [
  { count: 3, weight: 70 },
  { count: 4, weight: 18 },
  { count: 5, weight: 8 },
  { count: 6, weight: 3 },
  { count: 7, weight: 1 },
];

/**
 * Generate a grid for bonus buy — guaranteed 3+ scatters.
 * Returns the grid with scatter positions already placed.
 */
export function generateBonusBuyGrid(): CellData[] {
  // Roll scatter count from weighted table
  const totalW = BONUS_BUY_SCATTER_WEIGHTS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * totalW;
  let numScatters = 3;
  for (const entry of BONUS_BUY_SCATTER_WEIGHTS) {
    r -= entry.weight;
    if (r <= 0) { numScatters = entry.count; break; }
  }

  // Pick scatter positions — max 1 per column
  const cols = Array.from({ length: GRID_COLS }, (_, i) => i);
  for (let i = cols.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cols[i], cols[j]] = [cols[j], cols[i]];
  }
  const count = Math.min(numScatters, GRID_COLS);
  const scatterSet = new Set<number>();
  for (let k = 0; k < count; k++) {
    const col = cols[k];
    const row = Math.floor(Math.random() * GRID_ROWS);
    scatterSet.add(row * GRID_COLS + col);
  }

  const grid: CellData[] = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    grid.push({
      id: scatterSet.has(i) ? 'scatter' : pickRandomSymbol(false),
      row: Math.floor(i / GRID_COLS),
      col: i % GRID_COLS,
    });
  }
  return grid;
}
