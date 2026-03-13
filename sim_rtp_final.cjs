/* ─── Final RTP Simulation — original payouts, original costs, scatter boost ──
   Usage: node --max-old-space-size=4096 sim_rtp_final.cjs
───────────────────────────────────────────────────────────────── */
const GRID_COLS = 7, GRID_ROWS = 7, TOTAL_CELLS = 49, MIN_CLUSTER_SIZE = 5;
const MULTIPLIER_BASE = 2, MULTIPLIER_MAX = 1024, MAX_WIN_MULTIPLIER = 25000, BET = 1.0;
const FREE_SPINS_TABLE = { 3: 10, 4: 12, 5: 15, 6: 20, 7: 30 };

const REEL_SYMBOLS = [
  { id: 'major_star', weight: 6 }, { id: 'major_heart', weight: 7 }, { id: 'major_crystal', weight: 8 },
  { id: 'minor_red', weight: 14 }, { id: 'minor_green', weight: 14 }, { id: 'minor_purple', weight: 14 }, { id: 'minor_yellow', weight: 14 },
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

/* ─── RTP & Scatter Config ─────────────────────────────────── */
const RTP_FACTOR = 0.527;
const STD_COST = 100;
const SUPER_COST = 500;
const FS_SCATTER_BOOST_STANDARD = 21.5;
const FS_SCATTER_BOOST_SUPER = 24;

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
  for (const sym of REEL_SYMBOLS) { r -= sym.weight; if (r <= 0) return sym.id; }
  return REEL_SYMBOLS[6].id;
}
function rollScatter(isFreeSpins, scatterBoost) {
  const table = isFreeSpins ? SCATTER_PROBS_FS : SCATTER_PROBS_BASE;
  const r = Math.random();
  for (const e of table) {
    const prob = scatterBoost > 1 ? Math.min(e.cumProb * scatterBoost, 0.99) : e.cumProb;
    if (r < prob) return e.count;
  }
  return 0;
}
function genGrid(isFreeSpins, scatterBoost) {
  const grid = new Array(TOTAL_CELLS);
  const sp = new Set();
  const ns = rollScatter(isFreeSpins, scatterBoost);
  if (ns > 0) {
    const cols = [0,1,2,3,4,5,6];
    for (let i = 6; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [cols[i],cols[j]]=[cols[j],cols[i]]; }
    for (let k = 0; k < Math.min(ns, 7); k++) sp.add(Math.floor(Math.random()*GRID_ROWS)*GRID_COLS+cols[k]);
  }
  for (let i = 0; i < TOTAL_CELLS; i++) grid[i] = sp.has(i) ? 'scatter' : pickSymbol();
  return grid;
}
function cascade(grid, rem) {
  const ng = [...grid];
  for (const p of rem) ng[p] = null;
  for (let c = 0; c < GRID_COLS; c++) {
    const cells = [];
    for (let r = GRID_ROWS-1; r >= 0; r--) { const i = r*GRID_COLS+c; if (ng[i]!==null) cells.push(ng[i]); }
    for (let r = GRID_ROWS-1; r >= 0; r--) { const i=r*GRID_COLS+c; const f=GRID_ROWS-1-r; ng[i]=f<cells.length?cells[f]:pickSymbol(); }
  }
  return ng;
}
function findClusters(grid) {
  const vis = new Set(), cls = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (vis.has(i) || grid[i] === 'scatter') continue;
    const sym = grid[i], q = [i], g = []; vis.add(i);
    while (q.length > 0) {
      const idx = q.shift(); g.push(idx);
      const row = Math.floor(idx/GRID_COLS), col = idx%GRID_COLS;
      const nb = [];
      if (row>0) nb.push((row-1)*GRID_COLS+col);
      if (row<GRID_ROWS-1) nb.push((row+1)*GRID_COLS+col);
      if (col>0) nb.push(row*GRID_COLS+col-1);
      if (col<GRID_COLS-1) nb.push(row*GRID_COLS+col+1);
      for (const n of nb) if (!vis.has(n) && grid[n]===sym) { vis.add(n); q.push(n); }
    }
    if (g.length >= MIN_CLUSTER_SIZE) cls.push({ sym, pos: g, size: g.length });
  }
  return cls;
}
function getPay(sym, size) {
  const t = CLUSTER_PAYOUTS[sym];
  if (!t || size < MIN_CLUSTER_SIZE) return 0;
  return (t[Math.min(size, 15)] || 0) * RTP_FACTOR;
}
function countSc(grid) { let c = 0; for (let i = 0; i < TOTAL_CELLS; i++) if (grid[i]==='scatter') c++; return c; }

class MG {
  constructor() { this.s = new Array(TOTAL_CELLS); this.reset(); }
  reset() { for (let i = 0; i < TOTAL_CELLS; i++) this.s[i] = { h: 0, v: 0 }; }
  initSuper() { for (let i = 0; i < TOTAL_CELLS; i++) this.s[i] = { h: 2, v: MULTIPLIER_BASE }; }
  hit(p) { const s=this.s[p]; s.h++; if(s.h===1)s.v=0; else if(s.h===2)s.v=MULTIPLIER_BASE; else s.v=Math.min(s.v*2,MULTIPLIER_MAX); }
  regWin(pos) { for (const p of pos) this.hit(p); }
  getMult(pos) { let t=0; for(const p of pos)if(this.s[p].v>0)t+=this.s[p].v; return t>0?t:1; }
}

