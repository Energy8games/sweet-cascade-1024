/* ─── Sweet Cascade 1024 — Entry Point ───────────────────────── */
import { GameApplication, ScaleMode } from '@energy8platform/game-engine';
import { ALL_SYMBOL_IDS, DESIGN_WIDTH, DESIGN_HEIGHT } from './config/gameConfig';
import { GameScene } from './scenes/GameScene';

function showError(msg: string) {
  const d = document.getElementById('err-display');
  if (d) { d.style.display = 'block'; d.textContent += msg + '\n'; }
  console.error(msg);
}

async function bootstrap() {
  showError('[bootstrap] starting...');
  const game = new GameApplication({
    container: '#game',
    designWidth: DESIGN_WIDTH,
    designHeight: DESIGN_HEIGHT,
    scaleMode: ScaleMode.FIT,
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
    sdk: false, // offline mode — no casino SDK
    pixi: {
      backgroundColor: 0x1a0a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    },
    debug: false,
  });

  game.scenes.register('game', GameScene);

  game.on('error', (err) => {
    showError('[engine error] ' + (err?.stack ?? err));
  });

  showError('[bootstrap] calling game.start("game")...');
  try {
    await game.start('game');
    showError('[bootstrap] game.start completed OK');
  } catch (err: any) {
    showError('[bootstrap] game.start FAILED: ' + (err?.stack ?? err));
  }
}

bootstrap().catch(err => showError('[bootstrap crash] ' + (err?.stack ?? err)));
