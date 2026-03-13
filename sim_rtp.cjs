/* ─── RTP Simulation ─────────────────────────────────────────── */
// Usage: node sim_rtp.cjs

const GRID_COLS = 7;
const GRID_ROWS = 7;
const TOTAL_CELLS = 49;
const MIN_CLUSTER_SIZE = 5;
const MULTIPLIER_BASE = 2;
const MULTIPLIER_MAX = 1024;
const MAX_WIN_MULTIPLIER = 25000;

const FREE_SPINS_TABLE = { 3: 10, 4: 12, 5: 15, 6: 20, 7: 30 };

const REEL_SYMBOLS = [
  { id: 'major_star',    weight: 6  },
  { id: 'major_heart',   weight: 7  },
  { id: 'major_crystal', weight: 8  },
  { id: 'minor_red',     weight: 14 },
  { id: 'minor_green',   weight: 14 },
  { id: 'minor_purple',  weight: 14 },
  { id: 'minor_yellow',  weight: 14 },
];
const TOTAL_WEIGHT = REEL_SYMBOLS.reduce((s, sym) => s + sym.weight, 0);

const CLUSTER_PAYOUTS = {
  major_star:    { 5: 5,   6: 7,   7: 10,  8: 15,  9: 20,  10: 30,  11: 40,  12: 60,  13: 80,  14: 100, 15: 150 },
  major_heart:   { 5: 4,   6: 5,   7: 8,   8: 12,  9: 15,  10: 25,  11: 35,  12: 50,  13: 65,  14: 85,  15: 120 },
  major_crystal: { 5: 3,   6: 4,   7: 6,   8: 10,  9: 12,  10: 20,  11: 28,  12: 40,  13: 55,  14: 70,  15: 100 },
  minor_red:     { 5: 1.5, 6: 2,   7: 3,   8: 4,   9: 5,   10: 8,   11: 10,  12: 14,  13: 18,  14: 22,  15: 30  },
  minor_green:   { 5: 1.2, 6: 1.8, 7: 2.5, 8: 3.5, 9: 4.5, 10: 7,   11: 9,   12: 12,  13: 16,  14: 20,  15: 25  },
  minor_purple:  { 5: 1,   6: 1.5, 7: 2,   8: 3,   9: 4,   10: 6,   11: 8,   12: 10,  13: 14,  14: 18,  15: 22  },
  minor_yellow:  { 5: 0.8, 6: 1.2, 7: 1.8, 8: 2.5, 9: 3.5, 10: 5,   11: 7,   12: 9,   13: 12,  14: 16,  15: 20  },
};

/* RTP tuning factor (applied at payout calculation, not baked into table) */
const RTP_FACTOR = 0.527;

const SCATTER_PROBS_BASE = [
  { count: 7, cumProb: 0.000001 },
  { count: 6, cumProb: 0.000009 },
  { count: 5, cumProb: 0.0000475 },
  { count: 4, cumProb: 0.0002475 },
  { count: 3, cumProb: 0.003105 },
];

const SCATTER_PROBS_FS = [
  { count: 7, cumProb: 0.0000002 },
  { count: 6, cumProb: 0.000002 },
  { count: 5, cumProb: 0.00001 },
  { count: 4, cumProb: 0.00005 },
  { count: 3, cumProb: 0.000700 },
];

/* ─── Helpers ─────────────────────────────────────────────── */
function pickSymbol() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const sym of REEL_SYMBOLS) {
    r -= sym.weight;
    if (r <= 0) return sym.id;
  }
  return REEL_SYMBOLS[REEL_SYMBOLS.length - 1].id;
}

function rollScatterCount(isFreeSpins) {
  const table = isFreeSpins ? SCATTER_PROBS_FS : SCATTER_PROBS_BASE;
  const r = Math.random();
  for (const entry of table) {
    if (r < entry.cumProb) return entry.count;
  }
  return 0;
}

