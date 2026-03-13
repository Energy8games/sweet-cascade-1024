/* ─── Spin Resolver — Core Game Loop ─────────────────────────── */
import {
  getClusterPayout, FREE_SPINS_TABLE,
  MAX_WIN_MULTIPLIER, GRID_COLS, RTP_FACTOR,
} from '../config/gameConfig';
import { findClusters, getWinningPositions, type CellData, type Cluster } from './ClusterEngine';
import { cascadeGrid, generateGrid, countScatters } from './CascadeEngine';
import { MultiplierGrid, type MultiplierSpot } from './MultiplierSystem';

/* ─── Types ──────────────────────────────────────────────────── */
export interface CascadeStep {
  grid: CellData[];
  clusters: Cluster[];
  winAmount: number;
  /** Positions that were removed (exploded) */
  removedPositions: Set<number>;
  /** Multiplier changes that happened this step */
  multiplierChanges: Map<number, { newValue: number; previousValue: number }>;
  /** Per-cluster detail */
  clusterDetails: ClusterWinDetail[];
  /** Snapshot of multiplier grid state AFTER this step's hits registered */
  multiplierSnapshot: MultiplierSpot[];
}

export interface ClusterWinDetail {
  cluster: Cluster;
  basePayout: number;
  multiplier: number;
  totalPayout: number;
}

export interface SpinResult {
  /** All cascade steps (the initial grid + each subsequent cascade) */
  cascadeSteps: CascadeStep[];
  /** Total win from all cascades combined */
  totalWin: number;
  /** Total win as multiplier of bet */
  totalWinMultiplier: number;
  /** Number of scatters collected across all cascades */
  scatterCount: number;
  /** Free spins awarded (0 if none) */
  freeSpinsAwarded: number;
  /** Whether max win cap was reached */
  maxWinReached: boolean;
}

export interface FreeSpinsResult {
  /** Individual spin results within the free spins round */
  spins: SpinResult[];
  /** Total win from the entire free spins round */
  totalWin: number;
  totalWinMultiplier: number;
  /** Extra spins from retriggers */
  extraSpins: number;
  maxWinReached: boolean;
}

/* ─── Resolve a single spin (base game or free spin) ─────────── */
export function resolveSpin(
  bet: number,
  multiplierGrid: MultiplierGrid,
  maxWinCap: number = MAX_WIN_MULTIPLIER,
  runningTotal: number = 0,
  isFreeSpins: boolean = false,
  scatterBoost: number = 1,
): SpinResult {
  let grid = generateGrid(true, isFreeSpins, scatterBoost);
  const cascadeSteps: CascadeStep[] = [];
  let totalWin = 0;
  let scatterCount = countScatters(grid);
  let maxWinReached = false;

  // Run cascade loop
  let keepGoing = true;
  while (keepGoing) {
    const clusters = findClusters(grid);

    if (clusters.length === 0) {
      // No more clusters, record final grid state and stop
      cascadeSteps.push({
        grid: [...grid],
        clusters: [],
        winAmount: 0,
        removedPositions: new Set(),
        multiplierChanges: new Map(),
        clusterDetails: [],
        multiplierSnapshot: multiplierGrid.spots.map(s => ({ ...s })),
      });
      break;
    }

    const winPositions = getWinningPositions(clusters);

    // Register multiplier hits
    const multChanges = multiplierGrid.registerWinningPositions(winPositions);

    // Calculate win for each cluster
    const clusterDetails: ClusterWinDetail[] = [];
    let stepWin = 0;

    for (const cluster of clusters) {
      const basePayout = getClusterPayout(cluster.symbolId, cluster.size) * bet * RTP_FACTOR;
      const multiplier = multiplierGrid.getClusterMultiplier(cluster.positions);
      const clusterPayout = basePayout * multiplier;
      stepWin += clusterPayout;

      clusterDetails.push({
        cluster,
        basePayout,
        multiplier,
        totalPayout: clusterPayout,
      });
    }

    totalWin += stepWin;

    // Check max win cap
    if ((runningTotal + totalWin) / bet >= maxWinCap) {
      totalWin = maxWinCap * bet - runningTotal;
      maxWinReached = true;
      cascadeSteps.push({
        grid: [...grid],
        clusters,
        winAmount: stepWin,
        removedPositions: winPositions,
        multiplierChanges: multChanges,
        clusterDetails,
        multiplierSnapshot: multiplierGrid.spots.map(s => ({ ...s })),
      });
      break;
    }

    cascadeSteps.push({
      grid: [...grid],
      clusters,
      winAmount: stepWin,
      removedPositions: winPositions,
      multiplierChanges: multChanges,
      clusterDetails,
      multiplierSnapshot: multiplierGrid.spots.map(s => ({ ...s })),
    });

    // Cascade: remove winning symbols, drop down, fill from top (no new scatters)
    grid = cascadeGrid(grid, winPositions, false);

    keepGoing = true; // Will break if no clusters on next iteration
  }

  // Determine free spins
  let freeSpinsAwarded = 0;
  for (const [count, spins] of Object.entries(FREE_SPINS_TABLE)) {
    if (scatterCount >= parseInt(count)) {
      freeSpinsAwarded = spins;
    }
  }

  return {
    cascadeSteps,
    totalWin,
    totalWinMultiplier: bet > 0 ? totalWin / bet : 0,
    scatterCount,
    freeSpinsAwarded,
    maxWinReached,
  };
}

/* ─── Resolve free spins round ───────────────────────────────── */
export function resolveFreeSpins(
  bet: number,
  initialSpins: number,
  superMode: boolean = false,
  scatterBoost: number = 1,
): FreeSpinsResult {
  const multiplierGrid = new MultiplierGrid();
  if (superMode) {
    multiplierGrid.initializeSuperMode();
  }

  let remainingSpins = initialSpins;
  let extraSpins = 0;
  const spins: SpinResult[] = [];
  let totalWin = 0;
  let maxWinReached = false;

  while (remainingSpins > 0 && !maxWinReached) {
    remainingSpins--;

    const spinResult = resolveSpin(bet, multiplierGrid, MAX_WIN_MULTIPLIER, totalWin, true, scatterBoost);
    spins.push(spinResult);
    totalWin += spinResult.totalWin;

    if (spinResult.maxWinReached) {
      maxWinReached = true;
      break;
    }

    // Retrigger check
    if (spinResult.freeSpinsAwarded > 0) {
      remainingSpins += spinResult.freeSpinsAwarded;
      extraSpins += spinResult.freeSpinsAwarded;
    }

    // NOTE: Multipliers do NOT reset between free spins — they persist!
  }

  return {
    spins,
    totalWin,
    totalWinMultiplier: bet > 0 ? totalWin / bet : 0,
    extraSpins,
    maxWinReached,
  };
}
