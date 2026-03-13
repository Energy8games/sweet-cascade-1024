/* ─── Multiplier Spots System ─────────────────────────────────── */
import { TOTAL_CELLS, MULTIPLIER_BASE, MULTIPLIER_MAX, getMultiplierColor } from '../config/gameConfig';

export interface MultiplierSpot {
  /** Number of times this cell was hit by a winning symbol */
  hitCount: number;
  /** Current multiplier value (0 = no multiplier, 2, 4, 8, ..., 1024) */
  value: number;
}

export class MultiplierGrid {
  spots: MultiplierSpot[];

  constructor() {
    this.spots = Array.from({ length: TOTAL_CELLS }, () => ({
      hitCount: 0,
      value: 0,
    }));
  }

  /**
   * Register a hit on a cell position.
   * First hit: marks the cell (hitCount=1, value=0 — just a "trail")
   * Second hit: creates x2 multiplier
   * Each subsequent hit: doubles the multiplier
   */
  registerHit(position: number): { newValue: number; previousValue: number } {
    const spot = this.spots[position];
    const previousValue = spot.value;
    spot.hitCount++;

    if (spot.hitCount === 1) {
      // First hit — just mark the spot (trail)
      spot.value = 0;
    } else if (spot.hitCount === 2) {
      // Second hit — x2
      spot.value = MULTIPLIER_BASE;
    } else {
      // Subsequent hits — double
      spot.value = Math.min(spot.value * 2, MULTIPLIER_MAX);
    }

    return { newValue: spot.value, previousValue };
  }

  /**
   * Register hits for all winning positions in a cascade step.
   * Returns positions that gained or upgraded a multiplier.
   */
  registerWinningPositions(positions: Set<number>): Map<number, { newValue: number; previousValue: number }> {
    const changes = new Map<number, { newValue: number; previousValue: number }>();
    for (const pos of positions) {
      const result = this.registerHit(pos);
      changes.set(pos, result);
    }
    return changes;
  }

  /**
   * Calculate the total multiplier for a cluster based on its positions.
   * All multipliers in the cluster are SUMMED.
   */
  getClusterMultiplier(positions: number[]): number {
    let totalMult = 0;
    for (const pos of positions) {
      if (this.spots[pos].value > 0) {
        totalMult += this.spots[pos].value;
      }
    }
    return totalMult > 0 ? totalMult : 1;
  }

  /**
   * Reset all multipliers (called at end of base game spin series)
   */
  reset(): void {
    for (const spot of this.spots) {
      spot.hitCount = 0;
      spot.value = 0;
    }
  }

  /**
   * Initialize all spots with x2 multiplier (Super Free Spins)
   */
  initializeSuperMode(): void {
    for (const spot of this.spots) {
      spot.hitCount = 2;
      spot.value = MULTIPLIER_BASE;
    }
  }

  /**
   * Check if any cell has an active multiplier
   */
  hasActiveMultipliers(): boolean {
    return this.spots.some(s => s.hitCount > 0);
  }

  /**
   * Get color/glow configuration for a specific multiplier value
   */
  getSpotVisual(position: number): { color: number; glow: boolean; value: number; hasTrail: boolean } {
    const spot = this.spots[position];
    if (spot.hitCount === 0) return { color: 0, glow: false, value: 0, hasTrail: false };
    if (spot.hitCount === 1) return { color: 0xffd700, glow: false, value: 0, hasTrail: true };
    const visual = getMultiplierColor(spot.value);
    return { ...visual, value: spot.value, hasTrail: true };
  }
}
