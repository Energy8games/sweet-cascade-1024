import { defineGameConfig } from '@energy8platform/game-engine/vite';
import type { Plugin } from 'vite';

/** Stub out optional spine dependency that the engine tries to dynamic-import */
function spineStub(): Plugin {
  return {
    name: 'stub-spine',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@esotericsoftware/spine-pixi-v8') return '\0spine-noop';
    },
    load(id) {
      if (id === '\0spine-noop') return 'export default {};';
    },
  };
}

export default defineGameConfig({
  base: './',
  devBridge: true,
  devBridgeConfig: './dev.config.ts',
  vite: {
    plugins: [spineStub()],
    server: { port: 3001 },
    build: {
      target: 'esnext',
      outDir: 'dist',
      assetsInlineLimit: 0,
    },
  },
});