function generateGrid(isFreeSpins = false) {
  const grid = new Array(TOTAL_CELLS);
  const scatterPositions = new Set();
  const numScatters = rollScatterCount(isFreeSpins);
  if (numScatters > 0) {
    const cols = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 6; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const count = Math.min(numScatters, 7);
    for (let k = 0; k < count; k++) {
      const row = Math.floor(Math.random() * GRID_ROWS);
      scatterPositions.add(row * GRID_COLS + cols[k]);
    }
  }
  for (let i = 0; i < TOTAL_CELLS; i++) {
    grid[i] = scatterPositions.has(i) ? 'scatter' : pickSymbol();
  }
  return grid;
}

function cascadeGrid(grid, positionsToRemove) {
  const newGrid = [...grid];
  for (const pos of positionsToRemove) newGrid[pos] = null;
  for (let col = 0; col < GRID_COLS; col++) {
    const cells = [];
    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      const idx = row * GRID_COLS + col;
      if (newGrid[idx] !== null) cells.push(newGrid[idx]);
    }
    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      const idx = row * GRID_COLS + col;
      const fi = GRID_ROWS - 1 - row;
      newGrid[idx] = fi < cells.length ? cells[fi] : pickSymbol();
    }
  }
  return newGrid;
}

function findClusters(grid) {
  const visited = new Set();
  const clusters = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (visited.has(i) || grid[i] === 'scatter') continue;
    const sym = grid[i];
    const queue = [i];
    const group = [];
    visited.add(i);
    while (queue.length > 0) {
      const idx = queue.shift();
      group.push(idx);
      const row = Math.floor(idx / GRID_COLS);
      const col = idx % GRID_COLS;
      const neighbors = [];
      if (row > 0) neighbors.push((row - 1) * GRID_COLS + col);
      if (row < GRID_ROWS - 1) neighbors.push((row + 1) * GRID_COLS + col);
      if (col > 0) neighbors.push(row * GRID_COLS + col - 1);
      if (col < GRID_COLS - 1) neighbors.push(row * GRID_COLS + col + 1);
      for (const n of neighbors) {
        if (!visited.has(n) && grid[n] === sym) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    if (group.length >= MIN_CLUSTER_SIZE) {
      clusters.push({ symbolId: sym, positions: group, size: group.length });
    }
  }
  return clusters;
}

function getClusterPayout(symbolId, size) {
  const table = CLUSTER_PAYOUTS[symbolId];
  if (!table) return 0;
  if (size < MIN_CLUSTER_SIZE) return 0;
  return (table[Math.min(size, 15)] || 0) * RTP_FACTOR;
}

function countScatters(grid) {
  let c = 0;
  for (let i = 0; i < TOTAL_CELLS; i++) if (grid[i] === 'scatter') c++;
  return c;
}

/* ─── Multiplier Grid ─────────────────────────────────────── */
class MultiplierGrid {
  constructor() {
    this.spots = new Array(TOTAL_CELLS);
    this.reset();
  }
  reset() {
    for (let i = 0; i < TOTAL_CELLS; i++) {
      this.spots[i] = { hitCount: 0, value: 0 };
    }
  }
  initializeSuperMode() {
    for (let i = 0; i < TOTAL_CELLS; i++) {
      this.spots[i] = { hitCount: 2, value: MULTIPLIER_BASE };
    }
  }
  registerHit(pos) {
    const s = this.spots[pos];
    s.hitCount++;
    if (s.hitCount === 1) s.value = 0;           // trail
    else if (s.hitCount === 2) s.value = MULTIPLIER_BASE; // x2
    else s.value = Math.min(s.value * 2, MULTIPLIER_MAX);
  }
  registerWinningPositions(positions) {
    for (const p of positions) this.registerHit(p);
  }
  getClusterMultiplier(positions) {
    let total = 0;
    for (const p of positions) {
      if (this.spots[p].value > 0) total += this.spots[p].value;
    }
    return total > 0 ? total : 1;
  }
}

/* ─── Spin Resolver ───────────────────────────────────────── */
function resolveSpin(bet, multGrid, runningTotal = 0, isFreeSpins = false) {
  let grid = generateGrid(isFreeSpins);
  let totalWin = 0;
  let scatterCount = countScatters(grid);
  let maxWinReached = false;

  while (true) {
    const clusters = findClusters(grid);
    if (clusters.length === 0) break;

    const winPositions = new Set();
    for (const c of clusters) for (const p of c.positions) winPositions.add(p);

    multGrid.registerWinningPositions(winPositions);

    let stepWin = 0;
    for (const c of clusters) {
      const base = getClusterPayout(c.symbolId, c.size) * bet;
      const mult = multGrid.getClusterMultiplier(c.positions);
      stepWin += base * mult;
    }
    totalWin += stepWin;

    if ((runningTotal + totalWin) / bet >= MAX_WIN_MULTIPLIER) {
      totalWin = MAX_WIN_MULTIPLIER * bet - runningTotal;
      maxWinReached = true;
      break;
    }

    grid = cascadeGrid(grid, winPositions);
  }

  let freeSpinsAwarded = 0;
  for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) {
    if (scatterCount >= parseInt(cnt)) freeSpinsAwarded = spins;
  }

  return { totalWin, scatterCount, freeSpinsAwarded, maxWinReached };
}

