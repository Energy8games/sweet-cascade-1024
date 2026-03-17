/* ─── Sweet Cascade 1024 — Entry Point ───────────────────────── */
import { GameApplication, ScaleMode } from '@energy8platform/game-engine';
import { ALL_SYMBOL_IDS, DESIGN_WIDTH, DESIGN_HEIGHT } from './config/gameConfig';
import { setGameApplication } from './runtime/gameRuntime';
import { GameScene } from './scenes/GameScene';


function resolveSdkConfig(): { devMode?: boolean; debug?: boolean } {
  if (import.meta.env.DEV) {
    return {
      devMode: true,
      debug: true,
    };
  }

  return {
    debug: false,
  };
}

async function bootstrap() {
  const sdk = resolveSdkConfig();
  const game = new GameApplication({
    container: '#game',
    designWidth: DESIGN_WIDTH,
    designHeight: DESIGN_HEIGHT,
    scaleMode: ScaleMode.FILL,
    loading: {
      backgroundColor: 0x1a0a2e,
      backgroundGradient:
        'linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 50%, #1a0a2e 100%)',
      showPercentage: true,
      tapToStart: true,
      tapToStartText: 'TAP TO PLAY',
      minDisplayTime: 1500,
    },
    manifest: {
      bundles: [
        { name: 'preload', assets: [] },
        {
          name: 'game',
          assets: [
            { alias: 'bg', src: 'assets/sprites/bg.webp' },
            { alias: 'bg_freespins', src: 'assets/sprites/bg_freespins.webp' },
            { alias: 'logo', src: 'assets/sprites/logo.webp' },
            { alias: 'spin_btn', src: 'assets/sprites/spin_btn.webp' },
            // Symbols
            ...ALL_SYMBOL_IDS.map(id => ({ alias: id, src: `assets/sprites/${id}.webp` })),
            // Win overlays
            { alias: 'nice_win', src: 'assets/sprites/nice_win.webp' },
            { alias: 'big_win', src: 'assets/sprites/big_win.webp' },
            { alias: 'mega_win', src: 'assets/sprites/mega_win.webp' },
            { alias: 'epic_win', src: 'assets/sprites/epic_win.webp' },
            { alias: 'super_win', src: 'assets/sprites/super_win.webp' },
            { alias: 'coins_vfx', src: 'assets/sprites/coins_vfx.webp' },
            // UI
            { alias: 'buy_btn', src: 'assets/sprites/buy_btn.webp' },
            { alias: 'buy_super_btn', src: 'assets/sprites/buy_super_btn.webp' },
            // 3D UI assets
            { alias: 'spin_btn_3d', src: 'assets/sprites/spin_btn_3d.webp' },
            { alias: 'bottom_panel', src: 'assets/sprites/bottom_panel.webp' },
            { alias: 'btn_minus', src: 'assets/sprites/btn_minus.webp' },
            { alias: 'btn_plus', src: 'assets/sprites/btn_plus.webp' },
            { alias: 'buy_fs_box', src: 'assets/sprites/buy_fs_box.webp' },
            { alias: 'buy_super_box', src: 'assets/sprites/buy_super_box.webp' },
            { alias: 'auto_btn_cookie', src: 'assets/sprites/auto_btn_cookie.webp' },
            { alias: 'balance_frame', src: 'assets/sprites/balance_frame.webp' },
            { alias: 'scatter_glow', src: 'assets/sprites/scatter_glow.webp' },
            { alias: 'win_summary_panel', src: 'assets/sprites/win_summary_panel.webp' },
            // Audio
            { alias: 'bgm', src: 'assets/audio/bgm.mp3' },
            { alias: 'bgm_freespins', src: 'assets/audio/bgm_freespins.mp3' },
            { alias: 'bigwin_sfx', src: 'assets/audio/bigwin_sfx.mp3' },
            { alias: 'cascade_sfx', src: 'assets/audio/cascade_sfx.mp3' },
            { alias: 'cluster_pop', src: 'assets/audio/cluster_pop.mp3' },
            { alias: 'scatter_sfx', src: 'assets/audio/scatter_sfx.mp3' },
            { alias: 'spin_sfx', src: 'assets/audio/spin_sfx.mp3' },
            { alias: 'win_sfx', src: 'assets/audio/win_sfx.mp3' },
          ],
        },
      ],
    },
    audio: {
      music: 0.3,
      sfx: 0.8,
      ui: 0.8,
      persist: true,
    },
    sdk,
    pixi: {
      backgroundColor: 0x1a0a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    },
    debug: false,
  });

  setGameApplication(game);

  game.scenes.register('game', GameScene);

  game.on('error', (err) => {
    console.error('[engine error] ' + (err?.stack ?? err));
  });
  console.log(`[bootstrap] sdk mode: ${sdk.devMode ? 'dev-bridge' : 'host'}`);
  console.log ('[bootstrap] calling game.start("game")...');
  try {
    await game.start('game');
    console.log('[bootstrap] game.start completed OK');
  } catch (err: unknown) {
    console.error('[bootstrap] game.start FAILED: ' + (err instanceof Error ? err.stack ?? err.message : String(err)));
  }
}

bootstrap().catch(err => console.error('[bootstrap crash] ' + (err?.stack ?? err)));
