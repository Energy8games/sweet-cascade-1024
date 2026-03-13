import type { PlayParams, PlayResultData, SessionData } from '@energy8platform/game-sdk';
import { FREE_SPINS_TABLE, FS_SCATTER_BOOST_STANDARD, FS_SCATTER_BOOST_SUPER, MAX_WIN_MULTIPLIER } from '../config/gameConfig';
import { countScatters, generateBonusBuyGrid } from '../engine/CascadeEngine';
import type { CellData } from '../engine/ClusterEngine';
import { MultiplierGrid, type MultiplierSpot } from '../engine/MultiplierSystem';
import { resolveSpin, type SpinResult } from '../engine/SpinResolver';

export interface SerializedMultiplierChange {
  position: number;
  newValue: number;
  previousValue: number;
}

export interface SerializedCascadeStep {
  grid: CellData[];
  clusters: SpinResult['cascadeSteps'][number]['clusters'];
  winAmount: number;
  removedPositions: number[];
  multiplierChanges: SerializedMultiplierChange[];
  clusterDetails: SpinResult['cascadeSteps'][number]['clusterDetails'];
  multiplierSnapshot: MultiplierSpot[];
}

export interface SerializedSpinResult {
  cascadeSteps: SerializedCascadeStep[];
  totalWin: number;
  totalWinMultiplier: number;
  scatterCount: number;
  freeSpinsAwarded: number;
  maxWinReached: boolean;
}

export interface BasePlayState {
  multiplierSpots: MultiplierSpot[];
  scatterBoost: number;
}

export interface FreeSpinState extends BasePlayState {
  freeSpinsRemaining: number;
  freeSpinsTotalWin: number;
}

export interface BuyBonusData {
  bonusGrid: CellData[];
  scatterCount: number;
  freeSpinsAwarded: number;
  superMode: boolean;
  scatterBoost: number;
}

export interface SpinPlayData {
  kind: 'spin';
  spinResult: SerializedSpinResult;
  scatterBoost: number;
}

export interface BonusPlayData {
  kind: 'buy_bonus';
  bonus: BuyBonusData;
}

export type GamePlayData = SpinPlayData | BonusPlayData;

const GAME_ID = 'sweet-cascade-1024';

