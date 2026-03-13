import type { PlayParams, PlayResultData, SessionData } from '@energy8platform/game-sdk';
import { BONUS_BUY_STANDARD, BONUS_BUY_SUPER, FREE_SPINS_TABLE, FS_SCATTER_BOOST_STANDARD, FS_SCATTER_BOOST_SUPER, MAX_WIN_MULTIPLIER } from '../config/gameConfig';
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

export interface StoredFreeSpinState extends FreeSpinState {
  superMode: boolean;
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

export interface DevBridgeSessionRecord {
  roundId: string;
  betAmount: number;
  spinsRemaining: number;
  spinsPlayed: number;
  totalWin: number;
  completed: boolean;
  history: SessionData['history'];
  state: StoredFreeSpinState;
}

export type DevBridgeSessionStore = Map<string, DevBridgeSessionRecord>;

const GAME_ID = 'sweet-cascade-1024';

function normalizeList<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, entry]) => entry);
}

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

function cloneMultiplierSpots(spots?: MultiplierSpot[]): MultiplierSpot[] {
  return (spots ?? []).map((spot) => ({ ...spot }));
}

function createStoredState(overrides: Partial<StoredFreeSpinState> = {}): StoredFreeSpinState {
  return {
    multiplierSpots: cloneMultiplierSpots(overrides.multiplierSpots ?? new MultiplierGrid().spots),
    scatterBoost: overrides.scatterBoost ?? 1,
    freeSpinsRemaining: overrides.freeSpinsRemaining ?? 0,
    freeSpinsTotalWin: overrides.freeSpinsTotalWin ?? 0,
    superMode: overrides.superMode ?? false,
  };
}

function createSessionRecord(roundId: string, betAmount: number, spinsRemaining: number, state: StoredFreeSpinState, totalWin = 0, spinsPlayed = 0, completed = false, history: SessionData['history'] = []): DevBridgeSessionRecord {
  return {
    roundId,
    betAmount,
    spinsRemaining,
    spinsPlayed,
    totalWin,
    completed,
    history,
    state: createStoredState({
      ...state,
      freeSpinsRemaining: spinsRemaining,
      freeSpinsTotalWin: totalWin,
    }),
  };
}

function toSessionData(record: DevBridgeSessionRecord): SessionData {
  return createSession(
    record.roundId,
    record.betAmount,
    record.spinsRemaining,
    record.totalWin,
    record.spinsPlayed,
    record.completed,
    record.history,
  );
}

function getFallbackFreeSpinState(params: PlayParams): StoredFreeSpinState {
  const state = params.params?.state as FreeSpinState | undefined;

  return createStoredState({
    multiplierSpots: state?.multiplierSpots,
    scatterBoost: state?.scatterBoost,
    freeSpinsRemaining: state?.freeSpinsRemaining,
    freeSpinsTotalWin: state?.freeSpinsTotalWin,
    superMode: false,
  });
}

