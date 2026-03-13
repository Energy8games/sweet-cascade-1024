# Server Migration Draft

Этот каталог хранит первый рабочий черновик server-side артефактов для `sweet-cascade-1024`:

- `config.json` — `GameDefinition` под `engine_mode: "lua"`.
- `script.lua` — стартовый перенос текущей клиентской математики на серверный Lua runtime.

Что уже перенесено:

- symbol set и payout table
- cluster detection
- gravity cascade
- multiplier grid progression
- base spin / free spin orchestration
- buy bonus / super buy bonus intro flow
- free-spin session persistence через `_persist_` поля
- payload shape, близкий к текущему `sdkPlayTransport.ts`

Что ещё нужно довести:

- прогнать parity против `src/runtime/sdkPlayTransport.ts`
- сверить session transitions на реальном backend runtime
- зафиксировать, нужен ли deferred credit или сохраняем current immediate-credit behavior
- решить, нужен ли отдельный shared fixture набор между Lua и DevBridge

Важно: `dev.config.ts` и `src/runtime/sdkPlayTransport.ts` остаются в проекте для dev-режима. Их задача после миграции — дублировать этот Lua contract, а не жить как отдельная математика.