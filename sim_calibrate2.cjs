/* Fine-grained retrigger boost calibration — zoomed in on boost 15-35 */
const GRID_COLS = 7, GRID_ROWS = 7, TOTAL_CELLS = 49, MIN_CLUSTER_SIZE = 5;
const MULTIPLIER_BASE = 2, MULTIPLIER_MAX = 1024, MAX_WIN_MULTIPLIER = 25000, BET = 1.0;
const FREE_SPINS_TABLE = { 3: 10, 4: 12, 5: 15, 6: 20, 7: 30 };
const REEL_SYMBOLS = [
  { id: 'major_star', weight: 6 }, { id: 'major_heart', weight: 7 }, { id: 'major_crystal', weight: 8 },
  { id: 'minor_red', weight: 14 }, { id: 'minor_green', weight: 14 }, { id: 'minor_purple', weight: 14 }, { id: 'minor_yellow', weight: 14 },
];
const TOTAL_WEIGHT = REEL_SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
const CLUSTER_PAYOUTS = {
  major_star: { 5:5,6:7,7:10,8:15,9:20,10:30,11:40,12:60,13:80,14:100,15:150 },
  major_heart: { 5:4,6:5,7:8,8:12,9:15,10:25,11:35,12:50,13:65,14:85,15:120 },
  major_crystal: { 5:3,6:4,7:6,8:10,9:12,10:20,11:28,12:40,13:55,14:70,15:100 },
  minor_red: { 5:1.5,6:2,7:3,8:4,9:5,10:8,11:10,12:14,13:18,14:22,15:30 },
  minor_green: { 5:1.2,6:1.8,7:2.5,8:3.5,9:4.5,10:7,11:9,12:12,13:16,14:20,15:25 },
  minor_purple: { 5:1,6:1.5,7:2,8:3,9:4,10:6,11:8,12:10,13:14,14:18,15:22 },
  minor_yellow: { 5:0.8,6:1.2,7:1.8,8:2.5,9:3.5,10:5,11:7,12:9,13:12,14:16,15:20 },
};
const RTP_FACTOR = 0.527;
const SCATTER_PROBS_FS_BASE = [
  { count: 7, cumProb: 0.0000002 }, { count: 6, cumProb: 0.000002 },
  { count: 5, cumProb: 0.00001 }, { count: 4, cumProb: 0.00005 }, { count: 3, cumProb: 0.000700 },
];
function makeFsProbs(boost) { return SCATTER_PROBS_FS_BASE.map(e => ({ count: e.count, cumProb: Math.min(e.cumProb * boost, 0.99) })); }
function pickSymbol() { let r = Math.random() * TOTAL_WEIGHT; for (const sym of REEL_SYMBOLS) { r -= sym.weight; if (r <= 0) return sym.id; } return REEL_SYMBOLS[6].id; }
function rollScatter(fsProbs) { const r = Math.random(); for (const e of fsProbs) { if (r < e.cumProb) return e.count; } return 0; }
function genGrid(fsProbs) {
  const grid = new Array(TOTAL_CELLS); const sp = new Set(); const ns = rollScatter(fsProbs);
  if (ns > 0) { const cols=[0,1,2,3,4,5,6]; for(let i=6;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cols[i],cols[j]]=[cols[j],cols[i]];} for(let k=0;k<Math.min(ns,7);k++) sp.add(Math.floor(Math.random()*GRID_ROWS)*GRID_COLS+cols[k]); }
  for(let i=0;i<TOTAL_CELLS;i++) grid[i]=sp.has(i)?'scatter':pickSymbol(); return grid;
}
function cascade(grid, rem) {
  const ng=[...grid]; for(const p of rem) ng[p]=null;
  for(let c=0;c<GRID_COLS;c++){const cells=[];for(let r=GRID_ROWS-1;r>=0;r--){const i=r*GRID_COLS+c;if(ng[i]!==null)cells.push(ng[i]);}for(let r=GRID_ROWS-1;r>=0;r--){const i=r*GRID_COLS+c;const f=GRID_ROWS-1-r;ng[i]=f<cells.length?cells[f]:pickSymbol();}}return ng;
}
function findClusters(grid) {
  const vis=new Set(),cls=[];
  for(let i=0;i<TOTAL_CELLS;i++){if(vis.has(i)||grid[i]==='scatter')continue;const sym=grid[i],q=[i],g=[];vis.add(i);while(q.length>0){const idx=q.shift();g.push(idx);const row=Math.floor(idx/GRID_COLS),col=idx%GRID_COLS;const nb=[];if(row>0)nb.push((row-1)*GRID_COLS+col);if(row<GRID_ROWS-1)nb.push((row+1)*GRID_COLS+col);if(col>0)nb.push(row*GRID_COLS+col-1);if(col<GRID_COLS-1)nb.push(row*GRID_COLS+col+1);for(const n of nb)if(!vis.has(n)&&grid[n]===sym){vis.add(n);q.push(n);}}if(g.length>=MIN_CLUSTER_SIZE)cls.push({sym,pos:g,size:g.length});}return cls;
}
function getPay(sym,size){const t=CLUSTER_PAYOUTS[sym];if(!t||size<MIN_CLUSTER_SIZE)return 0;return(t[Math.min(size,15)]||0)*RTP_FACTOR;}
function countSc(grid){let c=0;for(let i=0;i<TOTAL_CELLS;i++)if(grid[i]==='scatter')c++;return c;}
class MG{constructor(){this.s=new Array(TOTAL_CELLS);this.reset();}reset(){for(let i=0;i<TOTAL_CELLS;i++)this.s[i]={h:0,v:0};}initSuper(){for(let i=0;i<TOTAL_CELLS;i++)this.s[i]={h:2,v:MULTIPLIER_BASE};}hit(p){const s=this.s[p];s.h++;if(s.h===1)s.v=0;else if(s.h===2)s.v=MULTIPLIER_BASE;else s.v=Math.min(s.v*2,MULTIPLIER_MAX);}regWin(pos){for(const p of pos)this.hit(p);}getMult(pos){let t=0;for(const p of pos)if(this.s[p].v>0)t+=this.s[p].v;return t>0?t:1;}}
function spin(bet,mg,rt,fsProbs){let grid=genGrid(fsProbs);let tw=0,sc=countSc(grid),mwr=false;
  while(true){const cls=findClusters(grid);if(cls.length===0)break;const wp=new Set();for(const c of cls)for(const p of c.pos)wp.add(p);mg.regWin(wp);let sw=0;for(const c of cls){sw+=getPay(c.sym,c.size)*bet*mg.getMult(c.pos);}tw+=sw;if((rt+tw)/bet>=MAX_WIN_MULTIPLIER){tw=MAX_WIN_MULTIPLIER*bet-rt;mwr=true;break;}grid=cascade(grid,wp);}
  let fsa=0;for(const[cnt,spins]of Object.entries(FREE_SPINS_TABLE))if(sc>=parseInt(cnt))fsa=spins;return{tw,sc,fsa,mwr};}
