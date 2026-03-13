/* ─── Self-Calibrating RTP Simulation ─────────────────────────
   ONE run: sweeps FS retrigger rates, interpolates exact values,
   validates all three modes.
   Usage: node --max-old-space-size=4096 sim_calibrate.cjs
─────────────────────────────────────────────────────────────── */

const GRID_COLS = 7;
const GRID_ROWS = 7;
const TOTAL_CELLS = 49;
const MIN_CLUSTER_SIZE = 5;
const MULTIPLIER_BASE = 2;
const MULTIPLIER_MAX = 1024;
const MAX_WIN_MULTIPLIER = 25000;
const BET = 1.0;

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

/* Original paytable (untouched) */
const CLUSTER_PAYOUTS = {
  major_star:    { 5: 5,   6: 7,   7: 10,  8: 15,  9: 20,  10: 30,  11: 40,  12: 60,  13: 80,  14: 100, 15: 150 },
  major_heart:   { 5: 4,   6: 5,   7: 8,   8: 12,  9: 15,  10: 25,  11: 35,  12: 50,  13: 65,  14: 85,  15: 120 },
  major_crystal: { 5: 3,   6: 4,   7: 6,   8: 10,  9: 12,  10: 20,  11: 28,  12: 40,  13: 55,  14: 70,  15: 100 },
  minor_red:     { 5: 1.5, 6: 2,   7: 3,   8: 4,   9: 5,   10: 8,   11: 10,  12: 14,  13: 18,  14: 22,  15: 30  },
  minor_green:   { 5: 1.2, 6: 1.8, 7: 2.5, 8: 3.5, 9: 4.5, 10: 7,   11: 9,   12: 12,  13: 16,  14: 20,  15: 25  },
  minor_purple:  { 5: 1,   6: 1.5, 7: 2,   8: 3,   9: 4,   10: 6,   11: 8,   12: 10,  13: 14,  14: 18,  15: 22  },
  minor_yellow:  { 5: 0.8, 6: 1.2, 7: 1.8, 8: 2.5, 9: 3.5, 10: 5,   11: 7,   12: 9,   13: 12,  14: 16,  15: 20  },
};

const RTP_FACTOR = 0.527;

/* Base scatter probs (base game — very low retrigger in FS) */
const SCATTER_PROBS_BASE = [
  { count: 7, cumProb: 0.000001 },
  { count: 6, cumProb: 0.000009 },
  { count: 5, cumProb: 0.0000475 },
  { count: 4, cumProb: 0.0002475 },
  { count: 3, cumProb: 0.003105 },
];

/* FS scatter probs — base values, multiplied by boostFactor for bonus modes */
const SCATTER_PROBS_FS_BASE = [
  { count: 7, cumProb: 0.0000002 },
  { count: 6, cumProb: 0.000002 },
  { count: 5, cumProb: 0.00001 },
  { count: 4, cumProb: 0.00005 },
  { count: 3, cumProb: 0.000700 },
];

function makeFsScatterProbs(boostFactor) {
  return SCATTER_PROBS_FS_BASE.map(e => ({
    count: e.count,
    cumProb: Math.min(e.cumProb * boostFactor, 0.99)
  }));
}

/* ─── Helpers ─────────────────────────────────────────────── */
function pickSymbol() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const sym of REEL_SYMBOLS) { r -= sym.weight; if (r <= 0) return sym.id; }
  return REEL_SYMBOLS[REEL_SYMBOLS.length - 1].id;
}

function rollScatterCount(isFreeSpins, fsScatterProbs) {
  const table = isFreeSpins ? fsScatterProbs : SCATTER_PROBS_BASE;
  const r = Math.random();
  for (const entry of table) { if (r < entry.cumProb) return entry.count; }
  return 0;
}

function generateGrid(isFreeSpins, fsScatterProbs) {
  const grid = new Array(TOTAL_CELLS);
  const scatterPositions = new Set();
  const numScatters = rollScatterCount(isFreeSpins, fsScatterProbs);
  if (numScatters > 0) {
    const cols = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 6; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cols[i], cols[j]] = [cols[j], cols[i]]; }
    for (let k = 0; k < Math.min(numScatters, 7); k++) {
      scatterPositions.add(Math.floor(Math.random() * GRID_ROWS) * GRID_COLS + cols[k]);
    }
  }
  for (let i = 0; i < TOTAL_CELLS; i++) grid[i] = scatterPositions.has(i) ? 'scatter' : pickSymbol();
  return grid;
}