function getStoredSession(roundId: string | undefined, sessionStore?: DevBridgeSessionStore): DevBridgeSessionRecord | null {
  if (!roundId || !sessionStore) {
    return null;
  }

  return sessionStore.get(roundId) ?? null;
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
  const cascadeSteps = normalizeList(result.cascadeSteps as SerializedSpinResult['cascadeSteps'] | Record<string, SerializedCascadeStep>);

  return {
    cascadeSteps: cascadeSteps.map((step) => ({
      grid: normalizeList(step.grid as SerializedCascadeStep['grid'] | Record<string, CellData>).map((cell) => ({ ...cell })),
      clusters: normalizeList(step.clusters as SerializedCascadeStep['clusters'] | Record<string, SerializedCascadeStep['clusters'][number]>).map((cluster) => ({
        symbolId: cluster.symbolId,
        positions: [...cluster.positions],
        size: cluster.size,
      })),
      winAmount: step.winAmount,
      removedPositions: new Set(normalizeList(step.removedPositions as number[] | Record<string, number>)),
      multiplierChanges: new Map(normalizeList(step.multiplierChanges as SerializedMultiplierChange[] | Record<string, SerializedMultiplierChange>).map((change) => [change.position, {
        newValue: change.newValue,
        previousValue: change.previousValue,
      }])),
      clusterDetails: normalizeList(step.clusterDetails as SerializedCascadeStep['clusterDetails'] | Record<string, SerializedCascadeStep['clusterDetails'][number]>).map((detail) => ({
        cluster: {
          symbolId: detail.cluster.symbolId,
          positions: [...detail.cluster.positions],
          size: detail.cluster.size,
        },
        basePayout: detail.basePayout,
        multiplier: detail.multiplier,
        totalPayout: detail.totalPayout,
      })),
      multiplierSnapshot: normalizeList(step.multiplierSnapshot as MultiplierSpot[] | Record<string, MultiplierSpot>).map((spot) => ({ ...spot })),
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

function getBonusBuyMode(action: PlayParams['action'], params: PlayParams['params']): { superMode: boolean; costMultiplier: number } {
  const superMode = action === 'buy_bonus_super' || Boolean(params?.superMode);

  return {
    superMode,
    costMultiplier: superMode ? BONUS_BUY_SUPER : BONUS_BUY_STANDARD,
  };
}

export function resolveDevBridgePlay(params: PlayParams, currentBalance: number, sessionStore?: DevBridgeSessionStore): Partial<PlayResultData> {
  if (params.action === 'spin') {
    const state = params.params?.state as BasePlayState | undefined;
    const multiplierGrid = toMultiplierGrid(state?.multiplierSpots);
    const spinResult = resolveSpin(params.bet, multiplierGrid, MAX_WIN_MULTIPLIER, 0, false, state?.scatterBoost ?? 1);
    const roundId = createRoundId();
    const balanceAfter = currentBalance - params.bet + spinResult.totalWin;
    const sessionRecord = spinResult.freeSpinsAwarded > 0
      ? createSessionRecord(
          roundId,
          params.bet,
          spinResult.freeSpinsAwarded,
          createStoredState({
            multiplierSpots: new MultiplierGrid().spots,
            scatterBoost: 1,
            freeSpinsRemaining: spinResult.freeSpinsAwarded,
            freeSpinsTotalWin: 0,
            superMode: false,
          }),
        )
      : null;

    if (sessionRecord && sessionStore) {
      sessionStore.set(roundId, sessionRecord);
    }

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
      nextActions: sessionRecord ? ['free_spin'] : ['spin', 'buy_bonus', 'buy_bonus_super'],
      session: sessionRecord ? toSessionData(sessionRecord) : null,
    };
  }

  if (params.action === 'free_spin') {
    const roundId = params.roundId ?? createRoundId();
    const storedSession = getStoredSession(roundId, sessionStore);
    if (storedSession?.completed) {
      throw new Error(`Session ${roundId} is already completed`);
    }

    const restoredState = storedSession?.state ?? getFallbackFreeSpinState(params);
    const multiplierGrid = toMultiplierGrid(restoredState.multiplierSpots);
    const spinResult = resolveSpin(
      params.bet,
      multiplierGrid,
      MAX_WIN_MULTIPLIER,
      restoredState.freeSpinsTotalWin ?? 0,
      true,
      restoredState.scatterBoost ?? 1,
    );
    const spinsRemaining = Math.max(0, (storedSession?.spinsRemaining ?? restoredState.freeSpinsRemaining ?? 1) - 1 + spinResult.freeSpinsAwarded);
    const spinsPlayed = (storedSession?.spinsPlayed ?? 0) + 1;
    const totalSessionWin = (storedSession?.totalWin ?? restoredState.freeSpinsTotalWin ?? 0) + spinResult.totalWin;
    const balanceAfter = currentBalance + spinResult.totalWin;
    const completed = spinsRemaining <= 0 || spinResult.maxWinReached;
    const history = [
      ...(storedSession?.history ?? []),
      {
        spinIndex: spinsPlayed,
        win: spinResult.totalWin,
        data: {
          kind: 'spin',
          spinResult: serializeSpinResult(spinResult),
          scatterBoost: restoredState.scatterBoost ?? 1,
        } satisfies SpinPlayData,
      },
    ];
    const sessionRecord = createSessionRecord(
      roundId,
      params.bet,
      spinsRemaining,
      createStoredState({
        multiplierSpots: multiplierGrid.spots,
        scatterBoost: restoredState.scatterBoost,
        freeSpinsRemaining: spinsRemaining,
        freeSpinsTotalWin: totalSessionWin,
        superMode: storedSession?.state.superMode ?? restoredState.superMode,
      }),
      totalSessionWin,
      spinsPlayed,
      completed,
      history,
    );

    if (sessionStore) {
      sessionStore.set(roundId, sessionRecord);
    }

    return {
      roundId,
      action: params.action,
      balanceAfter,
      totalWin: spinResult.totalWin,
      data: {
        kind: 'spin',
        spinResult: serializeSpinResult(spinResult),
        scatterBoost: restoredState.scatterBoost ?? 1,
      } satisfies SpinPlayData,
      nextActions: completed ? ['spin', 'buy_bonus', 'buy_bonus_super'] : ['free_spin'],
      session: toSessionData(sessionRecord),
    };
  }

  if (params.action === 'buy_bonus' || params.action === 'buy_bonus_super') {
    const { superMode, costMultiplier } = getBonusBuyMode(params.action, params.params);
    const bonusGrid = generateBonusBuyGrid();
    const scatterCount = countScatters(bonusGrid);
    const freeSpinsAwarded = FREE_SPINS_TABLE[Math.min(scatterCount, 7)] ?? 10;
    const roundId = createRoundId();
    const scatterBoost = superMode ? FS_BOOST.super : FS_BOOST.standard;
    const baseBet = typeof params.bet === 'number' ? params.bet : 0;
    const balanceAfter = currentBalance - (baseBet * costMultiplier);
    const multiplierGrid = new MultiplierGrid();
    if (superMode) {
      multiplierGrid.initializeSuperMode();
    }
    const sessionRecord = createSessionRecord(
      roundId,
      baseBet,
      freeSpinsAwarded,
      createStoredState({
        multiplierSpots: multiplierGrid.spots,
        scatterBoost,
        freeSpinsRemaining: freeSpinsAwarded,
        freeSpinsTotalWin: 0,
        superMode,
      }),
    );

    if (sessionStore) {
      sessionStore.set(roundId, sessionRecord);
    }

    return {
      roundId,
      action: params.action,
      balanceAfter,
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
      session: toSessionData(sessionRecord),
    };
  }

  throw new Error(`Unsupported play action: ${params.action}`);
}

const FS_BOOST = {
  standard: FS_SCATTER_BOOST_STANDARD,
  super: FS_SCATTER_BOOST_SUPER,
};