function resolveFS(bet,initSpins,superMode,fsProbs){const mg=new MG();if(superMode)mg.initSuper();let rem=initSpins,tw=0,mwr=false,rounds=0;
  while(rem>0&&!mwr&&rounds<500){rem--;rounds++;const r=spin(bet,mg,tw,fsProbs);tw+=r.tw;if(r.mwr){mwr=true;break;}if(r.fsa>0)rem+=r.fsa;}return{tw,mwr};}
function rollBuyScatters(){const w=[{c:3,w:70},{c:4,w:18},{c:5,w:8},{c:6,w:3},{c:7,w:1}];let r=Math.random()*100,n=3;for(const e of w){r-=e.w;if(r<=0){n=e.c;break;}}let fs=0;for(const[cnt,spins]of Object.entries(FREE_SPINS_TABLE))if(n>=parseInt(cnt))fs=spins;return fs;}

const STD_COST=100, SUPER_COST=500, N=200_000;
const boosts=[15,18,20,22,24,26,28,30,33];

console.log('═══ Fine-grained Retrigger Boost Sweep ═══\n');
console.log('▶ Standard Buy (cost 100×):');
const stdR=[];
for(const b of boosts){const fp=makeFsProbs(b);let tb=0,tw=0;for(let i=0;i<N;i++){tb+=BET*STD_COST;tw+=resolveFS(BET,rollBuyScatters(),false,fp).tw;}const rtp=tw/tb*100;stdR.push({b,rtp});console.log(`  boost=${b.toString().padStart(3)}: RTP=${rtp.toFixed(2)}%`);}

console.log('\n▶ Super Buy (cost 500×):');
const supR=[];
for(const b of boosts){const fp=makeFsProbs(b);let tb=0,tw=0;for(let i=0;i<N;i++){tb+=BET*SUPER_COST;tw+=resolveFS(BET,rollBuyScatters(),true,fp).tw;}const rtp=tw/tb*100;supR.push({b,rtp});console.log(`  boost=${b.toString().padStart(3)}: RTP=${rtp.toFixed(2)}%`);}

const T=96.5;
function interp(results){for(let i=0;i<results.length-1;i++){const a=results[i],b=results[i+1];if((a.rtp<=T&&b.rtp>=T)||(a.rtp>=T&&b.rtp<=T)){
  // Use log interpolation for exponential relationship
  const logA=Math.log(a.rtp),logB=Math.log(b.rtp),logT=Math.log(T);
  const frac=(logT-logA)/(logB-logA);return a.b+frac*(b.b-a.b);}}
  const a=results[results.length-2],b=results[results.length-1];const frac=(T-a.rtp)/(b.rtp-a.rtp);return a.b+frac*(b.b-a.b);}

const stdB=interp(stdR), supB=interp(supR);
console.log(`\n═══ RESULTS ═══`);
console.log(`  Standard Buy exact boost: ${stdB.toFixed(2)}`);
console.log(`  Super Buy exact boost:    ${supB.toFixed(2)}`);

// Final validation
console.log('\n▶ Validating (300K each)...');
const V=300_000;
{const fp=makeFsProbs(stdB);let tb=0,tw=0;for(let i=0;i<V;i++){tb+=BET*STD_COST;tw+=resolveFS(BET,rollBuyScatters(),false,fp).tw;}console.log(`  Standard Buy RTP: ${(tw/tb*100).toFixed(2)}% (boost=${stdB.toFixed(2)})`);}
{const fp=makeFsProbs(supB);let tb=0,tw=0;for(let i=0;i<V;i++){tb+=BET*SUPER_COST;tw+=resolveFS(BET,rollBuyScatters(),true,fp).tw;}console.log(`  Super Buy RTP:    ${(tw/tb*100).toFixed(2)}% (boost=${supB.toFixed(2)})`);}

// Output scatter probs
console.log('\n▶ Scatter probs for game:');
console.log(`\nStandard FS (boost=${stdB.toFixed(2)}):`);
for(const e of makeFsProbs(stdB))console.log(`  { count: ${e.count}, cumProb: ${e.cumProb} }`);
console.log(`\nSuper FS (boost=${supB.toFixed(2)}):`);
for(const e of makeFsProbs(supB))console.log(`  { count: ${e.count}, cumProb: ${e.cumProb} }`);