function cascadeGrid(grid, positionsToRemove) {
  const newGrid = [...grid];
  for (const pos of positionsToRemove) newGrid[pos] = null;
  for (let col = 0; col < GRID_COLS; col++) {
    const cells = [];
    for (let row = GRID_ROWS - 1; row >= 0; row--) { const idx = row * GRID_COLS + col; if (newGrid[idx] !== null) cells.push(newGrid[idx]); }
    for (let row = GRID_ROWS - 1; row >= 0; row--) { const idx = row * GRID_COLS + col; const fi = GRID_ROWS - 1 - row; newGrid[idx] = fi < cells.length ? cells[fi] : pickSymbol(); }
  }
  return newGrid;
}

function findClusters(grid) {
  const visited = new Set();
  const clusters = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (visited.has(i) || grid[i] === 'scatter') continue;
    const sym = grid[i]; const queue = [i]; const group = []; visited.add(i);
    while (queue.length > 0) {
      const idx = queue.shift(); group.push(idx);
      const row = Math.floor(idx / GRID_COLS); const col = idx % GRID_COLS;
      const neighbors = [];
      if (row > 0) neighbors.push((row - 1) * GRID_COLS + col);
      if (row < GRID_ROWS - 1) neighbors.push((row + 1) * GRID_COLS + col);
      if (col > 0) neighbors.push(row * GRID_COLS + col - 1);
      if (col < GRID_COLS - 1) neighbors.push(row * GRID_COLS + col + 1);
      for (const n of neighbors) { if (!visited.has(n) && grid[n] === sym) { visited.add(n); queue.push(n); } }
    }
    if (group.length >= MIN_CLUSTER_SIZE) clusters.push({ symbolId: sym, positions: group, size: group.length });
  }
  return clusters;
}

function getClusterPayout(symbolId, size) {
  const table = CLUSTER_PAYOUTS[symbolId];
  if (!table || size < MIN_CLUSTER_SIZE) return 0;
  return (table[Math.min(size, 15)] || 0) * RTP_FACTOR;
}

function countScatters(grid) { let c = 0; for (let i = 0; i < TOTAL_CELLS; i++) if (grid[i] === 'scatter') c++; return c; }

class MultiplierGrid {
  constructor() { this.spots = new Array(TOTAL_CELLS); this.reset(); }
  reset() { for (let i = 0; i < TOTAL_CELLS; i++) this.spots[i] = { hitCount: 0, value: 0 }; }
  initializeSuperMode() { for (let i = 0; i < TOTAL_CELLS; i++) this.spots[i] = { hitCount: 2, value: MULTIPLIER_BASE }; }
  registerHit(pos) {
    const s = this.spots[pos]; s.hitCount++;
    if (s.hitCount === 1) s.value = 0;
    else if (s.hitCount === 2) s.value = MULTIPLIER_BASE;
    else s.value = Math.min(s.value * 2, MULTIPLIER_MAX);
  }
  registerWinningPositions(positions) { for (const p of positions) this.registerHit(p); }
  getClusterMultiplier(positions) {
    let total = 0;
    for (const p of positions) if (this.spots[p].value > 0) total += this.spots[p].value;
    return total > 0 ? total : 1;
  }
}

function resolveSpin(bet, multGrid, runningTotal, fsScatterProbs, isFreeSpins) {
  let grid = generateGrid(isFreeSpins, fsScatterProbs);
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
      stepWin += base * multGrid.getClusterMultiplier(c.positions);
    }
    totalWin += stepWin;
    if ((runningTotal + totalWin) / bet >= MAX_WIN_MULTIPLIER) { totalWin = MAX_WIN_MULTIPLIER * bet - runningTotal; maxWinReached = true; break; }
    grid = cascadeGrid(grid, winPositions);
  }
  let freeSpinsAwarded = 0;
  for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) if (scatterCount >= parseInt(cnt)) freeSpinsAwarded = spins;
  return { totalWin, scatterCount, freeSpinsAwarded, maxWinReached };
}

