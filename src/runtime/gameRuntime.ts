import type { AudioManager, GameApplication, InputManager } from '@energy8platform/game-engine';
import type { CasinoGameSDK } from '@energy8platform/game-sdk';

let gameApplication: GameApplication | null = null;

export function setGameApplication(game: GameApplication): void {
  gameApplication = game;
}

export function getGameApplication(): GameApplication | null {
  return gameApplication;
}

export function getAudioManager(): AudioManager | null {
  return gameApplication?.audio ?? null;
}

export function getGameSdk(): CasinoGameSDK | null {
  return gameApplication?.sdk ?? null;
}

export function getInputManager(): InputManager | null {
  return gameApplication?.input ?? null;
}