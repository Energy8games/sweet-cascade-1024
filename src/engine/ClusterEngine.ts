/* ─── Cluster Detection Engine ───────────────────────────────── */
import { GRID_COLS, GRID_ROWS, MIN_CLUSTER_SIZE } from '../config/gameConfig';

export interface CellData {
  id: string;      // symbol id
  row: number;
  col: number;
}

export interface Cluster {
  symbolId: string;
  positions: number[];  // flat indices [row * GRID_COLS + col]
  size: number;
}

/**
 * Find all clusters of 5+ adjacent same-type symbols
 * using flood-fill (BFS). Horizontal + Vertical adjacency only.
 */
export function findClusters(grid: CellData[]): Cluster[] {
  const visited = new Set<number>();
  const clusters: Cluster[] = [];

  for (let i = 0; i < grid.length; i++) {
    if (visited.has(i)) continue;
    const cell = grid[i];
    if (cell.id === 'scatter') continue; // scatter forms no cluster

    const cluster = bfs(grid, i, cell.id, visited);
    if (cluster.length >= MIN_CLUSTER_SIZE) {
      clusters.push({
        symbolId: cell.id,
        positions: cluster,
        size: cluster.length,
      });
    }
  }

  return clusters;
}

function bfs(grid: CellData[], start: number, symbolId: string, visited: Set<number>): number[] {
  const queue: number[] = [start];
  const result: number[] = [];
  visited.add(start);

  while (queue.length > 0) {
    const idx = queue.shift()!;
    result.push(idx);

    const row = Math.floor(idx / GRID_COLS);
    const col = idx % GRID_COLS;

    // Check 4 neighbors (up, down, left, right)
    const neighbors = [
      row > 0 ? (row - 1) * GRID_COLS + col : -1,                    // up
      row < GRID_ROWS - 1 ? (row + 1) * GRID_COLS + col : -1,       // down
      col > 0 ? row * GRID_COLS + (col - 1) : -1,                    // left
      col < GRID_COLS - 1 ? row * GRID_COLS + (col + 1) : -1,       // right
    ];

    for (const n of neighbors) {
      if (n < 0 || visited.has(n)) continue;
      if (grid[n].id === symbolId) {
        visited.add(n);
        queue.push(n);
      }
    }
  }

  return result;
}

/**
 * Get all unique positions involved in any winning cluster
 */
export function getWinningPositions(clusters: Cluster[]): Set<number> {
  const positions = new Set<number>();
  for (const c of clusters) {
    for (const p of c.positions) positions.add(p);
  }
  return positions;
}