function resolveFreeSpins(bet, initialSpins, superMode, fsScatterProbs) {
  const multGrid = new MultiplierGrid();
  if (superMode) multGrid.initializeSuperMode();
  let remaining = initialSpins;
  let totalWin = 0;
  let maxWinReached = false;
  let totalRounds = 0;
  const MAX_ROUNDS = 500;
  while (remaining > 0 && !maxWinReached && totalRounds < MAX_ROUNDS) {
    remaining--; totalRounds++;
    const result = resolveSpin(bet, multGrid, totalWin, fsScatterProbs, true);
    totalWin += result.totalWin;
    if (result.maxWinReached) { maxWinReached = true; break; }
    if (result.freeSpinsAwarded > 0) remaining += result.freeSpinsAwarded;
  }
  return { totalWin, maxWinReached };
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 1: Quick base game check (2M spins)
   ═══════════════════════════════════════════════════════════════ */
console.log('═══════════════════════════════════════════');
console.log('  Sweet Cascade 1024 — RTP Calibration');
console.log('═══════════════════════════════════════════\n');

const defaultFsProbs = makeFsScatterProbs(1);

console.log('▶ Phase 1: Base game check (2M spins)...');
let baseBet = 0, baseWin = 0;
for (let i = 0; i < 2_000_000; i++) {
  const multGrid = new MultiplierGrid();
  const result = resolveSpin(BET, multGrid, 0, defaultFsProbs, false);
  baseBet += BET; baseWin += result.totalWin;
  if (result.freeSpinsAwarded > 0) {
    const fsResult = resolveFreeSpins(BET, result.freeSpinsAwarded, false, defaultFsProbs);
    baseWin += fsResult.totalWin;
  }
}
const baseRtp = (baseWin / baseBet * 100).toFixed(2);
console.log(`  Base Game RTP: ${baseRtp}%\n`);

/* ═══════════════════════════════════════════════════════════════
   PHASE 2: Sweep FS retrigger boost for Standard Buy (cost 100×)
   ═══════════════════════════════════════════════════════════════ */
const STD_COST = 100;
const SUPER_COST = 500;
const SWEEP_SAMPLES = 150_000;

const boostValues = [1, 20, 40, 60, 80, 100, 130, 160];

console.log('▶ Phase 2: Sweeping retrigger boost for Standard Buy...');
const stdResults = [];
for (const boost of boostValues) {
  const fsProbs = makeFsScatterProbs(boost);
  let totalBet = 0, totalWin = 0;
  for (let i = 0; i < SWEEP_SAMPLES; i++) {
    totalBet += BET * STD_COST;
    const weights = [{ count: 3, weight: 70 }, { count: 4, weight: 18 }, { count: 5, weight: 8 }, { count: 6, weight: 3 }, { count: 7, weight: 1 }];
    let r = Math.random() * 100, numScatters = 3;
    for (const e of weights) { r -= e.weight; if (r <= 0) { numScatters = e.count; break; } }
    let freeSpins = 0;
    for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) if (numScatters >= parseInt(cnt)) freeSpins = spins;
    const fsResult = resolveFreeSpins(BET, freeSpins, false, fsProbs);
    totalWin += fsResult.totalWin;
  }
  const rtp = (totalWin / totalBet * 100);
  stdResults.push({ boost, rtp });
  console.log(`  Boost=${boost.toString().padStart(3)}: StdBuy RTP = ${rtp.toFixed(2)}%`);
}

console.log('\n▶ Phase 3: Sweeping retrigger boost for Super Buy...');
const superResults = [];
for (const boost of boostValues) {
  const fsProbs = makeFsScatterProbs(boost);
  let totalBet = 0, totalWin = 0;
  for (let i = 0; i < SWEEP_SAMPLES; i++) {
    totalBet += BET * SUPER_COST;
    const weights = [{ count: 3, weight: 70 }, { count: 4, weight: 18 }, { count: 5, weight: 8 }, { count: 6, weight: 3 }, { count: 7, weight: 1 }];
    let r = Math.random() * 100, numScatters = 3;
    for (const e of weights) { r -= e.weight; if (r <= 0) { numScatters = e.count; break; } }
    let freeSpins = 0;
    for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) if (numScatters >= parseInt(cnt)) freeSpins = spins;
    const fsResult = resolveFreeSpins(BET, freeSpins, true, fsProbs);
    totalWin += fsResult.totalWin;
  }
  const rtp = (totalWin / totalBet * 100);
  superResults.push({ boost, rtp });
  console.log(`  Boost=${boost.toString().padStart(3)}: SuperBuy RTP = ${rtp.toFixed(2)}%`);
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 4: Interpolate exact boost values for 96.5% target
   ═══════════════════════════════════════════════════════════════ */
const TARGET_RTP = 96.5;

function interpolateBoost(results) {
  // Find the two points bracketing 96.5%
  for (let i = 0; i < results.length - 1; i++) {
    const a = results[i], b = results[i + 1];
    if ((a.rtp <= TARGET_RTP && b.rtp >= TARGET_RTP) || (a.rtp >= TARGET_RTP && b.rtp <= TARGET_RTP)) {
      const frac = (TARGET_RTP - a.rtp) / (b.rtp - a.rtp);
      return a.boost + frac * (b.boost - a.boost);
    }
  }
  // If target not bracketed, extrapolate from last two
  const a = results[results.length - 2], b = results[results.length - 1];
  const frac = (TARGET_RTP - a.rtp) / (b.rtp - a.rtp);
  return a.boost + frac * (b.boost - a.boost);
}