function resolveFreeSpins(bet, initialSpins, superMode = false) {
  const multGrid = new MultiplierGrid();
  if (superMode) multGrid.initializeSuperMode();

  let remaining = initialSpins;
  let totalWin = 0;
  let maxWinReached = false;
  let totalRounds = 0;
  const MAX_ROUNDS = 500;

  while (remaining > 0 && !maxWinReached && totalRounds < MAX_ROUNDS) {
    remaining--;
    totalRounds++;
    const result = resolveSpin(bet, multGrid, totalWin, true);
    totalWin += result.totalWin;
    if (result.maxWinReached) { maxWinReached = true; break; }
    if (result.freeSpinsAwarded > 0) remaining += result.freeSpinsAwarded;
  }

  return { totalWin, maxWinReached };
}

/* ═══════════════════════════════════════════════════════════════
   SIMULATION
   ═══════════════════════════════════════════════════════════════ */
const BET = 1.0; // unit bet for RTP calculation

function runBaseSpins(n) {
  let totalBet = 0;
  let totalWin = 0;
  let freeSpinsTriggered = 0;
  let freeSpinsTotalWin = 0;

  for (let i = 0; i < n; i++) {
    const multGrid = new MultiplierGrid();
    const result = resolveSpin(BET, multGrid, 0, false);
    totalBet += BET;
    totalWin += result.totalWin;

    // If free spins triggered, simulate them (standard bonus)
    if (result.freeSpinsAwarded > 0) {
      freeSpinsTriggered++;
      const fsResult = resolveFreeSpins(BET, result.freeSpinsAwarded, false);
      totalWin += fsResult.totalWin;
      freeSpinsTotalWin += fsResult.totalWin;
    }

    if ((i + 1) % 1000000 === 0) {
      const pct = ((totalWin / totalBet) * 100).toFixed(4);
      console.log(`  Base: ${i + 1}/${n} spins, RTP so far: ${pct}%, FS triggered: ${freeSpinsTriggered}`);
    }
  }

  return { totalBet, totalWin, freeSpinsTriggered, freeSpinsTotalWin };
}

function runFreeBonus(n) {
  let totalBet = 0;
  let totalWin = 0;
  const COST = 100; // original bonus buy cost

  for (let i = 0; i < n; i++) {
    totalBet += BET * COST;
    // Standard bonus buy = guaranteed 3+ scatters → 10+ free spins
    // Roll scatter count using bonus buy weights
    const weights = [
      { count: 3, weight: 70 },
      { count: 4, weight: 18 },
      { count: 5, weight: 8 },
      { count: 6, weight: 3 },
      { count: 7, weight: 1 },
    ];
    const totalW = 100;
    let r = Math.random() * totalW;
    let numScatters = 3;
    for (const e of weights) {
      r -= e.weight;
      if (r <= 0) { numScatters = e.count; break; }
    }
    let freeSpins = 0;
    for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) {
      if (numScatters >= parseInt(cnt)) freeSpins = spins;
    }

    const fsResult = resolveFreeSpins(BET, freeSpins, false);
    totalWin += fsResult.totalWin;

    if ((i + 1) % 100000 === 0) {
      const pct = ((totalWin / totalBet) * 100).toFixed(4);
      console.log(`  FreeBuy: ${i + 1}/${n}, RTP so far: ${pct}%`);
    }
  }

  return { totalBet, totalWin };
}

