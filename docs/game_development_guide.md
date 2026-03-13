# Руководство по разработке игр

Данный документ описывает всё, что необходимо для создания собственной игры на платформе Casino Platform. Он рассчитан на сторонних разработчиков и не требует знания внутренней архитектуры платформы.

---

## Содержание

1. [Обзор платформы](#1-обзор-платформы)
2. [Структура конфигурации игры](#2-структура-конфигурации-игры)
3. [Символы](#3-символы)
4. [Барабаны и сетка](#4-барабаны-и-сетка)
   - 4.1. [Max Win Cap](#41-max-win-cap)
   - 4.2. [Symbol Weights](#42-symbol-weights-альтернатива-reel_strips)
5. [Пэйлайны и таблица выплат](#5-пэйлайны-и-таблица-выплат)
6. [Anywhere Pays (Gates-стиль)](#6-anywhere-pays-gates-стиль)
7. [Скаттеры и фриспины](#7-скаттеры-и-фриспины)
   - 7.1. [Free Spins Config](#71-free-spins-config)
8. [Buy Bonus и Ante Bet](#8-buy-bonus-и-ante-bet)
9. [Множители и типы раундов](#9-множители-и-типы-раундов)
10. [Игровая логика (JSON-движок)](#10-игровая-логика-json-движок)
    - 10.1. [Actions — определение действий](#101-actions--определение-действий-обязательно)
11. [Справочник встроенных действий](#11-справочник-встроенных-действий)
12. [GameState: состояние спина](#12-gamestate-состояние-спина)
13. [Lua: полный и гибридный режимы](#13-lua-полный-и-гибридный-режимы)
14. [Lua API Reference](#14-lua-api-reference)
15. [Валидация входа и выхода (JSON Schema)](#15-валидация-входа-и-выхода-json-schema)
16. [Клиентская интеграция (SDK)](#16-клиентская-интеграция-sdk)
17. [Деплой игры](#17-деплой-игры)
18. [Симуляция и проверка RTP](#18-симуляция-и-проверка-rtp)
19. [Соглашения и лучшие практики](#19-соглашения-и-лучшие-практики)
20. [Миграция Lua-скриптов (v2 → v3)](#20-миграция-lua-скриптов-v2--v3)
21. [Настольные игры (Table Games)](#21-настольные-игры-table-games)
    - 21.1. [Модель сессии для настольных игр](#211-модель-сессии-для-настольных-игр)
    - 21.2. [Персистентное состояние (`_persist_` конвенция)](#212-персистентное-состояние-_persist_-конвенция)
    - 21.3. [Пример: Blackjack](#213-пример-blackjack)

---

## 1. Обзор платформы

Игровой движок платформы работает на серверной стороне и принимает конфигурацию игры в формате JSON (`GameDefinition`). Бэкенд оперирует **только математикой и идентификаторами символов** — вся графика, анимация и звуки остаются на стороне клиента.

### Два режима движка

| Режим | Поле `engine_mode` | Описание |
|-------|---------------------|----------|
| **JSON** (по умолчанию) | `"json"` или не указано | No-code: вся логика описывается последовательностью шагов (actions) в JSON. Для отдельных шагов можно вызывать Lua-функции через префикс `lua:`. |
| **Lua** | `"lua"` | Полный контроль через Lua-скрипт. Скрипт экспортирует единую функцию `execute(state)`, которая получает `state.action` и `state.stage` и диспатчит логику внутри себя. |

### Два типа игр

| Тип | Поле `type` | Описание |
|-----|-------------|----------|
| **SLOT** | `"SLOT"` | Слоты — классические и видео. Сетка символов, барабаны, пэйлайны, каскады, фриспины. Поддерживаются оба режима движка. |
| **TABLE** | `"TABLE"` | Настольные игры — блэкджек, рулетка, баккара и др. Мультишаговые раунды с произвольной логикой решений. Только Lua-режим. → см. §21 |

### Два режима оценки выигрышей (слоты)

| Режим | Поле `evaluation_mode` | Описание |
|-------|------------------------|----------|
| **Paylines** (по умолчанию) | `"paylines"` или не указано | Классический — оценка совпадений слева направо по заданным линиям выплат. Поддержка Wild-символов. |
| **Anywhere Pays** | `"anywhere_pays"` | Gates-стиль — подсчёт одинаковых символов на всей сетке. Минимальное количество для выигрыша задаётся в `min_match_count`. |

### Модель безопасности

Игра загружается в iframe. Клиентский SDK взаимодействует с хостом через `postMessage`. JWT-токен **никогда не передаётся** в iframe — все API-вызовы проксируются через хост-страницу.

---

## 2. Структура конфигурации игры

Конфигурация — это JSON-файл, описывающий полную математическую модель игры. Ниже — полная схема всех доступных полей:

```
GameDefinition
├── id                          string        (обязательно) Уникальный идентификатор игры
├── type                        string        (обязательно) Категория: "SLOT" | "TABLE"
├── version                     string        Семантическая версия: "1.0.0"
├── rtp                         string        Целевой RTP: "96.5"
├── viewport                    object        (обязательно) Размер сетки
│   ├── width                   int           Количество столбцов (барабанов)
│   └── height                  int           Количество строк
│
├── engine_mode                 string        "json" (по умолчанию) | "lua"
├── script_path                 string        S3-ключ Lua-скрипта (напр. "games/my-game/script.lua")
├── stages                      string[]      Имена стейджей: ["base_game", "free_spins"]
├── bet_levels                  BetLevelsConfig  Доступные ставки (обратно совместимо)
│   │   — массив: [0.20, 0.50, 1.00]            → только список levels
│   │   — объект: {"min": 0.20, "max": 100}       → диапазон
│   │   — объект: {"levels": [...], "max": 100}  → список + лимит
│   ├── levels                  float64[]     Конкретный список допустимых ставок
│   ├── min                     float64?      Минимальная ставка (опционально)
│   └── max                     float64?      Максимальная ставка (опционально)
│
├── max_win                     object        → см. §4.1 (Max Win Cap)
│   ├── multiplier              float64       Макс. выигрыш как множитель ставки (напр. 10000)
│   └── fixed                   float64       Абсолютный лимит в валюте (напр. 500000)
│
├── symbols                     map           (обязательно) → см. §3
├── reel_strips                 map           → см. §4
├── symbol_weights              map           → см. §4.2 (альтернатива reel_strips)
├── paylines                    array         → см. §5
│
├── evaluation_mode             string        "paylines" | "anywhere_pays"
├── min_match_count             int           Минимум символов для выигрыша в anywhere_pays (по умолчанию 8)
├── anywhere_payouts            map           → см. §6
│
├── scatter_payouts             map           → см. §7
├── free_spins_trigger          map           → см. §7
├── free_spins_retrigger        map           → см. §7
├── free_spins_config           object        → см. §7.1 (persistent state, separate weights)
│   ├── persistent_state        string[]      Переменные, сохраняемые между фриспинами
│   └── use_separate_weights    bool          Использовать symbol_weights["free_spins"]
│
├── buy_bonus                   object        → см. §8
│   └── modes                   map           Режимы покупки бонуса
│       └── [mode_name]         object        Один режим (напр. "default", "super")
│           ├── cost_multiplier float64       Множитель стоимости от ставки
│           └── scatter_distribution map      Распределение скаттеров
├── ante_bet                    object        → см. §8
│
├── round_type_weights          map           → см. §9
├── symbol_chances              object        → см. §9
├── multiplier_value_weights    array         → см. §9
│
├── actions                     map           (обязательно) → см. §10.1 (ActionDefinition)
│
├── input_schema                object        → см. §15
├── output_schema               object        → см. §15
│
└── logic                       map           → см. §10
```

---

## 3. Символы

Символы описываются в поле `symbols` как словарь `имя → объект`:

```json
"symbols": {
  "CHERRY":  { "id": 1 },
  "LEMON":   { "id": 2 },
  "BAR":     { "id": 3 },
  "SEVEN":   { "id": 4 },
  "WILD":    { "id": 10, "is_wild": true },
  "SCATTER": { "id": 11, "is_scatter": true },
  "MULT_2X": { "id": 12, "is_multiplier": true, "multiplier": 2 }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | int | **(обязательно)** Уникальный числовой идентификатор символа. Используется в `reel_strips`, `paylines`, `anywhere_payouts`. |
| `is_wild` | bool | Wild-символ — заменяет любой обычный символ при оценке пэйлайнов. |
| `is_scatter` | bool | Scatter-символ — считается по всей сетке, не зависит от позиции на пэйлайне. |
| `is_multiplier` | bool | Множительный символ — его значение суммируется при каскадах (Gates-стиль). |
| `multiplier` | float64 | Значение множителя (используется только если `is_multiplier: true`). |

**Ключ словаря** (например, `"CHERRY"`) — это строковое имя символа. Оно служит для удобства чтения конфига; движок внутренне оперирует числовыми `id`.

---

## 4. Барабаны и сетка

### Reel Strips

Барабаны описываются в поле `reel_strips`. Каждый strip — массив числовых ID символов:

```json
"reel_strips": {
  "base": {
    "symbols": [1, 2, 3, 1, 4, 2, 1, 3, 10, 2, 1, 4, 3, 2, 11, 1, 3, 2, 4, 1]
  },
  "free_spins": {
    "symbols": [1, 2, 3, 10, 4, 2, 10, 3, 11, 2, 1, 4, 11, 2, 10, 1, 3, 2, 4, 1]
  }
}
```

При спине (`spin_reels`) для каждого столбца выбирается случайная позиция на strip, и из неё вырезается окно высотой `viewport.height`. Strip оборачивается циклически (wrap-around).

Все столбцы используют один и тот же strip (выбранный через поле `source` в шаге `spin_reels`). Если `source` не указан — берётся первый доступный strip.

### Fill Grid

Для игр в стиле Gates (anywhere_pays) используется действие `fill_grid`, которое заполняет сетку поячеечно с учётом `symbol_chances` и `round_type_weights`.

---

## 4.1. Max Win Cap

Поле `max_win` ограничивает максимальный выигрыш одного раунда (base game + все фриспины). Это индустриальный стандарт — Pragmatic Play, Push Gaming, Hacksaw Gaming используют аналогичный подход.

```json
"max_win": {
  "multiplier": 10000
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `multiplier` | float64 | Max win как множитель от ставки. `10000` = максимум 10 000× bet. |
| `fixed` | float64 | Абсолютный лимит в валюте. `500000` = максимум 500 000. |

Можно указать одно или оба поля. Если оба — используется меньшее: `min(bet × multiplier, fixed)`.

### Поведение (Cap & Stop)

При достижении лимита **во время спина**:
1. `TotalWin` обрезается до эффективного капа.
2. Переменная `max_win_reached` устанавливается в `1`.
3. Каскадный цикл (loop) немедленно прерывается.
4. Клиенту возвращается `"max_win_reached": true` в `data`.

При достижении лимита **во время бонус-раунда (фриспины)**:
1. Кумулятивный `TotalWin` за всю сессию обрезается до капа.
2. Бонус-сессия завершается досрочно.
3. Клиенту возвращается `max_win_reached: true` в `PlayResult` (через `session.maxWinReached`).

### Пример

При ставке 1.00 и `"multiplier": 10000`:
- Эффективный кап = 10 000.00
- Если каскады набрали TotalWin = 12 500, он обрезается до 10 000
- Фронтенд получает `max_win_reached: true` и может показать анимацию "MAX WIN"

---

## 4.2. Symbol Weights (альтернатива reel_strips)

Вместо плоского массива символов (`reel_strips`) можно задать вероятности появления символов через именованные веса. Это удобнее для настройки RTP и проще для понимания.

### Uniform (одинаковые веса для всех барабанов)

```json
"symbol_weights": {
  "base": {
    "KING": 5,
    "BANKER": 6,
    "PIRATE": 7,
    "NINJA": 8,
    "ASTRONAUT": 9,
    "CHEF": 10,
    "COOL": 11,
    "GOLDEN": 13,
    "SIMPLE": 15
  }
}
```

Каждый ключ — имя символа из `symbols`, значение — относительный вес. Вероятность символа = его вес / сумма всех весов. В примере выше: `P(KING) = 5/84 ≈ 5.95%`, `P(SIMPLE) = 15/84 ≈ 17.86%`.

### Per-Reel (индивидуальные веса для каждого барабана)

```json
"symbol_weights": {
  "base": [
    { "KING": 10, "BANKER": 8, "SIMPLE": 20 },
    { "KING": 5,  "BANKER": 12, "SIMPLE": 25 },
    { "KING": 3,  "BANKER": 15, "SIMPLE": 30 }
  ]
}
```

Массив — по одному объекту на каждый столбец (reel). Количество элементов массива должно совпадать с `viewport.width`.

### Несколько наборов весов

Можно задать веса для разных стейджей:

```json
"symbol_weights": {
  "base": { "CHERRY": 10, "LEMON": 8, "SEVEN": 2 },
  "free_spins": { "CHERRY": 8, "LEMON": 6, "SEVEN": 5 }
}
```

Действия `spin_reels`, `fill_grid`, `shift_and_fill` выбирают набор весов по параметру `source`.

### Совместимость

- Если указаны и `symbol_weights`, и `reel_strips` — приоритет у `symbol_weights`.
- Парсер автоматически генерирует `reel_strips` из весов для обратной совместимости.
- Имена символов в `symbol_weights` **должны точно совпадать** с ключами в `symbols`.
- Для Gates-стиля (`fill_grid`): символы SCATTER и MULTIPLIER **не включаются** в `symbol_weights` — они управляются через `symbol_chances`.

---

## 5. Пэйлайны и таблица выплат

Пэйлайны — это массив объектов, описывающих линии и их выплаты:

```json
"paylines": [
  {
    "positions": [1, 1, 1, 1, 1],
    "payouts": {
      "1:3": 5,
      "1:4": 20,
      "1:5": 100,
      "2:3": 3,
      "3:3": 10,
      "4:3": 15,
      "4:4": 50,
      "4:5": 200
    }
  },
  {
    "positions": [0, 0, 0, 0, 0],
    "payouts": { "1:3": 5, "2:3": 3 }
  }
]
```

### Формат позиций

`positions` — массив индексов строк (0-based), по одному на каждый столбец. Например, для сетки 5×3:
- `[1, 1, 1, 1, 1]` — средняя линия
- `[0, 0, 0, 0, 0]` — верхняя линия
- `[0, 1, 2, 1, 0]` — V-образная линия

### Формат ключей выплат

Ключ имеет формат `"symbolID:count"`, значение — множитель от ставки.

- `"1:3": 5` — символ с `id=1`, 3 совпадения подряд слева → выигрыш 5× ставки
- `"4:5": 200` — символ с `id=4`, 5 совпадений подряд → выигрыш 200× ставки

Оценка идёт **слева направо** от первого столбца. Wild-символы заменяют любой обычный символ.

---

## 6. Anywhere Pays (Gates-стиль)

Для игр с `evaluation_mode: "anywhere_pays"` позиция символов на сетке не важна — подсчитывается общее количество одинаковых символов.

```json
"evaluation_mode": "anywhere_pays",
"min_match_count": 8,

"anywhere_payouts": {
  "1": { "8": 10, "10": 25, "12": 50 },
  "2": { "8": 5,  "10": 15, "12": 30 },
  "3": { "8": 2,  "10": 8,  "12": 20 }
}
```

| Поле | Описание |
|------|----------|
| `min_match_count` | Минимальное количество одинаковых символов для выигрыша (по умолчанию 8). |
| `anywhere_payouts` | Словарь: `symbolID → { порог_количества → множитель_выплат }`. |

Пример: символ `id=1`, на сетке 10 штук → выигрыш 25× ставки (берётся наибольший подходящий порог).

---

## 7. Скаттеры и фриспины

### Scatter Payouts

```json
"scatter_payouts": {
  "3": 5,
  "4": 20,
  "5": 100
}
```

Ключ — количество scatter-символов на сетке. Значение — множитель выплаты. Scatter-выплаты **не умножаются** на текущий множитель, а добавляются к `TotalWin` напрямую.

### Free Spins Trigger

```json
"free_spins_trigger": {
  "3": 10,
  "4": 15,
  "5": 20
}
```

Ключ — количество scatter-символов. Значение — количество фриспинов.

### Free Spins Retrigger

```json
"free_spins_retrigger": {
  "3": 5,
  "4": 10,
  "5": 15
}
```

Используется действием `check_scatter_retrigger` во время бонусного раунда. Добавляет дополнительные фриспины к текущей сессии.

### 7.1. Free Spins Config

Поле `free_spins_config` управляет поведением фриспинов и персистентным состоянием:

```json
"free_spins_config": {
  "persistent_state": ["global_multiplier", "total_multiplier"],
  "use_separate_weights": false
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `persistent_state` | string[] | Список переменных из `GameState.Variables`, сохраняемых в Redis между фриспинами. По умолчанию `["global_multiplier"]`. |
| `use_separate_weights` | bool | Если `true`, фриспины используют `symbol_weights["free_spins"]` вместо `symbol_weights["base"]`. |

#### Как работает persistent state

1. При триггере фриспинов создаётся Redis-сессия (`GameSession`).
2. Перед каждым фриспином переменные из `persistent_state` восстанавливаются из сессии в `GameState.Variables`.
3. После каждого фриспина значения этих переменных сохраняются обратно в сессию.
4. Это позволяет реализовать накопительные механики (растущий множитель через серию фриспинов, как в Piggy Gates).

#### Пример: растущий множитель

```
Спин 1: global_multiplier = 1  → каскад набрал +5 → global_multiplier = 6
Спин 2: global_multiplier = 6  → каскад набрал +3 → global_multiplier = 9
Спин 3: global_multiplier = 9  → каскад набрал +10 → global_multiplier = 19
```

Без `persistent_state` множитель сбрасывался бы в 1 каждый фриспин.

#### Max Win Cap во время фриспинов

Если задан `max_win`, кумулятивный `TotalWin` всей сессии (base game + все фриспины) проверяется после каждого фриспина. При достижении лимита сессия завершается досрочно с `max_win_reached: true`.

---

## 8. Buy Bonus и Ante Bet

### Buy Bonus

Позволяет игроку купить вход в бонусный раунд напрямую, минуя случайный триггер через скаттеры. Стоимость покупки — фиксированный множитель от ставки (обычно 100×). При покупке движок **гарантирует** появление скаттеров на сетке по заданному распределению.

#### Конфигурация

```json
"buy_bonus": {
  "modes": {
    "default": {
      "cost_multiplier": 100,
      "scatter_distribution": {
        "4": 60,
        "5": 30,
        "6": 10
      }
    }
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `modes` | map[string]object | Карта режимов покупки бонуса. Ключ — идентификатор режима (например `"default"`, `"super"`). Каждый режим содержит `cost_multiplier` и `scatter_distribution`. |
| `modes.*.cost_multiplier` | float64 | Стоимость покупки как множитель от ставки. При ставке 1.00 и `cost_multiplier: 100` — стоимость 100.00. |
| `modes.*.scatter_distribution` | map[string]int | Взвешенное распределение количества гарантированных скаттеров. Ключ — количество скаттеров, значение — вес. В примере: 60% шанс на 4 скаттера, 30% на 5, 10% на 6. |

> **Обратная совместимость**: поддерживается старый плоский формат `{"cost_multiplier": 100, "scatter_distribution": {...}}` — он автоматически конвертируется в `modes.default`.

#### Action definition

Для каждого режима buy bonus создаётся **отдельное действие** с `debit: "buy_bonus_cost"` и полем `buy_bonus_mode`, указывающим на ключ в `buy_bonus.modes`:

```json
"buy_bonus": {
  "stage": "base_game",
  "debit": "buy_bonus_cost",
  "buy_bonus_mode": "default",
  "credit": "win",
  "transitions": [
    {
      "condition": "free_spins_remaining > 0",
      "creates_session": true,
      "credit_override": "defer",
      "next_actions": ["free_spin"],
      "session_config": {
        "total_spins_var": "free_spins_remaining",
        "persistent_vars": ["global_multiplier"]
      }
    },
    { "condition": "always", "next_actions": ["spin"] }
  ]
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `buy_bonus_mode` | string | Ключ режима из `buy_bonus.modes`. Определяет стоимость и распределение скаттеров. Если не указан, используется `"default"`. |

`"buy_bonus_cost"` как debit автоматически вычисляет сумму списания: `bet × buy_bonus.modes[buy_bonus_mode].cost_multiplier`.

#### Как работает движок при buy bonus

Когда вызывается действие с `debit: "buy_bonus_cost"`, перед выполнением стейджа движок автоматически:

1. **Выбирает количество скаттеров** из `scatter_distribution` (взвешенный случайный выбор).
2. **Форсирует тип раунда** — `determine_round_type` всегда возвращает `"scatter"` (вместо случайного выбора по `round_type_weights`).
3. **Размещает скаттеры на сетке** — `fill_grid` пропускает случайное размещение скаттеров и вместо этого принудительно ставит выбранное количество скаттеров в случайных позициях (с соблюдением `scatter_max_per_column`).
4. `check_scatter` обнаруживает размещённые скаттеры → `trigger_free_spins` активирует фриспины.
5. Transition `"free_spins_remaining > 0"` создаёт сессию — далее клиент играет фриспины как обычно.

> **Важно**: для работы buy bonus конфигурация должна содержать `buy_bonus` блок с `scatter_distribution`, а `logic.base_game` — включать шаги `determine_round_type`, `fill_grid`, `check_scatter` и `trigger_free_spins`. Без этих шагов сетка не будет заполнена и скаттеры не будут обработаны.

#### Пример потока

```
Клиент: sdk.play({ action: "buy_bonus", bet: 1.00 })
→ Списание: 1.00 × 100 = 100.00
→ Движок: scatter_distribution → выбрано 5 скаттеров
→ determine_round_type → "scatter" (принудительно)
→ fill_grid → 5 скаттеров + обычные символы + множители
→ check_scatter → 5 скаттеров → scatter_payout + 20 free spins
→ trigger_free_spins → free_spins_remaining = 20
→ Transition: creates_session, next_actions: ["free_spin"]
→ Ответ: { next_actions: ["free_spin"], session: { spins_remaining: 20 } }
→ Клиент: sdk.play({ action: "free_spin", roundId: "..." }) × 20
```

#### Несколько режимов покупки бонуса (Multi-mode Buy Bonus)

Некоторые игры предлагают несколько вариантов покупки бонуса с разной ценой и гарантией скаттеров. Например: обычный бонус (100× ставки, 4–6 скаттеров) и супер-бонус (200× ставки, гарантированно 5–6 скаттеров).

##### Конфигурация

```json
"buy_bonus": {
  "modes": {
    "default": {
      "cost_multiplier": 100,
      "scatter_distribution": { "4": 60, "5": 30, "6": 10 }
    },
    "super": {
      "cost_multiplier": 200,
      "scatter_distribution": { "5": 70, "6": 30 }
    }
  }
}
```

##### Actions

Каждый режим — это отдельный action с уникальным именем и полем `buy_bonus_mode`:

```json
"actions": {
  "buy_bonus": {
    "stage": "base_game",
    "debit": "buy_bonus_cost",
    "buy_bonus_mode": "default",
    "credit": "win",
    "transitions": [ ... ]
  },
  "buy_bonus_super": {
    "stage": "base_game",
    "debit": "buy_bonus_cost",
    "buy_bonus_mode": "super",
    "credit": "win",
    "transitions": [ ... ]
  }
}
```

##### Клиентский вызов

Клиент вызывает нужный action по имени:

```typescript
// Обычный buy bonus (100× ставки)
await sdk.play({ action: 'buy_bonus', bet: 1.00 });

// Супер buy bonus (200× ставки, гарантированно 5+ скаттеров)
await sdk.play({ action: 'buy_bonus_super', bet: 1.00 });
```

Доступные действия возвращаются в `next_actions` ответа:

```json
{ "next_actions": ["spin", "buy_bonus", "buy_bonus_super"] }
```

##### Как это работает внутри

1. Gateway определяет action → находит `buy_bonus_mode` из `ActionDefinition`.
2. Считает стоимость: `bet × modes[buy_bonus_mode].cost_multiplier`.
3. Перед выполнением стейджа: разыгрывает `forced_scatter_count` из `modes[buy_bonus_mode].scatter_distribution`.
4. Устанавливает engine-переменные `_buy_bonus_active = 1` и `_forced_scatter_count = N`.
5. `determine_round_type` форсирует тип раунда `"scatter"`.
6. `fill_grid` размещает ровно N скаттеров на сетке.
7. Далее — стандартный flow: `check_scatter` → `trigger_free_spins` → создание сессии.

Для Lua-движка параметры передаются в `state.params`:
- `state.params.buy_bonus = true`
- `state.params.buy_bonus_mode = "super"`
- `state.params.forced_scatter_count = 5`

#### Симуляция buy bonus

Для проверки RTP buy bonus отдельно укажите `action: "buy_bonus"` в параметрах симуляции:

```json
{
  "action": "buy_bonus",
  "bet": 1.0,
  "iterations": 1000000
}
```

Симулятор автоматически применяет ту же логику форсирования скаттеров, что и реальный движок.

### Ante Bet

Увеличенная ставка с повышенным шансом на скаттер. Стоимость — множитель от обычной ставки (обычно 1.25×, т.е. +25%). Шанс появления scatter-символов увеличивается в `scatter_chance_multiplier` раз.

#### Конфигурация

```json
"ante_bet": {
  "cost_multiplier": 1.25,
  "scatter_chance_multiplier": 2.0
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `cost_multiplier` | float64 | Множитель стоимости спина (1.25 = +25% к ставке). При ставке 1.00 списывается 1.25. |
| `scatter_chance_multiplier` | float64 | Во сколько раз увеличивается `scatter_chance_base` из `symbol_chances`. При значении 2.0 и базе 0.044 → эффективный шанс 0.088. |

#### Активация клиентом

Ante bet активируется через параметр `ante_bet: true` в `params`:

```typescript
const result = await sdk.play({
  action: 'spin',
  bet: 1.00,
  params: { ante_bet: true }
});
```

Деbit для spin-действия остаётся `"bet"`, но action definition `debit: "ante_bet_cost"` **не** используется — вместо этого `ante_bet` это параметр, передаваемый в существующий spin action. Для корректного списания увеличенной ставки ante bet опирается на `ante_bet.cost_multiplier`:

```json
"spin": {
  "stage": "base_game",
  "debit": "ante_bet_cost",
  ...
}
```

Или, если ante bet — это опция в рамках обычного spin, используйте `debit: "bet"` и обрабатывайте повышенную ставку на стороне клиента (клиент умножает ставку на `ante_bet.cost_multiplier` перед отправкой).

> **Рекомендация**: для игр в стиле Gates (Piggy Gates) используйте `debit: "bet"` для spin-действия и передавайте `ante_bet: true` в params. Движок автоматически увеличит scatter chance. Клиент должен показывать ставку × 1.25 в интерфейсе.

#### Как работает движок при ante bet

Когда в `state.Params` присутствует `ante_bet: true` и в конфиге задан `ante_bet` блок:

1. **Шанс скаттера увеличивается**: `fill_grid` умножает `scatter_chance_base` на `scatter_chance_multiplier` (например, 0.044 × 2.0 = 0.088).
2. Тип раунда, множители и остальная логика — **без изменений**.
3. Увеличенная стоимость списывается до выполнения движка (если `debit: "ante_bet_cost"`) или рассчитывается клиентом.

#### Совместное использование

Buy bonus и ante bet — взаимоисключающие в рамках одного спина. Buy bonus — это отдельное действие (`buy_bonus`), ante bet — параметр обычного спина (`spin` с `params.ante_bet: true`).

#### input_schema

Для поддержки ante bet добавьте параметр в `input_schema`:

```json
"input_schema": {
  "type": "object",
  "properties": {
    "ante_bet": { "type": "boolean" }
  },
  "additionalProperties": false
}

---

## 9. Множители и типы раундов

### Round Type Weights

Определяет тип раунда через взвешенный случайный выбор (используется в Gates-стиле):

```json
"round_type_weights": {
  "scatter": 30,
  "multiplier": 70
}
```

- `"scatter"` — раунд с повышенным шансом появления скаттеров.
- `"multiplier"` — раунд с появлением множительных символов.

### Symbol Chances

Контролирует вероятности появления символов при поячеечном заполнении (`fill_grid`):

```json
"symbol_chances": {
  "scatter_chance_base": 0.01,
  "scatter_max_per_column": 1,
  "multiplier_chance": 0.05
}
```

| Поле | Описание |
|------|----------|
| `scatter_chance_base` | Базовая вероятность scatter-символа на каждую ячейку. |
| `scatter_max_per_column` | Максимум scatter-символов на один столбец. |
| `multiplier_chance` | Вероятность множительного символа на каждую ячейку. |

### Multiplier Value Weights

Определяет распределение значений множителей:

```json
"multiplier_value_weights": [
  { "value": 2,    "weight": 50 },
  { "value": 3,    "weight": 30 },
  { "value": 5,    "weight": 15 },
  { "value": 10,   "weight": 4 },
  { "value": 100,  "weight": 1 }
]
```

При появлении множительного символа его значение выбирается случайно с указанными весами.

---

## 10. Игровая логика (JSON-движок)

Логика игры описывается в поле `logic` как набор **стейджей** (stages). Каждый стейдж содержит массив **шагов** (steps):

```json
"stages": ["base_game", "free_spins"],

"logic": {
  "base_game": {
    "steps": [
      { "action": "spin_reels", "source": "base" },
      { "action": "evaluate_lines" },
      { "action": "payout" },
      { "action": "check_scatter" },
      {
        "type": "conditional",
        "condition": "free_spins_awarded > 0",
        "steps": [
          { "action": "trigger_free_spins" }
        ]
      }
    ]
  },
  "free_spins": {
    "steps": [
      { "action": "spin_reels", "source": "free_spins" },
      { "action": "evaluate_lines" },
      { "action": "payout" },
      { "action": "check_scatter_retrigger" }
    ]
  }
}
```

### Шаги (Step)

Каждый шаг имеет следующие поля:

| Поле | Тип | Описание |
|------|-----|----------|
| `action` | string | Имя встроенного действия (см. §11) или `"lua:function_name"` для вызова Lua. |
| `source` | string | Имя reel strip для действий `spin_reels`, `fill_grid`, `shift_and_fill`. |
| `output` | string | Имя переменной для сохранения результата. |
| `step` | float64 | Числовой параметр (используется в `increment_multiplier`). |
| `type` | string | `"loop"` или `"conditional"` для управляющих конструкций. |
| `condition` | string | Условие для `loop` и `conditional`. |
| `steps` | Step[] | Вложенные шаги для `loop` и `conditional`. |

### Управляющие конструкции

#### Conditional

Выполняет вложенные шаги **только если** условие истинно:

```json
{
  "type": "conditional",
  "condition": "free_spins_awarded > 0",
  "steps": [
    { "action": "trigger_free_spins" }
  ]
}
```

#### Loop

Повторяет вложенные шаги **пока** условие истинно (макс. 100 итераций — защита от бесконечных циклов):

```json
{
  "type": "loop",
  "condition": "last_win_amount > 0",
  "steps": [
    { "action": "remove_winning_symbols" },
    { "action": "shift_and_fill", "source": "base" },
    { "action": "collect_multipliers" },
    { "action": "evaluate_anywhere" },
    { "action": "payout" }
  ]
}
```

### Формат условий

Условие — строка формата `"переменная оператор значение"`:

```
last_win_amount > 0
free_spins_awarded >= 3
round_type_scatter == 1
multiplier != 1
```

Поддерживаемые операторы: `>`, `>=`, `<`, `<=`, `==`, `!=`.

Переменная должна существовать в `GameState.Variables`. Если переменная не найдена — условие считается ложным.

---

## 10.1. Actions — определение действий (обязательно)

Поле `actions` — **обязательное** поле в конфигурации игры. Оно определяет все доступные игровые действия (API-эндпоинты), связанные с ними стейджи движка, правила списания/зачисления и логику переходов между действиями.

> **Важно**: автоматическая генерация actions из stages **удалена**. Каждая игра должна явно определять свои actions.

### Структура ActionDefinition

```json
"actions": {
  "action_name": {
    "stage": "stage_name",
    "debit": "bet|buy_bonus_cost|ante_bet_cost|none",
    "buy_bonus_mode": "default",
    "credit": "win|none",
    "requires_session": false,
    "transitions": [...]
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `stage` | string | **(обязательно)** Имя стейджа из `logic` (JSON) или имя, передаваемое в `state.stage` (Lua). |
| `debit` | string | Способ списания: `"bet"` (ставка), `"buy_bonus_cost"` (цена покупки бонуса), `"ante_bet_cost"`, `"none"` (бесплатный спин). |
| `buy_bonus_mode` | string | Ключ режима из `buy_bonus.modes`. Определяет стоимость и распределение скаттеров для действий с `debit: "buy_bonus_cost"`. По умолчанию `"default"`. → см. §8. |
| `credit` | string | Когда зачислять выигрыш: `"win"` (сразу), `"none"` (отложено/не зачислять). |
| `requires_session` | bool | Если `true`, действие требует активной сессии (round_id). Используется для фриспинов. |
| `transitions` | array | Условные переходы после выполнения стейджа. Оцениваются по порядку — первый совпавший побеждает. |

### Структура Transition

```json
{
  "condition": "free_spins_remaining > 0",
  "creates_session": true,
  "credit_override": "defer",
  "next_actions": ["free_spin"],
  "session_config": {
    "total_spins_var": "free_spins_remaining",
    "persistent_vars": ["global_multiplier"]
  },
  "add_spins_var": "free_spins_awarded",
  "complete_session": false
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `condition` | string | govaluate-выражение, оцениваемое против `state.Variables`. Используйте `"always"` для безусловного перехода. |
| `creates_session` | bool | Создать новую Redis-сессию (бонусный раунд). |
| `credit_override` | string | Переопределяет `credit` действия. `"defer"` — отложить зачисление до завершения сессии. |
| `next_actions` | string[] | Список действий, доступных клиенту после этого перехода (возвращается в `PlayResult.next_actions`). |
| `session_config` | object | Настройки создаваемой сессии: `total_spins_var` (переменная для количества спинов), `persistent_vars` (сохраняемые переменные). |
| `add_spins_var` | string | Переменная, значение которой добавляется к `session.SpinsRemaining` (ретриггер). |
| `complete_session` | bool | Немедленно завершить текущую сессию и зачислить накопленный выигрыш. **Внимание**: срабатывает безусловно при совпадении перехода — даже если `SpinsRemaining > 0`. Для фриспинов используйте промежуточный переход с проверкой оставшихся спинов (см. примеры ниже). |

### Пример: простой слот (только base game)

```json
"actions": {
  "spin": {
    "stage": "base_game",
    "debit": "bet",
    "credit": "win",
    "transitions": [
      { "condition": "always", "next_actions": ["spin"] }
    ]
  }
}
```

### Пример: слот с фриспинами

```json
"actions": {
  "spin": {
    "stage": "base_game",
    "debit": "bet",
    "credit": "win",
    "transitions": [
      {
        "condition": "free_spins_remaining > 0",
        "creates_session": true,
        "credit_override": "defer",
        "next_actions": ["free_spin"],
        "session_config": {
          "total_spins_var": "free_spins_remaining",
          "persistent_vars": ["global_multiplier"]
        }
      },
      { "condition": "always", "next_actions": ["spin"] }
    ]
  },
  "free_spin": {
    "stage": "free_spins",
    "debit": "none",
    "requires_session": true,
    "transitions": [
      {
        "condition": "retrigger_spins > 0",
        "add_spins_var": "retrigger_spins",
        "next_actions": ["free_spin"]
      },
      {
        "condition": "free_spins_awarded > 1",
        "next_actions": ["free_spin"]
      },
      {
        "condition": "always",
        "complete_session": true,
        "next_actions": ["spin"]
      }
    ]
  }
}
```

> **Важно**: переход с `complete_session: true` должен быть последним (fallback). Перед ним обязательно добавьте переход-продолжение (например `free_spins_awarded > 1`), иначе сессия завершится после первого спина. Переменная `free_spins_awarded` автоматически восстанавливается из `session.SpinsRemaining` перед каждым спином.

### Пример: слот с фриспинами + buy bonus

```json
"actions": {
  "spin": {
    "stage": "base_game",
    "debit": "bet",
    "credit": "win",
    "transitions": [
      {
        "condition": "free_spins_remaining > 0",
        "creates_session": true,
        "credit_override": "defer",
        "next_actions": ["free_spin"],
        "session_config": {
          "total_spins_var": "free_spins_remaining",
          "persistent_vars": ["global_multiplier"]
        }
      },
      { "condition": "always", "next_actions": ["spin"] }
    ]
  },
  "free_spin": {
    "stage": "free_spins",
    "debit": "none",
    "requires_session": true,
    "transitions": [
      {
        "condition": "retrigger_spins > 0",
        "add_spins_var": "retrigger_spins",
        "next_actions": ["free_spin"]
      },
      {
        "condition": "free_spins_awarded > 1",
        "next_actions": ["free_spin"]
      },
      {
        "condition": "always",
        "complete_session": true,
        "next_actions": ["spin"]
      }
    ]
  },
  "buy_bonus": {
    "stage": "base_game",
    "debit": "buy_bonus_cost",
    "credit": "win",
    "transitions": [
      {
        "condition": "free_spins_remaining > 0",
        "creates_session": true,
        "credit_override": "defer",
        "next_actions": ["free_spin"],
        "session_config": {
          "total_spins_var": "free_spins_remaining",
          "persistent_vars": ["global_multiplier"]
        }
      },
      { "condition": "always", "next_actions": ["spin"] }
    ]
  }
}
```

### Пример: настольная игра (Blackjack)

Настольные игры используют **unlimited sessions** — сессия завершается только по `complete_session: true`, а не по счётчику спинов. Каждое действие игрока (hit, stand, double, split) — это отдельный action в конфиге.

```json
"actions": {
  "deal": {
    "stage": "deal",
    "debit": "bet",
    "credit": "none",
    "transitions": [
      {
        "condition": "round_complete == 1",
        "complete_session": true,
        "next_actions": ["deal"]
      },
      {
        "condition": "always",
        "creates_session": true,
        "credit_override": "defer",
        "next_actions": ["hit", "stand", "double"],
        "session_config": {
          "total_spins_var": "_table_unlimited",
          "persistent_vars": []
        }
      }
    ]
  },
  "hit": {
    "stage": "player_action",
    "debit": "none",
    "requires_session": true,
    "transitions": [
      { "condition": "round_complete == 1", "complete_session": true, "next_actions": ["deal"] },
      { "condition": "always", "next_actions": ["hit", "stand"] }
    ]
  },
  "stand": {
    "stage": "player_action",
    "debit": "none",
    "requires_session": true,
    "transitions": [
      { "condition": "round_complete == 1", "complete_session": true, "next_actions": ["deal"] },
      { "condition": "always", "next_actions": ["hit", "stand"] }
    ]
  },
  "double": {
    "stage": "player_action",
    "debit": "bet",
    "requires_session": true,
    "transitions": [
      { "condition": "round_complete == 1", "complete_session": true, "next_actions": ["deal"] },
      { "condition": "always", "next_actions": ["hit", "stand"] }
    ]
  }
}
```

**Ключевые отличия от слотов:**
- `total_spins_var: "_table_unlimited"` — Lua-скрипт устанавливает эту переменную в `-1`, что даёт `SpinsRemaining = -1` (unlimited session). Сессия не завершается по счётчику.
- Несколько actions с `debit: "none"` и `requires_session: true` — действия игрока внутри раунда бесплатны.
- `double` имеет `debit: "bet"` — дополнительное списание при удвоении.
- Lua-скрипт устанавливает `variables.round_complete = 1` когда раунд завершён, что активирует transition с `complete_session: true`.
- Подробнее → см. §21.

### Как это работает

1. Клиент вызывает `sdk.play({ action: "spin", bet: 1.00 })`.
2. Платформа находит `ActionDefinition` по имени действия (`"spin"`).
3. Списывает ставку согласно `debit` (`"bet"` → списать 1.00).
4. Запускает стейдж `"base_game"` через движок (`FlowExecutor` или `LuaExecutor`).
5. Оценивает `transitions` по порядку против `state.Variables`.
6. Первый совпавший переход определяет: создаётся ли сессия, что зачисляется, какие `next_actions` возвращаются клиенту.
7. Возвращает `PlayResult` с `next_actions` — клиент знает, какое действие вызвать следующим.

### Симуляция

Симулятор (`Simulate()`) полностью data-driven: он находит entry-action (первое действие без `requires_session`), выполняет его стейдж, оценивает transitions для определения session-based спинов, и автоматически учитывает retriggering через `add_spins_var`. Никаких хардкоженных имён стейджей.

---

## 11. Справочник встроенных действий

### Генерация сетки

| Действие | Описание |
|----------|----------|
| `spin_reels` | Генерирует матрицу `viewport.height × viewport.width`. Если доступны `symbol_weights` — используется взвешенный случайный выбор (с поддержкой per-reel весов). Иначе — из reel strip: для каждого столбца выбирается случайная позиция на strip, вырезается окно. Результат записывается в `state.Matrix`. |
| `fill_grid` | Поячеечная генерация сетки (Gates-стиль). Если доступны `symbol_weights` — обычные символы выбираются по весам. Учитывает `symbol_chances`, `round_type_weights`, `multiplier_value_weights`. Устанавливает `last_win_amount = 1` для входа в каскадный цикл. **При buy bonus**: пропускает случайное размещение скаттеров и вместо этого принудительно ставит выбранное количество скаттеров из `scatter_distribution`. **При ante bet**: умножает `scatter_chance_base` на `scatter_chance_multiplier`. |

Оба действия принимают параметр `source` — имя набора весов или reel strip. Если не указан, берётся `"base"` / первый доступный.

### Оценка выигрышей

| Действие | Описание |
|----------|----------|
| `evaluate_lines` | Оценивает все пэйлайны слева направо с учётом Wild-символов. Записывает результат в `state.WinLines` и устанавливает `last_win_amount`. |
| `evaluate_anywhere` | Подсчитывает одинаковые символы на сетке. Записывает в `state.AnywhereWins` и устанавливает `last_win_amount`. |

### Выплаты

| Действие | Описание |
|----------|----------|
| `payout` | Добавляет к `state.TotalWin` значение `last_win_amount × multiplier`. Если `multiplier` равен 0 — считается как 1. **При наличии `max_win`**: если `TotalWin` превышает эффективный кап — обрезается и устанавливается `max_win_reached = 1`, каскадный цикл прерывается. |

### Каскады

| Действие | Описание |
|----------|----------|
| `remove_winning_symbols` | Помечает выигравшие позиции как пустые (`-1`). Работает как для payline-режима (по `WinLines`), так и для anywhere-pays (по `AnywhereWins`). |
| `shift_and_fill` | Сдвигает оставшиеся символы вниз и заполняет пустые позиции сверху случайными символами. Если доступны `symbol_weights` — использует взвешенный выбор. Иначе — из reel strip. Принимает `source`. |

### Множители

| Действие | Описание |
|----------|----------|
| `increment_multiplier` | Увеличивает `state.Variables["multiplier"]` на значение параметра `step` (по умолчанию +1). |
| `collect_multipliers` | Находит все множительные символы (`is_multiplier: true`) на сетке, суммирует их значения и добавляет к `total_multiplier` и `global_multiplier`. |

### Скаттеры и фриспины

| Действие | Описание |
|----------|----------|
| `check_scatter` | Подсчитывает scatter-символы на сетке. Записывает в `scatter_count`, определяет выплату по `scatter_payouts` и количество фриспинов по `free_spins_trigger`. Scatter-выплата добавляется к `TotalWin` напрямую. |
| `check_scatter_retrigger` | Подсчитывает scatter-символы во время бонусного раунда. Добавляет допфриспины по `free_spins_retrigger`. |
| `trigger_free_spins` | Устанавливает `free_spins_remaining` равным `free_spins_awarded`. |

### Тип раунда

| Действие | Описание |
|----------|----------|
| `determine_round_type` | Выбирает тип раунда случайно по `round_type_weights`. Устанавливает `round_type_scatter = 1` для scatter-раундов, `0` — для multiplier-раундов. **При buy bonus**: всегда форсированно возвращает `scatter` (игнорирует `round_type_weights`). |

---

## 12. GameState: состояние спина

`GameState` — это объект, хранящий всё мутабельное состояние одного спина. Движок модифицирует его при выполнении каждого действия.

### Основные поля

| Поле | Тип | Описание |
|------|-----|----------|
| `Matrix` | `[][]int` | Текущая сетка символов (строки × столбцы). Пустые позиции помечены как `-1`. |
| `TotalWin` | `float64` | Суммарный выигрыш спина. **Это множитель от ставки**, не абсолютная сумма. |
| `WinLines` | `[]WinLine` | Результат `evaluate_lines`: массив выигравших линий с `payline_index`, `symbol_id`, `count`, `payout`. |
| `AnywhereWins` | `[]AnywhereWin` | Результат `evaluate_anywhere`: массив выигравших групп с `symbol_id`, `count`, `payout`, `positions`. |
| `ScatterCount` | `int` | Количество scatter-символов на сетке. |
| `Variables` | `map[string]float64` | Словарь именованных переменных (см. ниже). |
| `Params` | `map[string]any` | Входные параметры от клиента (валидируются по `input_schema`). Платформа автоматически добавляет `_action` (имя действия) и `_ps_*` (persistent state из сессии). |
| `Data` | `map[string]any` | Выходной payload, возвращаемый клиенту в `PlayResult.data`. Ключи с префиксом `_persist_` автоматически сохраняются в Redis-сессию (→ см. §21.2). |

### Стандартные переменные (Variables)

| Переменная | Начальное значение | Описание |
|------------|-------------------|----------|
| `bet` | (устанавливается платформой) | Размер ставки. |
| `multiplier` | `1` | Текущий множитель. Сбрасывается каждый спин в base game. |
| `total_multiplier` | `1` | Накопленный множитель за каскадную серию. |
| `global_multiplier` | `1` | Множитель, сохраняющийся между фриспинами. |
| `last_win_amount` | `0` | Выигрыш от последней оценки (используется в `payout` и как условие каскадного цикла). |
| `free_spins_awarded` | `0` | Количество назначенных фриспинов. |
| `free_spins_remaining` | *(не установлена)* | Оставшиеся фриспины (устанавливается `trigger_free_spins`). |
| `scatter_count` | *(не установлена)* | Количество скаттеров (устанавливается `check_scatter`). |
| `scatter_payout` | *(не установлена)* | Выплата за скаттеры (устанавливается `check_scatter`). |
| `round_type_scatter` | *(не установлена)* | `1` для scatter-раунда, `0` для multiplier-раунда. |
| `max_win_reached` | *(не установлена)* | `1` если достигнут лимит max win (устанавливается `payout`). |
| `_buy_bonus_active` | *(не установлена)* | `1` если текущее действие — buy bonus. Устанавливается платформой автоматически при `debit: "buy_bonus_cost"`. Влияет на `determine_round_type` и `fill_grid`. |
| `_forced_scatter_count` | *(не установлена)* | Количество гарантированных скаттеров (выбирается из `scatter_distribution`). Устанавливается платформой при buy bonus. |
| `_ante_bet_active` | *(не установлена)* | `1` если ante bet активен. Устанавливается платформой при `params.ante_bet: true`. Влияет на `fill_grid` (увеличивает scatter chance). |
| `round_complete` | *(не установлена)* | `1` если текущий раунд завершён. Используется в настольных играх (blackjack и др.) для активации transition с `complete_session: true`. Устанавливается Lua-скриптом. |
| `_table_unlimited` | *(не установлена)* | Sentinel для unlimited sessions. Lua-скрипт устанавливает `-1`, что даёт `SpinsRemaining = -1` (сессия не завершается по счётчику). → см. §21. |

### Как TotalWin превращается в деньги

`TotalWin` — это **множитель**. Платформа вычисляет реальный выигрыш как:

```
реальный_выигрыш = TotalWin × ставка
```

Например, `TotalWin = 50` при ставке 2.00 = выигрыш 100.00.

### Маппинг в PlayResult.data

Для JSON-движка `MapState()` автоматически собирает `Data` из внутренних полей:

| Источник | Ключ в `data` | Условие |
|----------|---------------|---------|
| `Matrix` | `"matrix"` | Всегда |
| `WinLines` | `"win_lines"` | Если есть выигрышные линии |
| `AnywhereWins` | `"anywhere_wins"` | Если есть anywhere-выигрыши |
| `ScatterCount` | `"scatter_count"` | Если > 0 |
| `Variables["multiplier"]` | `"multiplier"` | Если ≠ 1 |
| `Variables["global_multiplier"]` | `"global_multiplier"` | Если ≠ 1 |
| `Variables["free_spins_remaining"]` | `"free_spins_total"` | Если > 0 |
| `Variables["max_win_reached"]` | `"max_win_reached"` | Если == 1 (значение: `true`) |

Всё, что было вручную добавлено в `state.Data` (например, через Lua-действия), также включается.

> **Примечание**: В предыдущих версиях эта функция называлась `StateToData()`. Теперь используется `MapState()`.

---

## 13. Lua: полный и гибридный режимы

### Полный Lua-режим (`engine_mode: "lua"`)

Вся логика игры контролируется Lua-скриптом. В конфигурации:

```json
{
  "engine_mode": "lua",
  "script_path": "games/treasure-hunt/script.lua",
  "stages": ["base_game", "free_spins"],
  "actions": {
    "spin": {
      "stage": "base_game",
      "debit": "bet",
      "credit": "win",
      "transitions": [
        {
          "condition": "free_spins_remaining > 0",
          "creates_session": true,
          "credit_override": "defer",
          "next_actions": ["free_spin"],
          "session_config": {
            "total_spins_var": "free_spins_remaining",
            "persistent_vars": ["global_multiplier"]
          }
        },
        { "condition": "always", "next_actions": ["spin"] }
      ]
    },
    "free_spin": {
      "stage": "free_spins",
      "debit": "none",
      "requires_session": true,
      "transitions": [
        { "condition": "free_spins_awarded > 0", "add_spins_var": "free_spins_awarded", "next_actions": ["free_spin"] },
        { "condition": "always", "complete_session": true, "next_actions": ["spin"] }
      ]
    }
  }
}
```

Скрипт хранится в S3 и загружается платформой автоматически при обращении к игре. Путь `script_path` — это S3 object key (или просто имя файла, которое резолвится в `games/{gameID}/{filename}`).

#### Единая точка входа: `execute(state)`

Скрипт должен экспортировать **одну глобальную функцию** `execute(state)`. Движок всегда вызывает именно её, передавая в `state` информацию о текущем действии и стейдже:

```lua
function execute(state)
    -- state.action    — имя действия из actions ("spin", "free_spin", etc.)
    -- state.stage     — имя стейджа из action.stage ("base_game", "free_spins", etc.)
    -- state.params    — параметры от клиента
    -- state.variables — переменные: bet, multiplier и др.

    local stage = state.stage or "base_game"

    if stage == "base_game" then
        return do_base_game(state)
    elseif stage == "free_spins" then
        return do_free_spins(state)
    else
        error("unknown stage: " .. tostring(stage))
    end
end

function do_base_game(state)
    local config = engine.get_config()
    local matrix = generate_matrix(config.viewport.width, config.viewport.height)
    local wins, total_win = evaluate_wins(matrix)

    local scatter_count = count_symbol(matrix, 10)
    local vars = {}
    if scatter_count >= 3 then
        vars.free_spins_awarded = 10
        vars.free_spins_remaining = 10
    end

    return {
        total_win = total_win,
        matrix = matrix,
        wins = wins,
        scatter_count = scatter_count,
        variables = vars,
    }
end

function do_free_spins(state)
    local multiplier = state.variables.global_multiplier or 1
    local matrix = generate_matrix(5, 3)
    local wins, total_win = evaluate_wins(matrix)
    total_win = total_win * multiplier

    local scatter_count = count_symbol(matrix, 10)
    local vars = { global_multiplier = multiplier }
    if scatter_count >= 3 then
        vars.free_spins_awarded = 5
        vars.free_spins_remaining = (state.variables.free_spins_remaining or 0) + 5
    end

    return {
        total_win = total_win,
        matrix = matrix,
        wins = wins,
        variables = vars,
    }
end
```

> **Важно**: движок всегда вызывает `execute(state)`. Диспатчинг по `state.stage` (или `state.action`) — ответственность скрипта. Это даёт полный контроль: можно организовать любую логику маршрутизации.

#### Поля `state`, передаваемые в Lua

| Поле | Тип | Описание |
|------|-----|----------|
| `state.action` | string | Имя действия из `actions` (e.g. `"spin"`, `"free_spin"`, `"buy_bonus"`). |
| `state.stage` | string | Имя стейджа, определённое в `ActionDefinition.stage` (e.g. `"base_game"`, `"free_spins"`). |
| `state.params` | table | Параметры от клиента (валидируются по `input_schema`). |
| `state.variables` | table | Словарь переменных: `bet`, `multiplier`, `global_multiplier` и др. |

#### Маппинг возвращаемой таблицы

| Ключ в return table | Маппинг | Описание |
|---------------------|---------|----------|
| `total_win` | `state.TotalWin` | Множитель выигрыша. Удаляется из `Data`. |
| `variables` | Мержится в `state.Variables` | Удаляется из `Data`. Используйте для установки `free_spins_awarded`, `free_spins_remaining`, `global_multiplier` и любых кастомных переменных. |
| Всё остальное | `state.Data[key]` | Передаётся клиенту в `PlayResult.data` (matrix, wins, bonus и др.). |

> **Триггер фриспинов**: для запуска бонусного раунда верните `variables = { free_spins_awarded = N }`. Переходы (transitions) в `actions` конфиге определяют, создаётся ли сессия.

> **Важно**: не перезаписывайте в `variables` переменные, которые трекаются сессией (например `free_spins_awarded`), из хендлера фриспинов — это нарушит логику переходов. Для retrigger используйте отдельную переменную (например `retrigger_spins`) и соответствующий `add_spins_var` в transition.

### Гибридный режим (JSON + Lua)

В JSON-режиме можно вызывать Lua-функции для отдельных шагов через префикс `lua:`:

```json
{
  "engine_mode": "json",
  "script_path": "games/my-game/pick_bonus.lua",
  "logic": {
    "base_game": {
      "steps": [
        { "action": "spin_reels", "source": "base" },
        { "action": "evaluate_lines" },
        { "action": "payout" },
        { "action": "lua:pick_bonus" }
      ]
    }
  }
}
```

Гибридный режим использует `CallAction()`, которая вызывает Lua-функцию **по её имени** (не через `execute()`). Возвращаемые значения мержатся в `state.Data`, а специальные ключи (`total_win`, `variables`) обновляют соответствующие поля состояния.

> **Важно**: гибридный режим (`lua:function_name`) **не изменился** — функции по-прежнему именуются напрямую (e.g. `function pick_bonus(state)`). Единая точка входа `execute(state)` применяется только в полном Lua-режиме (`engine_mode: "lua"`).

### Полный Lua-режим для настольных игр

Для настольных игр (blackjack, рулетка и др.) Lua-режим — **единственный вариант**, т.к. JSON-движок ориентирован на слоты. Основные отличия:

- **Несколько стейджей → несколько actions**: каждое решение игрока (hit/stand/double) — отдельный action в конфиге, каждый маппится на один `stage`.
- **Имя действия доступно через `state.params._action`**: платформа автоматически инжектирует имя вызванного action (e.g. `"hit"`, `"stand"`, `"double"`), что позволяет одному стейджу обрабатывать разные действия.
- **Persistent state через `_persist_` конвенцию**: Lua-скрипт кладёт данные в `state.Data` с ключами `_persist_<name>`, платформа автоматически сохраняет их в Redis-сессию. При следующем action эти данные доступны в `state.params._ps_<name>`. → подробнее в §21.2.
- **Unlimited sessions**: переменная `_table_unlimited = -1` даёт `SpinsRemaining = -1` — сессия завершается только по `complete_session: true` в transition.

---

## 14. Lua API Reference

Внутри Lua-скриптов доступен глобальный модуль `engine` со следующими функциями:

### `engine.random(min, max) → int`

Криптографически безопасное случайное число в диапазоне `[min, max]` (включительно).

```lua
local col = engine.random(1, 5)   -- случайный столбец 1..5
```

### `engine.random_float() → float`

Случайное число с плавающей точкой в диапазоне `[0, 1)`.

```lua
if engine.random_float() < 0.05 then
    -- 5% шанс
end
```

### `engine.random_weighted(weights) → int`

Взвешенный случайный выбор. Принимает Lua-таблицу весов, возвращает **1-based** индекс.

```lua
local weights = {50, 30, 15, 4, 1}
local idx = engine.random_weighted(weights) -- 1..5
```

### `engine.get_symbol(id) → table`

Возвращает свойства символа по числовому `id`:

```lua
local sym = engine.get_symbol(10)
-- sym.id           → 10
-- sym.is_wild      → true
-- sym.is_scatter   → false
-- sym.is_multiplier → false
-- sym.multiplier   → 0
```

### `engine.get_config() → table`

Возвращает конфигурацию игры:

```lua
local cfg = engine.get_config()
-- cfg.id           → "treasure_hunt"
-- cfg.type         → "SLOT"
-- cfg.viewport.width  → 5
-- cfg.viewport.height → 3
-- cfg.bet_levels   → {0.20, 0.50, 1.00, 2.00, 5.00}
```

### `engine.log(level, message)`

Серверное логирование. Доступные уровни: `"debug"`, `"info"`, `"warn"`, `"error"`.

```lua
engine.log("debug", "Bonus picked: " .. tostring(prize))
```

### `engine.shuffle(array) → table`

Криптографически безопасный Fisher-Yates shuffle. Принимает Lua-массив (1-based), возвращает **новую перемешанную** копию. Оригинальная таблица не модифицируется.

```lua
-- Создать и перемешать 6-deck shoe
local shoe = {}
for deck = 1, 6 do
    for card = 0, 51 do
        shoe[#shoe + 1] = card
    end
end
local shuffled = engine.shuffle(shoe) -- 312 cards, crypto RNG
```

> **Примечание**: `engine.shuffle()` использует тот же криптографически стойкий RNG (`crypto/rand`), что и `engine.random()`. Этот биндинг особенно полезен для карточных игр (blackjack, покер, баккара).

### Sandbox-ограничения

| Разрешено | Запрещено |
|-----------|-----------|
| `base` (кроме `dofile`, `loadfile`) | `os` (вся библиотека) |
| `table` | `io` (вся библиотека) |
| `string` | `debug` (вся библиотека) |
| `math` | `dofile()` |
| `package` / `require` | `loadfile()` |

**Таймаут выполнения**: 5 секунд. При превышении скрипт прерывается с ошибкой.

**Пул VM**: Lua-состояния переиспользуются через `sync.Pool` для конкурентной обработки запросов. Не полагайтесь на глобальные переменные между вызовами.

---

## 15. Валидация входа и выхода (JSON Schema)

Конфигурация поддерживает опциональные JSON Schema (draft 2020-12) для валидации параметров спина и описания выходных данных.

### input_schema

Валидирует `PlayRequest.Params` — параметры, которые клиент передаёт при игровом действии:

```json
"input_schema": {
  "type": "object",
  "properties": {
    "lines": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20
    },
    "ante_bet": {
      "type": "boolean"
    },
    "buy_bonus": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Если параметры не проходят валидацию — спин отклоняется с ошибкой.

### output_schema

Описывает структуру `PlayResult.data` (информационный, не валидационный):

```json
"output_schema": {
  "type": "object",
  "properties": {
    "matrix": {
      "type": "array",
      "items": { "type": "array", "items": { "type": "integer" } }
    },
    "win_lines": {
      "type": "array"
    },
    "multiplier": {
      "type": "number"
    }
  }
}
```

---

## 16. Клиентская интеграция (SDK)

Для клиентской части используется `@energy8platform/game-sdk`. Полная документация — в [game_sdk_reference.md](game_sdk_reference.md).

### Краткий обзор

```typescript
import { CasinoGameSDK } from '@energy8platform/game-sdk';

const sdk = new CasinoGameSDK();

// 1. Инициализация — получение конфига и баланса
const initData = await sdk.ready();
// initData.config   — конфигурация игры (GameDefinition)
// initData.balance  — текущий баланс
// initData.currency — валюта
// initData.assetsUrl — базовый URL для ассетов

// 2. Спин (универсальный метод play)
const result = await sdk.play({ action: 'spin', bet: 1.00, params: { lines: 20 } });
// result.roundId      — ID раунда
// result.action       — выполненное действие ("spin")
// result.totalWin     — выигрыш
// result.balanceAfter — баланс после спина
// result.data         — payload из GameState.Data (матрица, линии, множители...)
// result.nextActions  — доступные действия далее (["spin"], ["free_spin"], ["pick"])
// result.session      — состояние сессии (если фриспины триггернулись)
// result.creditPending — true если зачисление отложено

// 3. Фриспин (если nextActions содержит "free_spin")
if (result.nextActions.includes('free_spin')) {
    const fs = await sdk.play({ action: 'free_spin', bet: 0, roundId: result.roundId });
    // fs.session.spinsRemaining — оставшиеся фриспины
    // fs.session.completed      — true когда бонус завершён
    // fs.session.maxWinReached  — true если достигнут max win cap
}

// 4. Баланс
const balance = await sdk.getBalance();

// 5. Очистка
sdk.destroy();
```

### Что возвращается в `result.data`

Содержимое `result.data` — это `GameState.Data`, собранный движком:

- Для JSON-движка: автоматически маппится из `Matrix`, `WinLines`, `AnywhereWins` и т.д. через `MapState()`.
- Для Lua-движка: всё, что скрипт вернул в return-таблице (кроме специальных ключей `total_win`, `free_spins`, `variables`).

Используйте `output_schema` в конфиге для документирования структуры `data` вашей игры.

---

## 17. Деплой игры

### Шаг 1: Создание записи игры

```bash
POST /api/v1/admin/games
Content-Type: application/json

{
  "id": "my_new_slot",
  "title": "My New Slot",
  "type": "SLOT",
  "version": "1.0.0",
  "engine_mode": "json",
  "rtp": "96.5",
  "description": "Описание игры"
}
```

Игра создаётся в неактивном состоянии (`is_active = false`). Путь к конфигу по умолчанию: `games/{id}/config.json`.

### Шаг 2: Загрузка конфигурации в S3

Получите presigned URL:

```bash
POST /api/v1/admin/games/upload-url?game_id=my_new_slot&asset_type=config
```

Загрузите конфиг по полученному URL:

```bash
PUT {presigned_url}
Content-Type: application/json

< my_new_slot_config.json
```

### Шаг 3: Загрузка ассетов

Аналогично — получите URL для каждого типа ассета (`ICON`, `BACKGROUND`, `SOUND_BUNDLE`) и загрузите файлы.

### Шаг 4: Lua-скрипт (если `engine_mode: "lua"` или гибридный)

Lua-скрипты хранятся в S3 рядом с конфигурацией. Получите presigned URL с `type="script"`:

```bash
POST /api/v1/admin/games/{id}/upload-url
Content-Type: application/json

{
  "type": "script",
  "filename": "script.lua"
}
```

Загрузите `.lua` файл по полученному URL:

```bash
PUT {presigned_url}
Content-Type: application/octet-stream

< my_game_script.lua
```

Скрипт будет сохранён в S3 по пути `games/{gameID}/script.lua`. В конфигурации укажите `script_path` соответствующий S3-ключу:

```json
{
  "engine_mode": "lua",
  "script_path": "games/my-game/script.lua"
}
```

> **Примечание**: если `script_path` это просто имя файла (например `"script.lua"`), платформа автоматически резолвит его в `games/{gameID}/script.lua`. В dev-режиме (файловый конфиг-репозиторий) скрипты по-прежнему читаются из локальной директории `scripts/`.

### Шаг 5: Активация

Обновите статус игры для отображения в клиентском лобби.

---

## 18. Симуляция и проверка RTP

Перед деплоем используйте CLI-инструмент симуляции для проверки математической модели.

### Запуск

```bash
go run cmd/simulation/main.go
```

> По умолчанию в `cmd/simulation/main.go` указаны `configPath` и `iterations`. Измените их под вашу игру.

### Пример вывода

```
Starting simulation for piggy_gates (1000000 iterations)...

--- Simulation Results ---
Game: piggy_gates
Iterations: 1000000
Duration: 12.5s
Total RTP: 96.48%
Base Game RTP: 72.31%
Free Spins RTP: 24.17%
Hit Frequency: 28.45%
Max Win: 5234.50x
Max Win Hits: 3 (rounds capped by max_win)
Free Spins Triggered: 4521 (1 in 221 spins)
Free Spins Played: 52847
```

### Метрики

| Метрика | Описание |
|---------|----------|
| `Total RTP` | Общий Return to Player (должен соответствовать целевому `rtp` в конфиге). |
| `Base Game RTP` | Доля RTP от основной игры. |
| `Free Spins RTP` | Доля RTP от бонусных раундов. |
| `Hit Frequency` | Процент спинов с выигрышем. |
| `Max Win` | Максимальный разовый выигрыш (в множителях от ставки). |
| `Max Win Hits` | Количество раундов, где выигрыш был ограничен лимитом `max_win`. |

Рекомендуется запускать не менее **1 000 000** итераций для стабильных результатов.

---

## 19. Соглашения и лучшие практики

1. **Symbol ID — целые числа**. Строковые имена (ключи в `symbols`) служат только для читаемости конфига. Внутри движка и в `reel_strips`, `paylines`, `anywhere_payouts` — только `id`.

2. **Все выплаты — множители от ставки**. `TotalWin = 50` при ставке 2.00 = реальный выигрыш 100.00. Не используйте абсолютные суммы.

3. **Используйте `symbol_weights` вместо `reel_strips`** для новых игр. Формат `name→weight` проще для понимания, настройки RTP и поддержки per-reel конфигурации. `reel_strips` поддерживается для обратной совместимости.

4. **Формат ключей выплат**: `"symbolID:count"` для paylines (e.g., `"1:3"`), строковые пороги для anywhere (`"8"`, `"10"`), строковые количества для scatter (`"3"`, `"4"`).

5. **Используйте `input_schema`** для валидации клиентских параметров (`PlayRequest.Params`) — это защита от невалидных запросов.

6. **Именование стейджей и actions**: стейджи именуются произвольно (`"base_game"`, `"free_spins"`, `"bonus_pick"` и др.). В Lua-режиме скрипт экспортирует единую функцию `execute(state)` и сам диспатчит по `state.stage`. Блок `actions` в конфиге — **обязательный** (см. §10.1).

7. **Глобальный множитель (`global_multiplier`)** сохраняется между фриспинами в Redis-сессии. Используйте его для накопительного эффекта.

8. **Каскады реализуются через `loop`**: условие `"last_win_amount > 0"`, тело — `remove_winning_symbols` → `shift_and_fill` → оценка → `payout`.

9. **Не полагайтесь на глобальные Lua-переменные** между вызовами — VM переиспользуются из пула.

10. **Тестируйте через симуляцию** до деплоя. Целевой RTP должен совпадать с заявленным в конфиге ±0.5%.

11. **Всегда задавайте `max_win`** для production-игр. Без лимита теоретически возможны аномально большие выигрыши в каскадных играх. Стандартный диапазон: 5 000×–20 000× ставки.

12. **`free_spins_config.persistent_state`** — перечислите все переменные, которые должны накапливаться между фриспинами. Если не указан, по умолчанию сохраняется только `global_multiplier`.

13. **Для настольных игр (TABLE) используйте `_persist_` конвенцию** — храните сложные структуры (колоду карт, руки игроков) в `state.Data` с ключами `_persist_<name>`. Платформа автоматически сохраняет их в Redis между действиями (→ §21.2).

14. **Настольные игры — только Lua-режим**. JSON-движок ориентирован на слоты; логика карточных/настольных игр значительно сложнее и требует полного контроля через `execute(state)`.

---

## 20. Миграция Lua-скриптов (v2 → v3)

Данный раздел описывает breaking changes в движке версии 3 и шаги миграции для существующих скриптов и конфигов.

### Что изменилось

В v3 произошли два фундаментальных изменения:

1. **Единая точка входа** — `LuaExecutor` больше не диспатчит по имени функции (v2: `base_game(state)`, `free_spins(state)`). Теперь всегда вызывается `execute(state)`, а `state.action` и `state.stage` передаются как поля.
2. **Обязательный блок `actions`** — платформа больше не генерирует actions автоматически. Каждый конфиг должен явно указать `actions` с переходами (transitions).

**Обратная совместимость не поддерживается** — старые скрипты и конфиги без `actions` перестанут работать.

### Breaking changes

| Было (v2) | Стало (v3) | Тип изменения |
|-----------|------------|---------------|
| `function base_game(state)` | `function execute(state)` с диспатчем по `state.stage` | Рефакторинг entry point |
| `function free_spins(state)` | Логика внутри `execute(state)` | Рефакторинг entry point |
| Автогенерация `actions` из конфига | Обязательный явный блок `actions` в JSON | Удалена автогенерация |
| Нет `state.action` / `state.stage` | `state.action` и `state.stage` всегда передаются в Lua | Новые поля |
| Transitions описывались неявно (magic keys) | Explicit transitions в `actions` блоке | Структурное изменение |

### Шаги миграции

#### 1. Оберните функции в `execute(state)`

```lua
-- Было (v2):
function base_game(state)
    -- логика базовой игры
    return { total_win = 25, matrix = matrix, variables = vars }
end

function free_spins(state)
    -- логика фриспинов
    return { total_win = 10, matrix = matrix, variables = vars }
end

-- Стало (v3):
function execute(state)
    local stage = state.stage or "base_game"

    if stage == "base_game" then
        return do_base_game(state)
    elseif stage == "free_spins" then
        return do_free_spins(state)
    else
        error("unknown stage: " .. tostring(stage))
    end
end

function do_base_game(state)
    -- логика базовой игры (бывшая base_game())
    return { total_win = 25, matrix = matrix, variables = vars }
end

function do_free_spins(state)
    -- логика фриспинов (бывшая free_spins())
    return { total_win = 10, matrix = matrix, variables = vars }
end
```

> **Совет**: переименуйте старые функции в `do_base_game()`, `do_free_spins()` и т.д., а `execute(state)` сделайте диспатчером.

#### 2. Добавьте блок `actions` в JSON-конфиг

Блок `actions` теперь **обязателен** для всех конфигов. Минимальный пример для слота с фриспинами:

```json
{
  "actions": {
    "spin": {
      "stage": "base_game",
      "debit": "bet",
      "credit": "win",
      "transitions": [
        {
          "condition": "free_spins_remaining > 0",
          "creates_session": true,
          "credit_override": "defer",
          "next_actions": ["free_spin"],
          "session_config": {
            "total_spins_var": "free_spins_remaining",
            "persistent_vars": ["global_multiplier"]
          }
        },
        { "condition": "always", "next_actions": ["spin"] }
      ]
    },
    "free_spin": {
      "stage": "free_spins",
      "debit": "none",
      "requires_session": true,
      "transitions": [
        { "condition": "free_spins_awarded > 0", "add_spins_var": "free_spins_awarded", "next_actions": ["free_spin"] },
        { "condition": "always", "complete_session": true, "next_actions": ["spin"] }
      ]
    }
  }
}
```

Для полного описания полей — см. §10.1.

Минимальный конфиг (слот без фриспинов):

```json
{
  "actions": {
    "spin": {
      "stage": "base_game",
      "debit": "bet",
      "credit": "win",
      "transitions": [
        { "condition": "always", "next_actions": ["spin"] }
      ]
    }
  }
}
```

#### 3. Используйте `state.action` и `state.stage`

В v3 в `state` передаются два новых поля:

```lua
function execute(state)
    print(state.action)  -- "spin", "free_spin", "buy_bonus" и т.д.
    print(state.stage)   -- "base_game", "free_spins" и т.д.
    -- диспатчинг по stage (или action — на ваш выбор)
end
```

### Гибридный режим (lua: prefix) — без изменений

Если вы используете Lua только для отдельных шагов в JSON-движке (например, `{ "action": "lua:pick_bonus" }`), это **не затрагивает** ваш код. Гибридный режим вызывает `CallAction()`, а не через `execute()`, и работает без изменений.

### Диагностика

Если после обновления платформы игра возвращает ошибку:

```
lua function "execute" not found
```

это означает, что скрипт ещё не обновлён — старые функции `base_game()`/`free_spins()` не обёрнуты в `execute()`. Выполните шаг 1 выше.

Если ошибка:

```
game config validation failed: "actions" field is required
```

это означает, что в JSON-конфиге отсутствует обязательный блок `actions`. Выполните шаг 2 выше.

### Чеклист миграции

- [ ] Lua-скрипт экспортирует `execute(state)` вместо отдельных функций
- [ ] `execute(state)` диспатчит по `state.stage`
- [ ] JSON-конфиг содержит блок `actions` с явными переходами
- [ ] Каждый action имеет `stage`, `debit`, `transitions`
- [ ] Transitions покрывают все ветки (последний — `"condition": "always"`)
- [ ] Симуляция проходит с ожидаемым RTP (±0.5%)
- [ ] Гибридные вызовы (`lua:function_name`) — без изменений

---

## 21. Настольные игры (Table Games)

Начиная с текущей версии платформа поддерживает **настольные игры** — блэкджек, рулетку, баккару и другие карточные/настольные игры с крупье. Настольные игры используют `type: "TABLE"` и обязательно Lua-режим (`engine_mode: "lua"`).

### Ключевые отличия от слотов

| Аспект | Слоты (`SLOT`) | Настольные игры (`TABLE`) |
|--------|---------------|---------------------------|
| Режим движка | JSON или Lua | Только Lua |
| Модель раунда | 1 action = 1 раунд (или фиксированное кол-во в бонусе) | Мультишаговый раунд: deal → hit/stand/double → resolve |
| Сессия | Счётчик `SpinsRemaining` | Unlimited (`SpinsRemaining = -1`), завершается по `complete_session` |
| Persistent state | `map[string]float64` (числовые переменные) | `map[string]any` (произвольные структуры: массивы карт, руки, колода) |
| Viewport | Сетка символов `width × height` | Не используется (`0 × 0`) |
| Symbols / Paylines | Определяют математику | Пустые (вся логика в Lua) |

### 21.1. Модель сессии для настольных игр

Для настольных игр сессия создаётся при `deal` и завершается при `complete_session: true`. Между действиями (hit, stand, double, split) количество шагов неопределено.

#### Unlimited sessions

В `session_config.total_spins_var` указывается имя переменной (например, `"_table_unlimited"`), а Lua-скрипт устанавливает её в `-1`:

```lua
variables._table_unlimited = -1
```

Это даёт `SpinsRemaining = -1`, что означает:
- Сессия не завершается по счётчику (нет декремента)
- Сессия проходит валидацию (`SpinsRemaining < 0` считается "unlimited")
- Завершение **только** через `complete_session: true` в transition

#### Завершение раунда

Lua-скрипт сигнализирует о завершении раунда через переменную:

```lua
variables.round_complete = 1
```

Это активирует transition:

```json
{
  "condition": "round_complete == 1",
  "complete_session": true,
  "next_actions": ["deal"]
}
```

### 21.2. Персистентное состояние (`_persist_` конвенция)

Настольные игры хранят между действиями сложное состояние: колоду карт, руки игрока/дилера, фазу раунда и т.д. Поскольку `state.Variables` поддерживает только `float64`, используется конвенция `_persist_`:

#### Сохранение (Lua → Redis)

Lua-скрипт кладёт данные в `state.Data` с prefix `_persist_`:

```lua
-- Сохранить колоду, руки и фазу раунда
data._persist_shoe = gs.shoe              -- массив из 312 карт
data._persist_shoe_pos = gs.shoe_pos      -- число
data._persist_player_hands = gs.player_hands  -- массив объектов
data._persist_dealer_cards = gs.dealer_cards  -- массив
data._persist_phase = gs.phase            -- строка
```

Платформа автоматически:
1. Извлекает все ключи с префиксом `_persist_` из `state.Data`
2. Сохраняет их в `session.PersistentState` (без префикса): `shoe`, `shoe_pos`, `player_hands`, ...
3. Данные сериализуются в JSON и хранятся в Redis

#### Восстановление (Redis → Lua)

При следующем action данные доступны в `state.params` с prefix `_ps_`:

```lua
local gs = {}
gs.shoe         = state.params._ps_shoe           -- массив карт
gs.shoe_pos     = state.params._ps_shoe_pos        -- число (может быть float → floor)
gs.player_hands = state.params._ps_player_hands    -- массив объектов
gs.dealer_cards = state.params._ps_dealer_cards    -- массив
gs.phase        = state.params._ps_phase           -- строка
```

> **Важно**: числовые значения могут вернуться как `float64` после JSON round-trip (Redis → Go → Lua). Используйте `math.floor()` для целых значений:
> ```lua
> gs.shoe_pos = math.floor(state.params._ps_shoe_pos or 1)
> ```

#### Обратная совместимость

Для слотов `PersistentState` по-прежнему хранит `float64` значения в `session_config.persistent_vars`. Конвенция `_persist_` — дополнительный механизм, они не конфликтуют.

### 21.3. Пример: Blackjack

Полный пример реализации блэкджека с крупье (6-deck shoe, dealer stands on soft 17).

#### Конфигурация

```json
{
  "id": "blackjack",
  "type": "TABLE",
  "engine_mode": "lua",
  "script_path": "games/blackjack/script.lua",
  "stages": ["deal", "player_action"],
  "bet_levels": [1, 2, 5, 10, 25, 50, 100],
  "rtp": "99.5",
  "viewport": { "width": 0, "height": 0 },
  "symbols": {},
  "reel_strips": {},
  "paylines": [],
  "logic": {},
  "actions": {
    "deal": {
      "stage": "deal",
      "debit": "bet",
      "credit": "none",
      "transitions": [
        { "condition": "round_complete == 1", "complete_session": true, "next_actions": ["deal"] },
        {
          "condition": "always",
          "creates_session": true,
          "credit_override": "defer",
          "next_actions": ["hit", "stand", "double"],
          "session_config": { "total_spins_var": "_table_unlimited" }
        }
      ]
    },
    "hit":    { "stage": "player_action", "debit": "none", "requires_session": true, "transitions": [...] },
    "stand":  { "stage": "player_action", "debit": "none", "requires_session": true, "transitions": [...] },
    "double": { "stage": "player_action", "debit": "bet",  "requires_session": true, "transitions": [...] },
    "split":  { "stage": "player_action", "debit": "bet",  "requires_session": true, "transitions": [...] }
  }
}
```

#### Lua-скрипт (структура)

```lua
-- Единая точка входа
function execute(state)
    if state.stage == "deal" then
        return do_deal(state)
    elseif state.stage == "player_action" then
        return do_player_action(state)
    end
end

function do_deal(state)
    -- 1. Создать и перемешать shoe (6 колод = 312 карт)
    local shoe = engine.shuffle(create_deck())

    -- 2. Раздать: player, dealer, player, dealer
    local p1, p2 = shoe[1], shoe[3]
    local d1, d2 = shoe[2], shoe[4]

    -- 3. Проверить натуральный блэкджек → round_complete = 1
    -- 4. Иначе → сохранить состояние, вернуть частичную руку дилера

    -- Сохранить persistent state
    data._persist_shoe = shoe
    data._persist_shoe_pos = 5
    data._persist_player_hands = { {cards = {p1, p2}, bet_mult = 1} }
    data._persist_dealer_cards = {d1, d2}

    return {
        total_win = 0,
        variables = { round_complete = 0, _table_unlimited = -1 },
        player_hands = {...},      -- видимые руки
        dealer_hand = {...},       -- только первая карта
        phase = "player_turn",
    }
end

function do_player_action(state)
    -- Восстановить состояние из persistent
    local gs = {
        shoe = state.params._ps_shoe,
        player_hands = state.params._ps_player_hands,
        dealer_cards = state.params._ps_dealer_cards,
    }

    -- Определить действие из имени action
    local action = state.params._action  -- "hit", "stand", "double", "split"

    if action == "hit" then
        -- Добавить карту, проверить bust
    elseif action == "stand" then
        -- Отметить руку как стоящую
    elseif action == "double" then
        -- Удвоить ставку, взять одну карту, stand
    elseif action == "split" then
        -- Разделить на две руки
    end

    -- Проверить: все руки done? → dealer draws → resolve
    if all_hands_done then
        play_dealer(gs)  -- Dealer hits until 17+
        local results, total_payout = resolve_hands(gs)

        return {
            total_win = total_payout - 1,  -- profit multiplier
            variables = { round_complete = 1 },
            player_hands = format_hands(gs.player_hands, results),
            dealer_hand = format_dealer(gs.dealer_cards, false),
            phase = "resolved",
        }
    end

    -- Ещё есть ходы → сохранить и вернуть
    save_game_state(gs, data)
    return {
        total_win = 0,
        variables = { round_complete = 0 },
        player_hands = format_hands(gs.player_hands),
        dealer_hand = format_dealer(gs.dealer_cards, true),  -- hole card hidden
        phase = "player_turn",
        available_actions = get_available_actions(gs),
    }
end
```

#### Игровой цикл (client ↔ server)

```
Client                             Server
  │                                  │
  │ POST /play {action:"deal"}       │
  │ ──────────────────────────────▶  │ 1. Debit bet
  │                                  │ 2. Shuffle & deal
  │                                  │ 3. Create session (unlimited)
  │ ◀──────────────────────────────  │ 4. Return player_hands, dealer_hand (hole hidden)
  │ {next_actions: [hit,stand,dbl]}  │
  │                                  │
  │ POST /play {action:"hit"}        │
  │ ──────────────────────────────▶  │ 5. Restore state from Redis
  │                                  │ 6. Deal card to player
  │ ◀──────────────────────────────  │ 7. Save state, return updated hand
  │ {next_actions: [hit,stand]}      │
  │                                  │
  │ POST /play {action:"stand"}      │
  │ ──────────────────────────────▶  │ 8. Restore state
  │                                  │ 9. Dealer draws (S17)
  │                                  │ 10. Resolve & compare hands
  │                                  │ 11. Complete session, credit win
  │ ◀──────────────────────────────  │ 12. Return results, payouts
  │ {next_actions: [deal]}           │
```

#### Правила выплат

| Результат | Множитель | Выплата при ставке 10 |
|-----------|-----------|----------------------|
| Blackjack (натуральный 21) | 2.5× | 25 (profit: 15) |
| Win | 2.0× | 20 (profit: 10) |
| Push | 1.0× | 10 (profit: 0) |
| Lose | 0.0× | 0 (loss: 10) |
| Insurance win (dealer BJ) | 1.5× от половины ставки | +7.50 |

> **TotalWin** — это **profit multiplier** (выплата минус ставка). Например, blackjack = `1.5` (получил 2.5× bet, минус 1× bet = 1.5× profit). Платформа вычисляет: `profit × bet = реальный выигрыш`.

### Чеклист для новой настольной игры

- [ ] `type: "TABLE"` в конфиге
- [ ] `engine_mode: "lua"`
- [ ] `viewport: { width: 0, height: 0 }` (сетка не нужна)
- [ ] `symbols`, `reel_strips`, `paylines`, `logic` — пустые
- [ ] Каждое действие игрока — отдельный action с `requires_session: true`
- [ ] Первый action (`deal`) — `debit: "bet"`, `creates_session: true`
- [ ] `session_config.total_spins_var` указывает на переменную с `-1`
- [ ] Lua-скрипт использует `_persist_` конвенцию для сложного persistent state
- [ ] Lua-скрипт устанавливает `round_complete = 1` для завершения раунда
- [ ] `complete_session: true` в transition по условию `round_complete == 1`
- [ ] Действия с доплатой (`double`, `split`) имеют `debit: "bet"`
- [ ] `state.params._action` используется для определения типа действия в Lua

---

## Связанная документация

- [game_engine_design.md](game_engine_design.md) — дизайн движка (техническая архитектура)
- [game_sdk_reference.md](game_sdk_reference.md) — полная документация клиентского SDK
- [game_bridge_protocol.md](game_bridge_protocol.md) — протокол postMessage
- [api_protocol.md](api_protocol.md) — REST API эндпоинты
- [architecture.md](architecture.md) — архитектура платформы