function spin(bet, mg, rt, isFreeSpins, scatterBoost) {
  let grid = genGrid(isFreeSpins, scatterBoost);
  let tw = 0, sc = countSc(grid), mwr = false;
  while (true) {
    const cls = findClusters(grid);
    if (cls.length === 0) break;
    const wp = new Set();
    for (const c of cls) for (const p of c.pos) wp.add(p);
    mg.regWin(wp);
    let sw = 0;
    for (const c of cls) sw += getPay(c.sym, c.size) * bet * mg.getMult(c.pos);
    tw += sw;
    if ((rt+tw)/bet >= MAX_WIN_MULTIPLIER) { tw = MAX_WIN_MULTIPLIER*bet-rt; mwr = true; break; }
    grid = cascade(grid, wp);
  }
  let fsa = 0;
  for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) if (sc >= parseInt(cnt)) fsa = spins;
  return { tw, sc, fsa, mwr };
}

function resolveFS(bet, initSpins, superMode, scatterBoost) {
  const mg = new MG();
  if (superMode) mg.initSuper();
  let rem = initSpins, tw = 0, mwr = false, rounds = 0;
  while (rem > 0 && !mwr && rounds < 500) {
    rem--; rounds++;
    const r = spin(bet, mg, tw, true, scatterBoost);
    tw += r.tw;
    if (r.mwr) { mwr = true; break; }
    if (r.fsa > 0) rem += r.fsa;
  }
  return { tw, mwr };
}

function rollBuyScatters() {
  const w = [{c:3,w:70},{c:4,w:18},{c:5,w:8},{c:6,w:3},{c:7,w:1}];
  let r = Math.random()*100, n = 3;
  for (const e of w) { r -= e.w; if (r <= 0) { n = e.c; break; } }
  let fs = 0;
  for (const [cnt, spins] of Object.entries(FREE_SPINS_TABLE)) if (n >= parseInt(cnt)) fs = spins;
  return fs;
}

/* ═══════════════════════════════════════════════════════════════
   SIMULATION
   ═══════════════════════════════════════════════════════════════ */
console.log('═══════════════════════════════════════════');
console.log('  RTP Simulation — Original Payouts/Costs');
console.log('  + FS Scatter Boost for Bonus Buys');
console.log('═══════════════════════════════════════════\n');
console.log(`  RTP_FACTOR = ${RTP_FACTOR}`);
console.log(`  STD_COST = ${STD_COST}×, SUPER_COST = ${SUPER_COST}×`);
console.log(`  FS_BOOST_STD = ${FS_SCATTER_BOOST_STANDARD}, FS_BOOST_SUPER = ${FS_SCATTER_BOOST_SUPER}\n`);

// Phase 1: Base game (5M)
console.log('▶ Base Game (5M spins)...');
let baseBet = 0, baseWin = 0, fsTrig = 0;
for (let i = 0; i < 5_000_000; i++) {
  const mg = new MG();
  const r = spin(BET, mg, 0, false, 1);
  baseBet += BET; baseWin += r.tw;
  if (r.fsa > 0) {
    fsTrig++;
    // Natural FS: no scatter boost
    baseWin += resolveFS(BET, r.fsa, false, 1).tw;
  }
  if ((i+1) % 1000000 === 0) console.log(`  ${(i+1)/1e6}M: RTP=${(baseWin/baseBet*100).toFixed(2)}%`);
}
console.log(`  BASE RTP: ${(baseWin/baseBet*100).toFixed(4)}% (FS triggered: ${fsTrig})\n`);

// Phase 2: Standard Buy (500K)
console.log('▶ Standard Buy (500K, cost 100×, boost=' + FS_SCATTER_BOOST_STANDARD + ')...');
let stdBet = 0, stdWin = 0;
for (let i = 0; i < 500_000; i++) {
  stdBet += BET * STD_COST;
  stdWin += resolveFS(BET, rollBuyScatters(), false, FS_SCATTER_BOOST_STANDARD).tw;
  if ((i+1) % 100000 === 0) console.log(`  ${(i+1)/1000}K: RTP=${(stdWin/stdBet*100).toFixed(2)}%`);
}
console.log(`  STD BUY RTP: ${(stdWin/stdBet*100).toFixed(4)}%\n`);

// Phase 3: Super Buy (300K)
console.log('▶ Super Buy (300K, cost 500×, boost=' + FS_SCATTER_BOOST_SUPER + ')...');
let supBet = 0, supWin = 0;
for (let i = 0; i < 300_000; i++) {
  supBet += BET * SUPER_COST;
  supWin += resolveFS(BET, rollBuyScatters(), true, FS_SCATTER_BOOST_SUPER).tw;
  if ((i+1) % 100000 === 0) console.log(`  ${(i+1)/1000}K: RTP=${(supWin/supBet*100).toFixed(2)}%`);
}
console.log(`  SUPER BUY RTP: ${(supWin/supBet*100).toFixed(4)}%\n`);

console.log('═══════════════════════════════════════════');
console.log('  RESULTS');
console.log('═══════════════════════════════════════════');
console.log(`  Base Game:    ${(baseWin/baseBet*100).toFixed(2)}%`);
console.log(`  Standard Buy: ${(stdWin/stdBet*100).toFixed(2)}% (cost ${STD_COST}×)`);
console.log(`  Super Buy:    ${(supWin/supBet*100).toFixed(2)}% (cost ${SUPER_COST}×)`);
console.log('═══════════════════════════════════════════');