function runSuperFS(n) {
  let totalBet = 0;
  let totalWin = 0;
  const COST = 500; // original super FS cost

  for (let i = 0; i < n; i++) {
    totalBet += BET * COST;
    const weights = [
      { count: 3, weight: 70 },
      { count: 4, weight: 18 },
      { count: 5, weight: 8 },
      { count: 6, weight: 3 },
      { count: 7, weight: 1 },
    ];
    const totalW = 100;
    let r = Math.random() * totalW;
    let numScatters = 3;
    for (const e of weights) {
      r -= e.weight;
      if (r <= 0) { numScatters = e.count; break; }
    }
    let freeSpins = 0;
    for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) {
      if (numScatters >= parseInt(cnt)) freeSpins = spins;
    }

    const fsResult = resolveFreeSpins(BET, freeSpins, true);
    totalWin += fsResult.totalWin;

    if ((i + 1) % 100000 === 0) {
      const pct = ((totalWin / totalBet) * 100).toFixed(4);
      console.log(`  SuperFS: ${i + 1}/${n}, RTP so far: ${pct}%`);
    }
  }

  return { totalBet, totalWin };
}

/* ─── Main ────────────────────────────────────────────────── */
console.log('═══════════════════════════════════════════');
console.log('  Sweet Cascade 1024 — RTP Simulation');
console.log('═══════════════════════════════════════════\n');

console.log('▶ Running 10M base game spins (includes natural FS triggers)...');
const base = runBaseSpins(10_000_000);
console.log(`\n  BASE GAME RESULTS:`);
console.log(`    Total bet:  $${base.totalBet.toFixed(2)}`);
console.log(`    Total win:  $${base.totalWin.toFixed(2)}`);
console.log(`    Base RTP:   ${((base.totalWin / base.totalBet) * 100).toFixed(4)}%`);
console.log(`    FS triggered: ${base.freeSpinsTriggered} (${((base.freeSpinsTriggered / 10_000_000) * 100).toFixed(4)}%)`);
console.log(`    FS contrib: $${base.freeSpinsTotalWin.toFixed(2)} (${((base.freeSpinsTotalWin / base.totalWin) * 100).toFixed(2)}% of total win)\n`);

console.log('▶ Running 1M standard bonus buy simulations...');
const freeBuy = runFreeBonus(1_000_000);
console.log(`\n  STANDARD BONUS BUY RESULTS:`);
console.log(`    Total cost: $${freeBuy.totalBet.toFixed(2)}`);
console.log(`    Total win:  $${freeBuy.totalWin.toFixed(2)}`);
console.log(`    Buy RTP:    ${((freeBuy.totalWin / freeBuy.totalBet) * 100).toFixed(4)}%\n`);

console.log('▶ Running 500K super free spins buy simulations...');
const superFs = runSuperFS(500_000);
console.log(`\n  SUPER FREE SPINS BUY RESULTS:`);
console.log(`    Total cost: $${superFs.totalBet.toFixed(2)}`);
console.log(`    Total win:  $${superFs.totalWin.toFixed(2)}`);
console.log(`    Buy RTP:    ${((superFs.totalWin / superFs.totalBet) * 100).toFixed(4)}%\n`);

console.log('═══════════════════════════════════════════');
console.log('  SUMMARY');
console.log('═══════════════════════════════════════════');
console.log(`  Base Game RTP:       ${((base.totalWin / base.totalBet) * 100).toFixed(4)}%`);
console.log(`  Standard Buy RTP:    ${((freeBuy.totalWin / freeBuy.totalBet) * 100).toFixed(4)}%`);
console.log(`  Super FS Buy RTP:    ${((superFs.totalWin / superFs.totalBet) * 100).toFixed(4)}%`);
console.log('═══════════════════════════════════════════');