const stdBoost = interpolateBoost(stdResults);
const superBoost = interpolateBoost(superResults);

console.log('\n═══════════════════════════════════════════');
console.log(`  INTERPOLATED BOOST VALUES (target ${TARGET_RTP}%):`);
console.log(`  Standard Buy boost: ${stdBoost.toFixed(1)}`);
console.log(`  Super Buy boost:    ${superBoost.toFixed(1)}`);
console.log('═══════════════════════════════════════════\n');

/* ═══════════════════════════════════════════════════════════════
   PHASE 5: Final validation with interpolated values (500K each)
   ═══════════════════════════════════════════════════════════════ */
const VALID_SAMPLES = 500_000;

console.log('▶ Phase 5: Validating with exact boost values...');

// Standard validation
const stdFsProbs = makeFsScatterProbs(stdBoost);
let stdValBet = 0, stdValWin = 0;
for (let i = 0; i < VALID_SAMPLES; i++) {
  stdValBet += BET * STD_COST;
  const weights = [{ count: 3, weight: 70 }, { count: 4, weight: 18 }, { count: 5, weight: 8 }, { count: 6, weight: 3 }, { count: 7, weight: 1 }];
  let r = Math.random() * 100, numScatters = 3;
  for (const e of weights) { r -= e.weight; if (r <= 0) { numScatters = e.count; break; } }
  let freeSpins = 0;
  for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) if (numScatters >= parseInt(cnt)) freeSpins = spins;
  stdValWin += resolveFreeSpins(BET, freeSpins, false, stdFsProbs).totalWin;
  if ((i+1) % 100000 === 0) console.log(`  StdBuy valid: ${i+1}/${VALID_SAMPLES}`);
}

// Super validation
const superFsProbs = makeFsScatterProbs(superBoost);
let superValBet = 0, superValWin = 0;
for (let i = 0; i < VALID_SAMPLES; i++) {
  superValBet += BET * SUPER_COST;
  const weights = [{ count: 3, weight: 70 }, { count: 4, weight: 18 }, { count: 5, weight: 8 }, { count: 6, weight: 3 }, { count: 7, weight: 1 }];
  let r = Math.random() * 100, numScatters = 3;
  for (const e of weights) { r -= e.weight; if (r <= 0) { numScatters = e.count; break; } }
  let freeSpins = 0;
  for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) if (numScatters >= parseInt(cnt)) freeSpins = spins;
  superValWin += resolveFreeSpins(BET, freeSpins, true, superFsProbs).totalWin;
  if ((i+1) % 100000 === 0) console.log(`  SuperBuy valid: ${i+1}/${VALID_SAMPLES}`);
}

console.log('\n═══════════════════════════════════════════');
console.log('  FINAL VALIDATED RESULTS');
console.log('═══════════════════════════════════════════');
console.log(`  Base Game RTP:       ${baseRtp}%`);
console.log(`  Standard Buy RTP:    ${(stdValWin / stdValBet * 100).toFixed(2)}% (cost ${STD_COST}×, boost ${stdBoost.toFixed(1)})`);
console.log(`  Super FS Buy RTP:    ${(superValWin / superValBet * 100).toFixed(2)}% (cost ${SUPER_COST}×, boost ${superBoost.toFixed(1)})`);
console.log('═══════════════════════════════════════════');

// Output the exact scatter probs for game config
console.log('\n▶ SCATTER_PROBS for game implementation:');
console.log(`\n  Standard Buy FS (boost=${stdBoost.toFixed(1)}):`);
const stdProbs = makeFsScatterProbs(stdBoost);
for (const e of stdProbs) console.log(`    { count: ${e.count}, cumProb: ${e.cumProb.toFixed(8)} }`);

console.log(`\n  Super Buy FS (boost=${superBoost.toFixed(1)}):`);
const sprProbs = makeFsScatterProbs(superBoost);
for (const e of sprProbs) console.log(`    { count: ${e.count}, cumProb: ${e.cumProb.toFixed(8)} }`);

console.log(`\n  Natural FS (from base game, boost=1):`);
for (const e of defaultFsProbs) console.log(`    { count: ${e.count}, cumProb: ${e.cumProb.toFixed(8)} }`);
