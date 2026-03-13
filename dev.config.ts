import type { DevBridgeConfig } from '@energy8platform/game-engine';
import { BET_STEPS, DESIGN_HEIGHT, DESIGN_WIDTH } from './src/config/gameConfig';
import { resolveDevBridgePlay } from './src/runtime/sdkPlayTransport';

let currentBalance = 100000;

const config: DevBridgeConfig = {
  balance: currentBalance,
  currency: 'USD',
  assetsUrl: '/',
  gameConfig: {
    id: 'sweet-cascade-1024',
    type: 'slot',
    betLevels: BET_STEPS,
    viewport: {
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
    },
  },
  onPlay: ({ action, bet, roundId }) => {
    const result = resolveDevBridgePlay({ action, bet, roundId }, currentBalance);
    currentBalance = result.balanceAfter ?? currentBalance;
    return result;
  },
  networkDelay: 120,
  debug: true,
};

export default config;