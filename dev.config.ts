import type { DevBridgeConfig } from '@energy8platform/game-engine';
import type { PlayParams } from '@energy8platform/game-sdk';
import { BET_STEPS, BONUS_BUY_STANDARD, BONUS_BUY_SUPER, DESIGN_HEIGHT, DESIGN_WIDTH } from './src/config/gameConfig';
import { resolveDevBridgePlay, type DevBridgeSessionStore } from './src/runtime/sdkPlayTransport';

let currentBalance = 100000;
const sessionStore: DevBridgeSessionStore = new Map();

const config: DevBridgeConfig = {
  balance: currentBalance,
  currency: 'USD',
  assetsUrl: '/',
  gameConfig: {
    id: 'sweet-cascade-1024',
    type: 'SLOT',
    betLevels: BET_STEPS,
    viewport: {
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
    },
    buy_bonus: {
      modes: {
        default: {
          cost_multiplier: BONUS_BUY_STANDARD,
          scatter_distribution: {
            3: 70,
            4: 18,
            5: 8,
            6: 3,
            7: 1,
          },
        },
        super: {
          cost_multiplier: BONUS_BUY_SUPER,
          scatter_distribution: {
            3: 70,
            4: 18,
            5: 8,
            6: 3,
            7: 1,
          },
        },
      },
    },
    actions: {
      spin: {
        stage: 'base_game',
        debit: 'bet',
        credit: 'win',
        transitions: [
          { condition: 'always', next_actions: ['spin', 'buy_bonus', 'buy_bonus_super'] },
        ],
      },
      buy_bonus: {
        stage: 'base_game',
        debit: 'buy_bonus_cost',
        buy_bonus_mode: 'default',
        credit: 'win',
        transitions: [
          { condition: 'always', next_actions: ['free_spin'] },
        ],
      },
      buy_bonus_super: {
        stage: 'base_game',
        debit: 'buy_bonus_cost',
        buy_bonus_mode: 'super',
        credit: 'win',
        transitions: [
          { condition: 'always', next_actions: ['free_spin'] },
        ],
      },
      free_spin: {
        stage: 'free_spins',
        debit: 'none',
        credit: 'win',
        requires_session: true,
        transitions: [
          { condition: 'always', next_actions: ['free_spin', 'spin', 'buy_bonus', 'buy_bonus_super'] },
        ],
      },
    },
  },
  onPlay: (request) => {
    const { action, bet, roundId } = request;
    const { params } = request as typeof request & { params?: PlayParams['params'] };
    const result = resolveDevBridgePlay({ action, bet, roundId, params }, currentBalance, sessionStore);
    currentBalance = result.balanceAfter ?? currentBalance;
    return result;
  },
  networkDelay: 120,
  debug: true,
};

export default config;