function createRoundId(): string {
  return `round_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toMultiplierGrid(spots?: MultiplierSpot[]): MultiplierGrid {
  const grid = new MultiplierGrid();
  if (!spots) {
    return grid;
  }

  grid.spots = spots.map((spot) => ({ ...spot }));
  return grid;
}

export function serializeSpinResult(result: SpinResult): SerializedSpinResult {
  return {
    cascadeSteps: result.cascadeSteps.map((step) => ({
      grid: step.grid.map((cell) => ({ ...cell })),
      clusters: step.clusters.map((cluster) => ({
        symbolId: cluster.symbolId,
        positions: [...cluster.positions],
        size: cluster.size,
      })),
      winAmount: step.winAmount,
      removedPositions: [...step.removedPositions],
      multiplierChanges: [...step.multiplierChanges.entries()].map(([position, change]) => ({
        position,
        newValue: change.newValue,
        previousValue: change.previousValue,
      })),
      clusterDetails: step.clusterDetails.map((detail) => ({
        cluster: {
          symbolId: detail.cluster.symbolId,
          positions: [...detail.cluster.positions],
          size: detail.cluster.size,
        },
        basePayout: detail.basePayout,
        multiplier: detail.multiplier,
        totalPayout: detail.totalPayout,
      })),
      multiplierSnapshot: step.multiplierSnapshot.map((spot) => ({ ...spot })),
    })),
    totalWin: result.totalWin,
    totalWinMultiplier: result.totalWinMultiplier,
    scatterCount: result.scatterCount,
    freeSpinsAwarded: result.freeSpinsAwarded,
    maxWinReached: result.maxWinReached,
  };
}

export function deserializeSpinResult(result: SerializedSpinResult): SpinResult {
  return {
    cascadeSteps: result.cascadeSteps.map((step) => ({
      grid: step.grid.map((cell) => ({ ...cell })),
      clusters: step.clusters.map((cluster) => ({
        symbolId: cluster.symbolId,
        positions: [...cluster.positions],
        size: cluster.size,
      })),
      winAmount: step.winAmount,
      removedPositions: new Set(step.removedPositions),
      multiplierChanges: new Map(step.multiplierChanges.map((change) => [change.position, {
        newValue: change.newValue,
        previousValue: change.previousValue,
      }])),
      clusterDetails: step.clusterDetails.map((detail) => ({
        cluster: {
          symbolId: detail.cluster.symbolId,
          positions: [...detail.cluster.positions],
          size: detail.cluster.size,
        },
        basePayout: detail.basePayout,
        multiplier: detail.multiplier,
        totalPayout: detail.totalPayout,
      })),
      multiplierSnapshot: step.multiplierSnapshot.map((spot) => ({ ...spot })),
    })),
    totalWin: result.totalWin,
    totalWinMultiplier: result.totalWinMultiplier,
    scatterCount: result.scatterCount,
    freeSpinsAwarded: result.freeSpinsAwarded,
    maxWinReached: result.maxWinReached,
  };
}

function createSession(roundId: string, betAmount: number, spinsRemaining: number, totalWin = 0, spinsPlayed = 0, completed = false, history: SessionData['history'] = []): SessionData {
  return {
    roundId,
    gameId: GAME_ID,
    spinsRemaining,
    spinsPlayed,
    totalWin,
    completed,
    betAmount,
    history,
  };
}

export function resolveDevBridgePlay(params: PlayParams, currentBalance: number): Partial<PlayResultData> {
  if (params.action === 'spin') {
    const state = params.params?.state as BasePlayState | undefined;
    const multiplierGrid = toMultiplierGrid(state?.multiplierSpots);
    const spinResult = resolveSpin(params.bet, multiplierGrid, MAX_WIN_MULTIPLIER, 0, false, state?.scatterBoost ?? 1);
    const roundId = createRoundId();
    const balanceAfter = currentBalance - params.bet + spinResult.totalWin;
    const session = spinResult.freeSpinsAwarded > 0
      ? createSession(roundId, params.bet, spinResult.freeSpinsAwarded)
      : null;

    return {
      roundId,
      action: params.action,
      balanceAfter,
      totalWin: spinResult.totalWin,
      data: {
        kind: 'spin',
        spinResult: serializeSpinResult(spinResult),
        scatterBoost: state?.scatterBoost ?? 1,
      } satisfies SpinPlayData,
      nextActions: session ? ['free_spin'] : ['spin', 'buy_bonus'],
      session,
    };
  }

  if (params.action === 'free_spin') {
    const state = params.params?.state as FreeSpinState | undefined;
    const multiplierGrid = toMultiplierGrid(state?.multiplierSpots);
    const spinResult = resolveSpin(params.bet, multiplierGrid, MAX_WIN_MULTIPLIER, state?.freeSpinsTotalWin ?? 0, true, state?.scatterBoost ?? 1);
    const roundId = params.roundId ?? createRoundId();
    const spinsRemaining = Math.max(0, (state?.freeSpinsRemaining ?? 1) - 1 + spinResult.freeSpinsAwarded);
    const spinsPlayed = Math.max(0, (state?.freeSpinsTotalWin ?? 0) >= 0 ? 0 : 0);
    const totalSessionWin = (state?.freeSpinsTotalWin ?? 0) + spinResult.totalWin;
    const balanceAfter = currentBalance + spinResult.totalWin;
    const completed = spinsRemaining <= 0;
    const session = createSession(
      roundId,
      params.bet,
      spinsRemaining,
      totalSessionWin,
      ((params.params?.spinsPlayed as number | undefined) ?? 0) + 1,
      completed,
      [
        ...(((params.params?.history as SessionData['history']) ?? [])),
        {
          spinIndex: (((params.params?.spinsPlayed as number | undefined) ?? 0) + 1),
          win: spinResult.totalWin,
          data: {
            kind: 'spin',
            spinResult: serializeSpinResult(spinResult),
            scatterBoost: state?.scatterBoost ?? 1,
          } satisfies SpinPlayData,
        },
      ],
    );

    return {
      roundId,
      action: params.action,
      balanceAfter,
      totalWin: spinResult.totalWin,
      data: {
        kind: 'spin',
        spinResult: serializeSpinResult(spinResult),
        scatterBoost: state?.scatterBoost ?? 1,
      } satisfies SpinPlayData,
      nextActions: completed ? ['spin', 'buy_bonus'] : ['free_spin'],
      session,
    };
  }

  if (params.action === 'buy_bonus') {
    const superMode = Boolean(params.params?.superMode);
    const bonusGrid = generateBonusBuyGrid();
    const scatterCount = countScatters(bonusGrid);
    const freeSpinsAwarded = FREE_SPINS_TABLE[Math.min(scatterCount, 7)] ?? 10;
    const roundId = createRoundId();
    const scatterBoost = superMode ? FS_BOOST.super : FS_BOOST.standard;

    return {
      roundId,
      action: params.action,
      balanceAfter: currentBalance - params.bet,
      totalWin: 0,
      data: {
        kind: 'buy_bonus',
        bonus: {
          bonusGrid,
          scatterCount,
          freeSpinsAwarded,
          superMode,
          scatterBoost,
        },
      } satisfies BonusPlayData,
      nextActions: ['free_spin'],
      session: createSession(roundId, params.params?.betAmount as number ?? 0, freeSpinsAwarded),
    };
  }

  throw new Error(`Unsupported play action: ${params.action}`);
}

const FS_BOOST = {
  standard: FS_SCATTER_BOOST_STANDARD,
  super: FS_SCATTER_BOOST_SUPER,
};