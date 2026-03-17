/* ═══════════════════════════════════════════════════════════════
   Sweet Cascade 1024 — Main Game Scene
   ═══════════════════════════════════════════════════════════════ */
import { Scene, Tween, Easing } from '@energy8platform/game-engine';
import {
  Container, Sprite, Graphics, Text, TextStyle,
  Assets, Texture, FederatedPointerEvent, Circle,
} from 'pixi.js';
import {
  GRID_COLS, GRID_ROWS, TOTAL_CELLS,
  SYMBOLS, BET_STEPS, ALL_SYMBOL_IDS,
  DESIGN_WIDTH, DESIGN_HEIGHT,
  getMultiplierColor, CLUSTER_PAYOUTS, MIN_CLUSTER_SIZE,
} from '../config/gameConfig';
import type { PlayResultData, SessionData } from '@energy8platform/game-sdk';
import type { CellData, Cluster } from '../engine/ClusterEngine';
import { findClusters, getWinningPositions } from '../engine/ClusterEngine';
import { generateGrid, countScatters } from '../engine/CascadeEngine';
import { MultiplierGrid } from '../engine/MultiplierSystem';
import type { SpinResult, CascadeStep } from '../engine/SpinResolver';
import { getAudioManager, getGameSdk, getInputManager } from '../runtime/gameRuntime';
import type { BuyBonusData, GamePlayData, SerializedSpinResult } from '../runtime/sdkPlayTransport';
import { deserializeSpinResult } from '../runtime/sdkPlayTransport';

/* ═══════════════════════════════════════════════════════════════ */
export class GameScene extends Scene {
  /* ─── Viewport cache (set by onResize) ─────────────────────── */
  private _w = 0;
  private _h = 0;

  /* ─── State ────────────────────────────────────────────────── */
  private grid: CellData[] = [];
  private balance = 0;
  private pendingBalanceDisplay: number | null = null;
  private betIndex = 3;
  private lastWin = 0;
  private spinning = false;
  private inFreeSpins = false;
  private freeSpinsRemaining = 0;
  private freeSpinsTotalWin = 0;
  private fsScatterBoost = 1;
  private multiplierGrid = new MultiplierGrid();
  private autoplayActive = false;
  private autoplayRemaining = 0;
  private bonusBuyDrop = false;
  private muted = false;
  private currentRoundId: string | null = null;
  private freeSpinsSuperMode = false;
  private readonly onSpaceSpin = ({ code }: { code: string; key: string }) => {
    if (code !== 'Space') return;
    void this.onSpinPress();
  };
  private readonly onBalanceUpdate = ({ balance }: { balance: number }) => {
    this.setBalance(balance);
  };

  /* ─── Display layers ───────────────────────────────────────── */
  private bgSprite!: Sprite;
  private bgFreeSprite!: Sprite;
  private gridContainer!: Container;
  private symbolSprites: Sprite[] = [];
  private multiplierOverlay!: Container;
  private multiplierTexts: (Text | null)[] = [];
  private multiplierBgs: (Graphics | null)[] = [];
  private winOverlay!: Container;
  private uiContainer!: Container;
  private gridFrame!: Graphics;

  /* ─── Layout ───────────────────────────────────────────────── */
  private cellSize = 0;
  private cellGap = 4;
  private gridX = 0;
  private gridY = 0;

  /* ─── UI ───────────────────────────────────────────────────── */
  private balanceLabel!: Text;
  private balanceValueLabel!: Text;
  private betLabel!: Text;
  private betValueLabel!: Text;
  private winLabel!: Text;
  private winValueLabel!: Text;
  private spinBtn!: Container;
  private spinBtnSprite!: Sprite;
  private spinSwirlGfx!: Graphics;
  private freeSpinsLabel!: Text;
  private buyBtnStandard!: Container;
  private buyBtnSuper!: Container;
  private autoBtn!: Container;
  private bottomPanel!: Container;
  private bottomPanelSprite!: Sprite;
  private betMinusBtn!: Container;
  private betPlusBtn!: Container;
  private paytableBtn!: Container;
  private muteBtn!: Container;

  /* ─── Candy font style factory ─────────────────────────────── */
  private static readonly CANDY_FONT = '"Fredoka One", "Baloo 2", "Titan One", "Comic Sans MS", "Arial Rounded MT Bold", sans-serif';

  private candyStyle(size: number, fill: number = 0xffffff, opts: Partial<TextStyle> = {}): TextStyle {
    return new TextStyle({
      fontFamily: GameScene.CANDY_FONT,
      fontWeight: 'bold',
      fontSize: size,
      fill,
      stroke: { color: 0x4a2010, width: Math.max(2, size * 0.08) },
      dropShadow: {
        color: 0x000000,
        blur: Math.max(3, size * 0.12),
        distance: Math.max(2, size * 0.06),
        alpha: 0.7,
      },
      letterSpacing: 1,
      ...opts,
    });
  }

  private asNumber(value: unknown, fallback = 0): number {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  private formatCurrency(value: unknown, digits = 2): string {
    return `$${this.asNumber(value).toFixed(digits)}`;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private setBalance(balance: number, deferDisplay = this.spinning): void {
    this.balance = balance;

    if (deferDisplay) {
      this.pendingBalanceDisplay = balance;
      return;
    }

    this.pendingBalanceDisplay = null;
    this.updateBalanceDisplay();
  }

  private flushPendingBalanceDisplay(): void {
    if (this.pendingBalanceDisplay === null) {
      return;
    }

    this.balance = this.pendingBalanceDisplay;
    this.pendingBalanceDisplay = null;
    this.updateBalanceDisplay();
  }

  /* ─── Scene lifecycle ───────────────────────────────────────── */
  async onEnter() {
    this.grid = generateGrid(true);
    this.balance = getGameSdk()?.balance ?? this.balance;
    this.buildScene();
    this.buildUI();
    this.layoutAll();
    this.syncMuteState();
    this.playMusic('bgm');
    getInputManager()?.on('keydown', this.onSpaceSpin);
    getGameSdk()?.on('balanceUpdate', this.onBalanceUpdate);
  }

  async onExit() {
    this.superPulseActive = false;
    this.stopMusic();
    getInputManager()?.off('keydown', this.onSpaceSpin);
    getGameSdk()?.off('balanceUpdate', this.onBalanceUpdate);
  }

  onDestroy() {
    this.superPulseActive = false;
    this.stopMusic();
    Tween.killAll();
    getInputManager()?.off('keydown', this.onSpaceSpin);
    getGameSdk()?.off('balanceUpdate', this.onBalanceUpdate);
  }

  onResize(w: number, h: number) {
    this._w = w;
    this._h = h;
    if (this.bgSprite) this.layoutAll();
  }

  onUpdate(_dt: number) {
    this.updateScatterPulse();
  }

  /* ─── Build scene — Layer system ─────────────────────────────── */
  private buildScene() {
    /* ═══ Layer 0: Background ═══ */
    const bgTex = Assets.get('bg');
    this.bgSprite = new Sprite(bgTex);
    this.bgSprite.anchor.set(0.5);
    this.container.addChild(this.bgSprite);

    const bgFreeTex = Assets.get('bg_freespins');
    this.bgFreeSprite = new Sprite(bgFreeTex);
    this.bgFreeSprite.anchor.set(0.5);
    this.bgFreeSprite.alpha = 0;
    this.container.addChild(this.bgFreeSprite);

    /* ═══ Layer 1: Grid (field + symbols) ═══ */
    this.gridFrame = new Graphics();
    this.container.addChild(this.gridFrame);

    this.multiplierOverlay = new Container();
    this.container.addChild(this.multiplierOverlay);

    for (let i = 0; i < TOTAL_CELLS; i++) {
      this.multiplierTexts.push(null);
      this.multiplierBgs.push(null);
    }

    this.gridContainer = new Container();
    this.container.addChild(this.gridContainer);

    for (let i = 0; i < TOTAL_CELLS; i++) {
      const tex = Assets.get(this.grid[i].id);
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      this.gridContainer.addChild(sprite);
      this.symbolSprites.push(sprite);
    }

    /* ═══ Layer 2: UI Controls (always above grid) ═══ */
    this.uiContainer = new Container();
    this.container.addChild(this.uiContainer);

    /* ═══ Layer 3: VFX & Pop-ups (above everything) ═══ */
    this.winOverlay = new Container();
    this.container.addChild(this.winOverlay);
  }

  /* ─── Build UI — 3D Glossy Candy Theme ──────────────────────── */
  private buildUI() {
    /* ── Load Google Font ──────────────────────────────────── */
    this.loadCandyFont();

    /* ══════════════════════════════════════════════════════════
       BOTTOM DASHBOARD — Biscuit panel with frosting
       ══════════════════════════════════════════════════════════ */
    this.bottomPanel = new Container();
    this.uiContainer.addChild(this.bottomPanel);

    // Panel sprite (hidden — replaced by clean glass overlay)
    this.bottomPanelSprite = new Sprite(Assets.get('bottom_panel'));
    this.bottomPanelSprite.anchor.set(0.5);
    this.bottomPanelSprite.alpha = 0;
    this.bottomPanel.addChild(this.bottomPanelSprite);

    // Frosted glass overlay on panel
    const panelGlass = new Graphics();
    this.bottomPanel.addChild(panelGlass);
    (this.bottomPanel as any)._glass = panelGlass;

    /* ── Balance block (left) ────────────────────────────── */
    const balanceBlock = new Container();
    balanceBlock.name = 'balanceBlock';

    // Balance frame (hidden)
    const balFrame = new Sprite(Assets.get('balance_frame'));
    balFrame.anchor.set(0.5);
    balFrame.name = 'balFrame';
    balFrame.alpha = 0;
    balanceBlock.addChild(balFrame);

    this.balanceLabel = new Text({
      text: 'BALANCE',
      style: this.candyStyle(11, 0xffe0b2),
    });
    this.balanceLabel.anchor.set(0.5, 0.5);
    balanceBlock.addChild(this.balanceLabel);

    this.balanceValueLabel = new Text({
      text: this.formatCurrency(this.balance),
      style: this.candyStyle(18, 0xffd700),
    });
    this.balanceValueLabel.anchor.set(0.5, 0.5);
    balanceBlock.addChild(this.balanceValueLabel);

    this.bottomPanel.addChild(balanceBlock);

    /* ── Bet block (center) ──────────────────────────────── */
    const betBlock = new Container();
    betBlock.name = 'betBlock';

    // Minus button
    this.betMinusBtn = new Container();
    this.betMinusBtn.eventMode = 'static';
    this.betMinusBtn.cursor = 'pointer';
    this.betMinusBtn.name = 'betMinus';
    const minusText = new Text({ text: '−', style: this.candyStyle(33, 0xffe0b2) });
    minusText.anchor.set(0.5);
    this.betMinusBtn.addChild(minusText);
    this.addExpandedHitArea(this.betMinusBtn, 1.2);
    this.betMinusBtn.on('pointerdown', () => {
      this.changeBet(-1);
    });
    betBlock.addChild(this.betMinusBtn);

    // Bet label
    this.betLabel = new Text({
      text: 'BET',
      style: this.candyStyle(11, 0xffe0b2),
    });
    this.betLabel.anchor.set(0.5, 0.5);
    betBlock.addChild(this.betLabel);

    this.betValueLabel = new Text({
      text: this.formatCurrency(this.currentBet),
      style: this.candyStyle(18, 0xffd700),
    });
    this.betValueLabel.anchor.set(0.5, 0.5);
    betBlock.addChild(this.betValueLabel);

    // Plus button
    this.betPlusBtn = new Container();
    this.betPlusBtn.eventMode = 'static';
    this.betPlusBtn.cursor = 'pointer';
    this.betPlusBtn.name = 'betPlus';
    const plusText = new Text({ text: '+', style: this.candyStyle(33, 0xffe0b2) });
    plusText.anchor.set(0.5);
    this.betPlusBtn.addChild(plusText);
    this.addExpandedHitArea(this.betPlusBtn, 1.2);
    this.betPlusBtn.on('pointerdown', () => {
      this.changeBet(1);
    });
    betBlock.addChild(this.betPlusBtn);

    this.bottomPanel.addChild(betBlock);

    /* ── Win block (right-center) ────────────────────────── */
    const winBlock = new Container();
    winBlock.name = 'winBlock';

    this.winLabel = new Text({
      text: 'WIN',
      style: this.candyStyle(11, 0xffe0b2),
    });
    this.winLabel.anchor.set(0.5, 0.5);
    winBlock.addChild(this.winLabel);

    this.winValueLabel = new Text({
      text: '$0.00',
      style: this.candyStyle(22, 0xffd700),
    });
    this.winValueLabel.anchor.set(0.5, 0.5);
    winBlock.addChild(this.winValueLabel);

    this.bottomPanel.addChild(winBlock);

    /* ══════════════════════════════════════════════════════════
       FREE SPINS LABEL
       ══════════════════════════════════════════════════════════ */
    this.freeSpinsLabel = new Text({
      text: '',
      style: this.candyStyle(26, 0xff69b4),
    });
    this.freeSpinsLabel.anchor.set(0.5, 0.5);
    this.freeSpinsLabel.alpha = 0;
    this.uiContainer.addChild(this.freeSpinsLabel);

    /* ══════════════════════════════════════════════════════════
       SPIN BUTTON — Giant 3D Lollipop
       ══════════════════════════════════════════════════════════ */
    this.spinBtn = new Container();
    this.spinBtn.eventMode = 'static';
    this.spinBtn.cursor = 'pointer';

    // Swirl animation layer (behind the sprite)
    this.spinSwirlGfx = new Graphics();
    this.spinBtn.addChild(this.spinSwirlGfx);

    // 3D Lollipop sprite
    this.spinBtnSprite = new Sprite(Assets.get('spin_btn_3d'));
    this.spinBtnSprite.anchor.set(0.5);
    this.spinBtn.addChild(this.spinBtnSprite);

    // Gloss highlight overlay
    const spinGloss = new Graphics();
    this.spinBtn.addChild(spinGloss);
    (this.spinBtn as any)._gloss = spinGloss;

    this.addExpandedHitArea(this.spinBtn, 1.18);
    this.spinBtn.on('pointerdown', () => {
      this.animateSpinButtonPress();
      this.onSpinPress();
    });
    this.uiContainer.addChild(this.spinBtn);

    /* ══════════════════════════════════════════════════════════
       AUTO BUTTON — Cookie Gear
       ══════════════════════════════════════════════════════════ */
    this.autoBtn = new Container();
    this.autoBtn.eventMode = 'static';
    this.autoBtn.cursor = 'pointer';
    const autoCookieSprite = new Sprite(Assets.get('auto_btn_cookie'));
    autoCookieSprite.anchor.set(0.5);
    this.autoBtn.addChild(autoCookieSprite);
    const autoText = new Text({
      text: 'AUTO',
      style: this.candyStyle(10, 0xffffff),
    });
    autoText.anchor.set(0.5);
    this.autoBtn.addChild(autoText);
    this.addExpandedHitArea(this.autoBtn, 1.2);
    this.autoBtn.on('pointerdown', () => {
      this.toggleAutoplay();
      this.animateButtonPress(this.autoBtn);
    });
    this.uiContainer.addChild(this.autoBtn);

    /* ══════════════════════════════════════════════════════════
       BUY BONUS BUTTONS — Gift Boxes
       ══════════════════════════════════════════════════════════ */
    // Standard FS — Gift box with ribbon
    this.buyBtnStandard = new Container();
    this.buyBtnStandard.eventMode = 'static';
    this.buyBtnStandard.cursor = 'pointer';
    const buyFsSprite = new Sprite(Assets.get('buy_fs_box'));
    buyFsSprite.anchor.set(0.5);
    this.buyBtnStandard.addChild(buyFsSprite);
    // Tag text
    const buyFsTag = new Text({
      text: 'FREE SPINS\nBUY',
      style: this.candyStyle(10, 0x90ee90, { align: 'center' }),
    });
    buyFsTag.anchor.set(0.5, 0);
    this.buyBtnStandard.addChild(buyFsTag);
    this.addExpandedHitArea(this.buyBtnStandard, 1.15);
    this.buyBtnStandard.on('pointerdown', () => {
      this.buyBonus(false);
      this.animateButtonPress(this.buyBtnStandard);
    });
    this.uiContainer.addChild(this.buyBtnStandard);

    // Super FS — Golden VIP box with crown
    this.buyBtnSuper = new Container();
    this.buyBtnSuper.eventMode = 'static';
    this.buyBtnSuper.cursor = 'pointer';
    const buySuperSprite = new Sprite(Assets.get('buy_super_box'));
    buySuperSprite.anchor.set(0.5);
    this.buyBtnSuper.addChild(buySuperSprite);
    const buySuperTag = new Text({
      text: 'SUPER FS\nBUY',
      style: this.candyStyle(10, 0xffd700, { align: 'center' }),
    });
    buySuperTag.anchor.set(0.5, 0);
    this.buyBtnSuper.addChild(buySuperTag);
    this.addExpandedHitArea(this.buyBtnSuper, 1.15);
    this.buyBtnSuper.on('pointerdown', () => {
      this.buyBonus(true);
      this.animateButtonPress(this.buyBtnSuper);
    });
    this.uiContainer.addChild(this.buyBtnSuper);

    // Start pulsing animation for Super Buy button
    this.startSuperBuyPulse();

    /* ══════════════════════════════════════════════════════════
       PAYTABLE BUTTON — "i" info circle
       ══════════════════════════════════════════════════════════ */
    this.paytableBtn = new Container();
    this.paytableBtn.eventMode = 'static';
    this.paytableBtn.cursor = 'pointer';
    const infoBg = new Graphics();
    infoBg.circle(0, 0, 18);
    infoBg.fill({ color: 0x5522aa, alpha: 0.85 });
    infoBg.circle(0, 0, 18);
    infoBg.stroke({ color: 0xffd700, width: 2, alpha: 0.8 });
    this.paytableBtn.addChild(infoBg);
    const infoLabel = new Text({ text: 'i', style: this.candyStyle(20, 0xffd700) });
    infoLabel.anchor.set(0.5);
    this.paytableBtn.addChild(infoLabel);
    this.paytableBtn.hitArea = new Circle(0, 0, 24);
    this.addExpandedHitArea(this.paytableBtn, 1.2);
    this.paytableBtn.on('pointerdown', () => {
      this.animateButtonPress(this.paytableBtn);
      this.showPaytable();
    });
    this.uiContainer.addChild(this.paytableBtn);

    /* ══════════════════════════════════════════════════════════
       MUTE BUTTON — speaker icon toggle
       ══════════════════════════════════════════════════════════ */
    this.muteBtn = new Container();
    this.muteBtn.eventMode = 'static';
    this.muteBtn.cursor = 'pointer';
    const muteBg = new Graphics();
    muteBg.circle(0, 0, 18);
    muteBg.fill({ color: 0x5522aa, alpha: 0.85 });
    muteBg.circle(0, 0, 18);
    muteBg.stroke({ color: 0xffd700, width: 2, alpha: 0.8 });
    this.muteBtn.addChild(muteBg);
    const muteLabel = new Text({ text: '\uD83D\uDD0A', style: this.candyStyle(18, 0xffd700) });
    muteLabel.anchor.set(0.5);
    this.muteBtn.addChild(muteLabel);
    this.muteBtn.hitArea = new Circle(0, 0, 24);
    this.addExpandedHitArea(this.muteBtn, 1.2);
    this.muteBtn.on('pointerdown', () => {
      this.animateButtonPress(this.muteBtn);
      this.toggleMute();
    });
    this.uiContainer.addChild(this.muteBtn);

    if (this._w > 0) this.layoutUI(this._w, this._h, this._h > this._w);
  }

  /* ─── Load Google Web Font ─────────────────────────────────── */
  private loadCandyFont() {
    if (!document.getElementById('candy-font-link')) {
      const link = document.createElement('link');
      link.id = 'candy-font-link';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Fredoka+One&family=Baloo+2:wght@700;800&display=swap';
      document.head.appendChild(link);
    }
  }

  /* ─── Squash & Stretch animation for buttons ───────────────── */
  private async animateButtonPress(btn: Container) {
    btn.scale.set(1, 1);
    const origSx = 1;
    const origSy = 1;
    // Squash
    await Tween.to(btn, {
      'scale.x': origSx * 1.15,
      'scale.y': origSy * 0.85,
    }, 80, Easing.easeInCubic);
    // Stretch back with overshoot
    await Tween.to(btn, {
      'scale.x': origSx * 0.95,
      'scale.y': origSy * 1.1,
    }, 100, Easing.easeOutBack);
    // Settle
    await Tween.to(btn, {
      'scale.x': origSx,
      'scale.y': origSy,
    }, 120, Easing.easeOutCubic);
  }

  /* ─── Spin button press — Jelly squash + swirl kick ────────── */
  private async animateSpinButtonPress() {
    const btn = this.spinBtn;
    btn.scale.set(1, 1);
    const origSx = 1;
    const origSy = 1;
    // Heavy squash (jelly effect)
    await Tween.to(btn, {
      'scale.x': origSx * 1.25,
      'scale.y': origSy * 0.75,
    }, 100, Easing.easeInCubic);
    // Elastic stretch
    await Tween.to(btn, {
      'scale.x': origSx * 0.9,
      'scale.y': origSy * 1.15,
    }, 150, Easing.easeOutBack);
    // Settle
    await Tween.to(btn, {
      'scale.x': origSx,
      'scale.y': origSy,
    }, 200, Easing.easeOutCubic);
  }

  /* ─── Super Buy button pulse animation ─────────────────────── */
  private superPulseActive = true;
  private async startSuperBuyPulse() {
    while (this.superPulseActive) {
      if (this.buyBtnSuper.alpha > 0) {
        await Tween.to(this.buyBtnSuper, { 'scale.x': 1.06, 'scale.y': 1.06 }, 800, Easing.easeOutCubic);
        await Tween.to(this.buyBtnSuper, { 'scale.x': 1, 'scale.y': 1 }, 800, Easing.easeOutCubic);
      }
      await Tween.delay(200);
    }
  }

  /* ─── Layout ───────────────────────────────────────────────── */
  private layoutAll() {
    const w = this._w;
    const h = this._h;
    const isPortrait = h > w;
    const compactViewport = w < 1100 || h < 700;

    // Background
    this.bgSprite.position.set(w / 2, h / 2);
    const bgScale = Math.max(w / this.bgSprite.texture.width, h / this.bgSprite.texture.height);
    this.bgSprite.scale.set(bgScale);
    this.bgFreeSprite.position.set(w / 2, h / 2);
    this.bgFreeSprite.scale.set(bgScale);

    // Calculate grid layout
    const gridAreaW = isPortrait ? w * 0.92 : w * 0.55;
    const reservedBottom = isPortrait
      ? Math.max(230, h * 0.26)
      : compactViewport
        ? Math.max(110, h * 0.22)
        : Math.max(86, h * 0.15);
    const topInset = isPortrait ? Math.max(72, h * 0.09) : Math.max(24, h * 0.05);
    const maxGridAreaH = Math.max(220, h - topInset - reservedBottom);
    const gridAreaH = Math.min(isPortrait ? h * 0.55 : h * 0.75, maxGridAreaH);
    this.cellSize = Math.floor(Math.min(
      gridAreaW / GRID_COLS,
      gridAreaH / GRID_ROWS,
    ) - this.cellGap);
    const gridW = GRID_COLS * (this.cellSize + this.cellGap) - this.cellGap;
    const gridH = GRID_ROWS * (this.cellSize + this.cellGap) - this.cellGap;

    this.gridX = (w - gridW) / 2;
    this.gridY = isPortrait
      ? this.clamp(h * 0.12, topInset, h - reservedBottom - gridH)
      : this.clamp((h - reservedBottom - gridH) / 2, topInset, h - reservedBottom - gridH);

    // Grid frame
    this.gridFrame.clear();
    this.gridFrame.roundRect(this.gridX - 12, this.gridY - 12, gridW + 24, gridH + 24, 16);
    this.gridFrame.fill({ color: 0x1a0a2e, alpha: 0.65 });
    this.gridFrame.stroke({ color: 0xffd700, width: 3, alpha: 0.4 });

    // Position symbols
    this.positionSymbols();

    // Position multiplier spots
    this.updateMultiplierDisplay();

    // UI layout
    this.layoutUI(w, h, isPortrait);
  }

  private positionSymbols() {
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const sprite = this.symbolSprites[i];
      const x = this.gridX + col * (this.cellSize + this.cellGap) + this.cellSize / 2;
      const y = this.gridY + row * (this.cellSize + this.cellGap) + this.cellSize / 2;
      sprite.position.set(x, y);
      const scale = (this.cellSize * 0.85) / Math.max(sprite.texture.width, sprite.texture.height);
      sprite.scale.set(scale);
    }
  }

  private scatterPulseTime = 0;
  private updateScatterPulse() {
    this.scatterPulseTime += 0.05;
    const pulse = 1 + Math.sin(this.scatterPulseTime * 3) * 0.08;
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (this.grid[i]?.id === 'scatter') {
        const sprite = this.symbolSprites[i];
        const baseScale = (this.cellSize * 0.85) / Math.max(sprite.texture.width, sprite.texture.height);
        sprite.scale.set(baseScale * pulse);
      }
    }
  }

  private layoutUI(w: number, h: number, isPortrait: boolean) {
    const gridW = GRID_COLS * (this.cellSize + this.cellGap) - this.cellGap;
    const gridH = GRID_ROWS * (this.cellSize + this.cellGap) - this.cellGap;

    if (isPortrait) {
      this.layoutMobile(w, h, gridW, gridH);
    } else {
      this.layoutDesktop(w, h, gridW, gridH);
    }

    /* ── Free spins label (shared) ─────────────────────── */
    this.freeSpinsLabel.position.set(w / 2, Math.max(32, this.gridY - 30));
  }

  /* ════════════════════════════════════════════════════════════
     DESKTOP — Landscape layout
     Bottom bar (balance – bet – win – spin) + left side buy
     ════════════════════════════════════════════════════════════ */
  private layoutDesktop(w: number, h: number, gridW: number, gridH: number) {
    const compactViewport = w < 1100 || h < 700;
    const edgePadding = compactViewport ? 12 : 18;

    /* ── Bottom bar — under game field ─────────────────────── */
    const barH = compactViewport ? 54 : 60;
    const barW = gridW;
    const barX = this.gridX + gridW / 2;
    const gridBottom = this.gridY + gridH;
    const barY = this.clamp(
      gridBottom + barH / 2 + (compactViewport ? 12 : 20),
      barH / 2 + edgePadding,
      h - barH / 2 - edgePadding,
    );

    this.bottomPanel.position.set(barX, barY);

    const glass = (this.bottomPanel as any)._glass as Graphics;
    glass.clear();
    glass.roundRect(-barW / 2, -barH / 2, barW, barH, 16);
    glass.fill({ color: 0x1a0a2e, alpha: 0.55 });

    /* Left: BALANCE */
    const balBlock = this.bottomPanel.getChildByName('balanceBlock') as Container;
    if (balBlock) {
      balBlock.position.set(-barW * 0.36, 0);
      this.balanceLabel.position.set(0, -12);
      this.balanceValueLabel.position.set(0, 10);
    }

    /* Center: BET with ± */
    const betBlock = this.bottomPanel.getChildByName('betBlock') as Container;
    if (betBlock) {
      betBlock.position.set(0, 0);
      this.betLabel.position.set(0, -12);
      this.betValueLabel.position.set(0, 10);
      const spacing = Math.max(barW * 0.05, 72);
      this.betMinusBtn.position.set(-spacing, 6);
      this.betPlusBtn.position.set(spacing, 6);
    }

    /* Right: WIN */
    const winBlock = this.bottomPanel.getChildByName('winBlock') as Container;
    if (winBlock) {
      winBlock.position.set(barW * 0.36, 0);
      this.winLabel.position.set(0, -12);
      this.winValueLabel.position.set(0, 10);
    }

    /* ── SPIN — 1.5x larger, at right-bottom corner of grid ── */
    const spinSize = Math.min(compactViewport ? 96 : 110, h * (compactViewport ? 0.135 : 0.15)) * (compactViewport ? 1.22 : 1.5);
    const spinScale = spinSize / Math.max(this.spinBtnSprite.texture.width, this.spinBtnSprite.texture.height);
    this.spinBtnSprite.scale.set(spinScale);
    const gridRight = this.gridX + gridW;
    const spinX = this.clamp(gridRight + spinSize * 0.55, spinSize * 0.58 + edgePadding, w - spinSize * 0.58 - edgePadding);
    const spinY = this.clamp(
      gridBottom - spinSize * 0.22,
      spinSize * 0.55 + edgePadding,
      barY - barH / 2 - spinSize * 0.5 - 10,
    );
    this.spinBtn.position.set(spinX, spinY);

    const gloss = (this.spinBtn as any)._gloss as Graphics;
    gloss.clear();
    const glossR = spinSize * 0.4;
    gloss.ellipse(0, -glossR * 0.2, glossR * 0.55, glossR * 0.3);
    gloss.fill({ color: 0xffffff, alpha: 0.25 });

    /* ── AUTO — 2x bigger, above spin ────────────────────── */
    const autoSize = spinSize * 0.55;
    const autoCookie = this.autoBtn.getChildAt(1) as Sprite;
    autoCookie.scale.set(autoSize / Math.max(autoCookie.texture.width, autoCookie.texture.height));
    this.autoBtn.position.set(this.spinBtn.x, this.clamp(this.spinBtn.y - spinSize * 0.82, autoSize * 0.6 + edgePadding, this.spinBtn.y - autoSize * 0.75));

    /* ── BUY BONUS — left side of grid, mirroring auto/spin ── */
    const buySize = Math.min(compactViewport ? 58 : 70, h * 0.1) * (compactViewport ? 1.55 : 2);
    const buyCenterX = Math.max(edgePadding + buySize * 0.52, this.gridX - buySize * 0.65);

    this.scaleBuyBtn(this.buyBtnStandard, buySize);
    this.buyBtnStandard.position.set(
      buyCenterX,
      this.clamp(this.autoBtn.y - buySize * 0.8, buySize * 0.6 + edgePadding, h - buySize * 2.5 - edgePadding),
    );

    this.scaleBuyBtn(this.buyBtnSuper, buySize * 1.1);
    this.buyBtnSuper.position.set(
      buyCenterX,
      this.clamp(this.spinBtn.y, this.buyBtnStandard.y + buySize * 1.05, h - buySize * 1.15 - edgePadding),
    );

    /* ── Paytable + Mute buttons — further left of grid ────── */
    const iconX = Math.max(34, this.gridX - 45);
    this.paytableBtn.position.set(iconX, this.clamp(this.gridY + 42, 34, h - 84));
    this.muteBtn.position.set(iconX, this.clamp(this.gridY + 92, 70, h - 34));
  }

  /* ════════════════════════════════════════════════════════════
     MOBILE — Portrait layout (Thumb Zone)
     Spin centered/right bottom, bet compact, buy top corners
     ════════════════════════════════════════════════════════════ */
  private layoutMobile(w: number, h: number, gridW: number, gridH: number) {
    const gridBottom = this.gridY + gridH;
    const sideInset = Math.max(12, w * 0.03);
    const bottomInset = Math.max(8, h * 0.015);

    /* ── Bottom bar — balance / bet / win ─────────────────── */
    const barH = Math.min(58, Math.max(48, h * 0.06));
    const barW = w - sideInset * 2;
    const barX = w / 2;
    const barY = h - barH / 2 - bottomInset;

    this.bottomPanel.position.set(barX, barY);

    const psTex = this.bottomPanelSprite.texture;
    this.bottomPanelSprite.scale.set(barW / psTex.width, barH / psTex.height);

    const glass = (this.bottomPanel as any)._glass as Graphics;
    glass.clear();
    glass.roundRect(-barW / 2, -barH / 2, barW, barH, 12);
    glass.fill({ color: 0x1a0a2e, alpha: 0.55 });

    /* Balance — left */
    const balBlock = this.bottomPanel.getChildByName('balanceBlock') as Container;
    if (balBlock) {
      balBlock.position.set(-barW * 0.32, 0);
      this.balanceLabel.position.set(0, -10);
      this.balanceValueLabel.position.set(0, 10);
    }

    /* Bet — center */
    const betBlock = this.bottomPanel.getChildByName('betBlock') as Container;
    if (betBlock) {
      betBlock.position.set(0, 0);
      this.betLabel.position.set(0, -10);
      this.betValueLabel.position.set(0, 10);
      const spacing = Math.max(barW * 0.07, 64);
      this.betMinusBtn.position.set(-spacing, 6);
      this.betPlusBtn.position.set(spacing, 6);
    }

    /* Win — right */
    const winBlock = this.bottomPanel.getChildByName('winBlock') as Container;
    if (winBlock) {
      winBlock.position.set(barW * 0.32, 0);
      this.winLabel.position.set(0, -10);
      this.winValueLabel.position.set(0, 10);
    }

    const controlTop = gridBottom + Math.max(14, h * 0.018);
    const controlBottom = barY - barH / 2 - Math.max(18, h * 0.022);
    const controlBandHeight = Math.max(132, controlBottom - controlTop);

    /* ── SPIN — centered below grid ──────────────────────── */
    const spinSize = this.clamp(
      Math.min(w * 0.24, controlBandHeight * 0.62),
      Math.min(90, w * 0.2),
      132,
    );
    const spinScale = spinSize / Math.max(this.spinBtnSprite.texture.width, this.spinBtnSprite.texture.height);
    this.spinBtnSprite.scale.set(spinScale);
    const spinY = this.clamp(
      controlTop + controlBandHeight * 0.45,
      controlTop + spinSize * 0.52,
      controlBottom - spinSize * 0.52,
    );
    this.spinBtn.position.set(w / 2, spinY);

    const gloss = (this.spinBtn as any)._gloss as Graphics;
    gloss.clear();
    const glossR = spinSize * 0.4;
    gloss.ellipse(0, -glossR * 0.2, glossR * 0.55, glossR * 0.3);
    gloss.fill({ color: 0xffffff, alpha: 0.25 });

    /* ── AUTO — right of spin ────────────────────────────── */
    const autoSize = spinSize * 0.42;
    const autoCookie = this.autoBtn.getChildAt(1) as Sprite;
    autoCookie.scale.set(autoSize / Math.max(autoCookie.texture.width, autoCookie.texture.height));
    this.autoBtn.position.set(
      this.clamp(this.spinBtn.x + spinSize * 0.74, sideInset + autoSize * 0.55, w - sideInset - autoSize * 0.55),
      this.clamp(spinY, controlTop + autoSize * 0.55, controlBottom - autoSize * 0.55),
    );

    /* ── BUY BONUS — left of spin ────────────────────────── */
    const buySize = this.clamp(Math.min(58, w * 0.13), 46, 60);

    this.scaleBuyBtn(this.buyBtnStandard, buySize);
    const buyX = this.clamp(this.spinBtn.x - spinSize * 0.78, sideInset + buySize * 0.55, w - sideInset - buySize * 0.55);
    this.buyBtnStandard.position.set(
      buyX,
      this.clamp(spinY - buySize * 0.82, controlTop + buySize * 0.5, controlBottom - buySize * 1.7),
    );

    this.scaleBuyBtn(this.buyBtnSuper, buySize);
    this.buyBtnSuper.position.set(
      buyX,
      this.clamp(this.buyBtnStandard.y + buySize * 1.68, this.buyBtnStandard.y + buySize * 1.1, controlBottom - buySize * 0.55),
    );

    /* ── Paytable + Mute — below SuperFS and Auto ─────────── */
    const superFsBottom = this.buyBtnSuper.y + buySize * 0.7;
    const autoBottom = this.autoBtn.y + autoSize * 0.6;
    const iconRowY = this.clamp(
      Math.max(superFsBottom, autoBottom) + Math.max(42, h * 0.045),
      controlTop + 36,
      controlBottom - 24,
    );
    this.paytableBtn.position.set(this.buyBtnStandard.x, iconRowY);
    this.muteBtn.position.set(this.autoBtn.x, iconRowY);
  }

  /* ── Helper to scale buy button sprites ──────────────────── */
  private scaleBuyBtn(btn: Container, size: number) {
    const spr = btn.getChildAt(1) as Sprite;
    const sc = size / Math.max(spr.texture.width, spr.texture.height);
    spr.scale.set(sc);
    const tag = btn.getChildAt(2) as Text;
    tag.position.set(0, size * 0.52);
  }

  /* ─── Getters ──────────────────────────────────────────────── */
  get currentBet(): number {
    return BET_STEPS[this.betIndex];
  }

  /* ─── Bet change ───────────────────────────────────────────── */
  private changeBet(dir: number) {
    if (this.spinning || this.inFreeSpins) return;
    this.betIndex = Math.max(0, Math.min(BET_STEPS.length - 1, this.betIndex + dir));
    this.betValueLabel.text = this.formatCurrency(this.currentBet);
  }

  /* ─── Audio ────────────────────────────────────────────────── */
  private playSound(alias: string, category: 'music' | 'sfx' | 'ui' | 'ambient' = 'sfx', volume = 1) {
    getAudioManager()?.play(alias, category, { volume });
  }

  private playMusic(alias: string) {
    getAudioManager()?.playMusic(alias);
  }

  private stopMusic() {
    getAudioManager()?.stopMusic();
  }

  private syncMuteState() {
    this.muted = getAudioManager()?.muted ?? false;
    const label = this.muteBtn.getChildAt(2) as Text;
    label.text = this.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
  }

  private toggleMute() {
    this.muted = getAudioManager()?.toggleMute() ?? this.muted;
    this.syncMuteState();
  }

  /* ─── Autoplay ─────────────────────────────────────────────── */
  private toggleAutoplay() {
    if (this.autoplayActive) {
      this.autoplayActive = false;
      this.autoplayRemaining = 0;
      this.updateAutoLabel();
      return;
    }
    this.autoplayActive = true;
    this.autoplayRemaining = 50;
    this.updateAutoLabel();
    if (!this.spinning) this.onSpinPress();
  }

  private updateAutoLabel() {
    const text = (this.autoBtn.getChildAt(2) as Text);
    text.text = this.autoplayActive ? `${this.autoplayRemaining}` : 'AUTO';
  }

  private async playViaSdk(action: string, bet: number, params: Record<string, unknown> = {}): Promise<PlayResultData> {
    const sdk = getGameSdk();
    if (!sdk) {
      throw new Error('CasinoGameSDK is not available');
    }

    return sdk.play({
      action,
      bet,
      roundId: this.currentRoundId ?? undefined,
      params: {
        ...params,
        baseBet: bet,
      },
    });
  }

  private extractGamePlayData(result: PlayResultData): GamePlayData {
    const data = result.data as Partial<GamePlayData>;
    if (!data || (data.kind !== 'spin' && data.kind !== 'buy_bonus')) {
      throw new Error('SDK play result is missing supported game data');
    }
    return data as GamePlayData;
  }

  private getActiveSession(result?: PlayResultData): SessionData | null {
    return result?.session ?? getGameSdk()?.session ?? null;
  }

  private syncFreeSpinStateFromSession(session: SessionData | null) {
    if (!session) {
      return;
    }

    this.currentRoundId = session.roundId;
    this.freeSpinsRemaining = session.spinsRemaining;
    this.freeSpinsTotalWin = session.totalWin;
    this.updateFreeSpinsLabel();
  }

  private async finalizePlayResult(result: PlayResultData) {
    getGameSdk()?.playAck(result);
  }

  private getBuyBonusCost(superMode: boolean): number | null {
    const sdkConfig = getGameSdk()?.config as {
      buy_bonus?: {
        modes?: Record<string, { cost_multiplier?: number }>;
      };
    } | null;
    const modeKey = superMode ? 'super' : 'default';
    const costMultiplier = Number(sdkConfig?.buy_bonus?.modes?.[modeKey]?.cost_multiplier);

    if (!Number.isFinite(costMultiplier) || costMultiplier <= 0) {
      return null;
    }

    return this.currentBet * costMultiplier;
  }

  /* ─── Spin press ───────────────────────────────────────────── */
  private async onSpinPress() {
    if (this.spinning) return;
    if (this.balance < this.currentBet && !this.inFreeSpins) return;

    this.spinning = true;
    this.setButtonsEnabled(false);
    this.winValueLabel.text = '$0.00';

    const bet = this.currentBet;

    if (!this.inFreeSpins) {
      // Reset multipliers for base game
      this.multiplierGrid.reset();
      this.clearMultiplierDisplay();
    }

    const playResult = await this.playViaSdk(this.inFreeSpins ? 'free_spin' : 'spin', bet);
    const playData = this.extractGamePlayData(playResult);
    if (playData.kind !== 'spin') {
      throw new Error(`Unexpected play data kind: ${playData.kind}`);
    }
    const spinResult = deserializeSpinResult(playData.spinResult as SerializedSpinResult);
    const session = this.getActiveSession(playResult);
    const wasInFreeSpins = this.inFreeSpins;
    this.setBalance(playResult.balanceAfter);
    this.currentRoundId = playResult.roundId;

    // Animate the cascades
    await this.animateSpinResult(spinResult);

    // Scatter glow animation if 3+ scatters landed
    if (spinResult.scatterCount >= 3 && spinResult.cascadeSteps.length > 0) {
      await this.animateScatterWin(spinResult.cascadeSteps[0].grid, spinResult.scatterCount);
    }

    if (spinResult.totalWin > 0) {
      this.lastWin = spinResult.totalWin;
      await this.showWinAmount(spinResult.totalWin, bet);
    }

    // Check for free spins trigger
    if (!wasInFreeSpins && session && session.spinsRemaining > 0) {
      await this.startFreeSpins(session.spinsRemaining, false, session.totalWin);
    } else if (spinResult.freeSpinsAwarded > 0 && wasInFreeSpins) {
      // Retrigger
      this.playSound('scatter_sfx');
      await this.showAnnouncementText(`+${spinResult.freeSpinsAwarded} FREE SPINS!`, 0xff69b4);
    }

    // Free spins flow
    if (this.inFreeSpins) {
      this.syncFreeSpinStateFromSession(session);

      if (!session || session.completed || session.spinsRemaining <= 0) {
        await this.endFreeSpins();
      }
    } else {
      // Base game: reset multipliers
      this.multiplierGrid.reset();
      this.clearMultiplierDisplay();
    }

    this.flushPendingBalanceDisplay();
    this.spinning = false;
    this.setButtonsEnabled(true);

    await this.finalizePlayResult(playResult);

    // Continue autoplay or free spins
    if (this.inFreeSpins && this.freeSpinsRemaining > 0) {
      await Tween.delay(100);
      this.onSpinPress();
    } else if (this.autoplayActive && this.autoplayRemaining > 0 && !this.inFreeSpins) {
      this.autoplayRemaining--;
      this.updateAutoLabel();
      if (this.autoplayRemaining <= 0) {
        this.autoplayActive = false;
        this.updateAutoLabel();
      } else {
        await Tween.delay(100);
        this.onSpinPress();
      }
    }
  }

  /* ─── Animate spin result (all cascades) ───────────────────── */
  private async animateSpinResult(result: SpinResult) {
    for (let i = 0; i < result.cascadeSteps.length; i++) {
      const step = result.cascadeSteps[i];

      if (i === 0) {
        // First step: animate new grid appearing
        await this.animateNewGrid(step.grid);
      }

      if (step.clusters.length > 0) {
        // Highlight winning clusters
        await this.highlightClusters(step);

        // Explode winning symbols
        this.playSound('cluster_pop', 'sfx', 0.5);
        await this.animateExplosions(step.removedPositions);

        // Restore multiplier grid to this step's snapshot, then update display
        for (let j = 0; j < step.multiplierSnapshot.length; j++) {
          this.multiplierGrid.spots[j].hitCount = step.multiplierSnapshot[j].hitCount;
          this.multiplierGrid.spots[j].value = step.multiplierSnapshot[j].value;
        }
        this.updateMultiplierDisplay();

        // Cascade: symbols fall down
        if (i < result.cascadeSteps.length - 1) {
          const nextGrid = result.cascadeSteps[i + 1].grid;
          this.playSound('cascade_sfx', 'sfx', 0.4);
          await this.animateCascade(step.removedPositions, nextGrid);
        }
      }
    }
  }

  /* ─── Animate new grid (initial spin) ──────────────────────── */
  private async animateNewGrid(grid: CellData[]) {
    this.playSound('spin_sfx', 'sfx', 0.5);
    const slow = this.bonusBuyDrop;

    // Fade out current symbols
    const fadePromises: Promise<void>[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const i = row * GRID_COLS + col;
        const sprite = this.symbolSprites[i];
        fadePromises.push(
          Tween.delay(col * (slow ? 60 : 30)).then(() => Tween.to(sprite, { alpha: 0 }, slow ? 250 : 150, Easing.easeInCubic))
        );
      }
    }
    await Promise.all(fadePromises);

    // Swap textures
    this.grid = grid;
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const sprite = this.symbolSprites[i];
      const tex = Assets.get(this.grid[i].id);
      sprite.texture = tex;
      const scale = (this.cellSize * 0.85) / Math.max(tex.width, tex.height);
      sprite.scale.set(scale);
    }

    // Bounce in from top
    const bouncePromises: Promise<void>[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const i = row * GRID_COLS + col;
        const sprite = this.symbolSprites[i];
        const targetY = this.gridY + row * (this.cellSize + this.cellGap) + this.cellSize / 2;
        sprite.y = targetY - (slow ? 160 : 80);
        sprite.alpha = 0;

        bouncePromises.push(
          Tween.delay(col * (slow ? 100 : 40) + row * (slow ? 60 : 20)).then(async () => {
            sprite.alpha = 1;
            await Tween.to(sprite, { y: targetY }, slow ? 600 : 350, Easing.easeOutBack);
          })
        );
      }
    }
    await Promise.all(bouncePromises);
  }

  /* ─── Highlight winning clusters ───────────────────────────── */
  private async highlightClusters(step: CascadeStep) {
    const highlights: Graphics[] = [];

    for (const detail of step.clusterDetails) {
      const symbol = SYMBOLS.find(s => s.id === detail.cluster.symbolId);
      const color = symbol?.color ?? 0xffffff;

      for (const pos of detail.cluster.positions) {
        const col = pos % GRID_COLS;
        const row = Math.floor(pos / GRID_COLS);
        const x = this.gridX + col * (this.cellSize + this.cellGap);
        const y = this.gridY + row * (this.cellSize + this.cellGap);

        const glow = new Graphics();
        glow.roundRect(x - 2, y - 2, this.cellSize + 4, this.cellSize + 4, 6);
        glow.fill({ color, alpha: 0.25 });
        glow.stroke({ color, width: 3, alpha: 0.8 });
        glow.alpha = 0;
        this.winOverlay.addChild(glow);
        highlights.push(glow);
      }
    }

    // Animate highlights in
    await Promise.all(highlights.map(g => Tween.to(g, { alpha: 1 }, 200)));

    // Pulse winning symbols
    const pulsePromises: Promise<void>[] = [];
    for (const pos of step.removedPositions) {
      const sprite = this.symbolSprites[pos];
      const origSx = sprite.scale.x;
      const origSy = sprite.scale.y;
      pulsePromises.push(
        Tween.to(sprite, { 'scale.x': origSx * 1.2, 'scale.y': origSy * 1.2 }, 200, Easing.easeOutBack)
          .then(() => Tween.to(sprite, { 'scale.x': origSx, 'scale.y': origSy }, 150))
      );
    }
    await Promise.all(pulsePromises);

    await Tween.delay(300);

    // Remove highlights
    for (const g of highlights) {
      g.destroy();
    }
    this.winOverlay.removeChildren();
  }

  /* ─── Animate symbol explosions ────────────────────────────── */
  private async animateExplosions(positions: Set<number>) {
    const promises: Promise<void>[] = [];

    for (const pos of positions) {
      const sprite = this.symbolSprites[pos];
      // Create particle burst effect
      this.createBurstParticles(sprite.x, sprite.y, SYMBOLS.find(s => s.id === this.grid[pos]?.id)?.color ?? 0xffffff);

      promises.push(
        Tween.to(sprite, { alpha: 0, 'scale.x': 0.3, 'scale.y': 0.3 }, 250, Easing.easeInCubic)
      );
    }

    await Promise.all(promises);
  }

  /* ─── Particle burst effect ────────────────────────────────── */
  private createBurstParticles(x: number, y: number, color: number) {
    const particleCount = 8;
    for (let i = 0; i < particleCount; i++) {
      const particle = new Graphics();
      const size = 3 + Math.random() * 5;
      particle.circle(0, 0, size);
      particle.fill({ color, alpha: 0.9 });
      particle.position.set(x, y);
      this.winOverlay.addChild(particle);

      const angle = (Math.PI * 2 / particleCount) * i + Math.random() * 0.5;
      const distance = 30 + Math.random() * 40;
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance;

      Tween.to(particle, { x: targetX, y: targetY, alpha: 0 }, 400 + Math.random() * 200)
        .then(() => {
          particle.destroy();
        });
    }
  }

  /* ─── Animate cascade (gravity + fill) ─────────────────────── */
  private async animateCascade(removedPositions: Set<number>, newGrid: CellData[]) {
    // Save old grid to figure out which symbols survived vs new fills
    const oldGrid = this.grid;
    this.grid = newGrid;

    // For each column, compute per-sprite animation origins
    for (let col = 0; col < GRID_COLS; col++) {
      // Collect which rows were removed in this column
      const removedRows: number[] = [];
      for (let row = 0; row < GRID_ROWS; row++) {
        if (removedPositions.has(row * GRID_COLS + col)) {
          removedRows.push(row);
        }
      }
      if (removedRows.length === 0) continue;

      // Build a map: for each row in the NEW grid, figure out where
      // that symbol came from (old row) or if it's a new fill.
      // The engine collects surviving cells bottom-to-top, then fills the rest from top.
      const survivingOldRows: number[] = [];
      for (let row = GRID_ROWS - 1; row >= 0; row--) {
        const idx = row * GRID_COLS + col;
        if (!removedPositions.has(idx)) {
          survivingOldRows.push(row); // bottom-to-top order
        }
      }
      // survivingOldRows[0] = bottommost survivor, etc.
      // New grid: bottom rows get survivors, top rows get new fills.
      const numSurvivors = survivingOldRows.length;
      const numNewFills = GRID_ROWS - numSurvivors;

      for (let row = 0; row < GRID_ROWS; row++) {
        const idx = row * GRID_COLS + col;
        const sprite = this.symbolSprites[idx];
        const cell = newGrid[idx];
        const tex = Assets.get(cell.id);
        sprite.texture = tex;
        const scale = (this.cellSize * 0.85) / Math.max(tex.width, tex.height);
        sprite.scale.set(scale);
        sprite.alpha = 1;

        const targetY = this.gridY + row * (this.cellSize + this.cellGap) + this.cellSize / 2;
        const cellStep = this.cellSize + this.cellGap;

        if (row < numNewFills) {
          // New fill from above the grid — start off-screen
          sprite.y = this.gridY - (numNewFills - row) * cellStep + this.cellSize / 2;
        } else {
          // Surviving symbol — start from its OLD row position
          const survivorIndex = GRID_ROWS - 1 - row; // reverse index
          const oldRow = survivingOldRows[survivorIndex];
          sprite.y = this.gridY + oldRow * cellStep + this.cellSize / 2;
        }
      }
    }

    // Animate all symbols falling to their target positions
    const fallPromises: Promise<void>[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const idx = row * GRID_COLS + col;
        const sprite = this.symbolSprites[idx];
        const targetY = this.gridY + row * (this.cellSize + this.cellGap) + this.cellSize / 2;

        if (Math.abs(sprite.y - targetY) > 1) {
          fallPromises.push(
            Tween.delay(col * 15).then(() =>
              Tween.to(sprite, { y: targetY }, 300, Easing.easeOutBack)
            )
          );
        }
      }
    }
    await Promise.all(fallPromises);
  }

  /* ─── Multiplier display ───────────────────────────────────── */
  private updateMultiplierDisplay() {
    for (let i = 0; i < TOTAL_CELLS; i++) {
      const visual = this.multiplierGrid.getSpotVisual(i);
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = this.gridX + col * (this.cellSize + this.cellGap);
      const y = this.gridY + row * (this.cellSize + this.cellGap);

      // Remove old
      if (this.multiplierBgs[i]) {
        this.multiplierBgs[i]!.destroy();
        this.multiplierBgs[i] = null;
      }
      if (this.multiplierTexts[i]) {
        this.multiplierTexts[i]!.destroy();
        this.multiplierTexts[i] = null;
      }

      if (!visual.hasTrail) continue;

      // Draw background highlight
      const bg = new Graphics();
      bg.roundRect(x, y, this.cellSize, this.cellSize, 4);
      bg.fill({ color: visual.color, alpha: visual.glow ? 0.35 : 0.2 });
      if (visual.glow) {
        bg.stroke({ color: visual.color, width: 2, alpha: 0.8 });
      }
      this.multiplierOverlay.addChild(bg);
      this.multiplierBgs[i] = bg;

      // Draw multiplier text
      if (visual.value > 0) {
        const multText = new Text({
          text: `x${visual.value}`,
          style: this.candyStyle(Math.max(10, this.cellSize * 0.25), visual.color),
        });
        multText.anchor.set(0.5);
        multText.position.set(x + this.cellSize / 2, y + this.cellSize - 8);
        this.multiplierOverlay.addChild(multText);
        this.multiplierTexts[i] = multText;
      }
    }
  }

  private clearMultiplierDisplay() {
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (this.multiplierBgs[i]) {
        this.multiplierBgs[i]!.destroy();
        this.multiplierBgs[i] = null;
      }
      if (this.multiplierTexts[i]) {
        this.multiplierTexts[i]!.destroy();
        this.multiplierTexts[i] = null;
      }
    }
    this.multiplierOverlay.removeChildren();
  }

  /* ─── Win display ──────────────────────────────────────────── */
  private async showWinAmount(amount: number, bet: number) {
    const mult = amount / bet;
    this.winValueLabel.text = this.formatCurrency(amount);
    await Tween.to(this.winValueLabel, { alpha: 1 }, 300);

    if (mult >= 10) {
      this.playSound('bigwin_sfx', 'sfx', 0.8);
      await this.showBigWinOverlay(amount, mult);
    } else {
      this.playSound('win_sfx', 'sfx', 0.6);
    }

    await Tween.delay(600);
  }

  /* ─── Big win overlay ──────────────────────────────────────── */
  private async showBigWinOverlay(amount: number, mult: number) {
    const w = this._w;
    const h = this._h;

    // Dimmer
    const dimmer = new Graphics();
    dimmer.rect(0, 0, w, h);
    dimmer.fill({ color: 0x000000, alpha: 0.6 });
    dimmer.alpha = 0;
    this.winOverlay.addChild(dimmer);

    // Determine tier
    let tierAlias = 'nice_win';
    if (mult >= 100) tierAlias = 'epic_win';
    else if (mult >= 50) tierAlias = 'super_win';
    else if (mult >= 20) tierAlias = 'mega_win';
    else if (mult >= 10) tierAlias = 'big_win';

    const tierSprite = new Sprite(Assets.get(tierAlias));
    tierSprite.anchor.set(0.5);
    tierSprite.position.set(w / 2, h * 0.35);
    const tierScale = Math.min(w * 0.6 / tierSprite.texture.width, h * 0.25 / tierSprite.texture.height);
    tierSprite.scale.set(0);
    this.winOverlay.addChild(tierSprite);

    // Amount text
    const amountText = new Text({
      text: this.formatCurrency(amount),
      style: this.candyStyle(48, 0xffd700),
    });
    amountText.anchor.set(0.5);
    amountText.position.set(w / 2, h * 0.55);
    amountText.alpha = 0;
    this.winOverlay.addChild(amountText);

    // Animate in
    await Tween.to(dimmer, { alpha: 1 }, 300);
    await Tween.to(tierSprite, { 'scale.x': tierScale, 'scale.y': tierScale }, 600, Easing.easeOutBack);
    await Tween.to(amountText, { alpha: 1 }, 400);

    // Coin particles
    this.spawnCoinParticles(w, h);

    await Tween.delay(2500);

    // Fade out
    await Promise.all([
      Tween.to(dimmer, { alpha: 0 }, 500),
      Tween.to(tierSprite, { alpha: 0 }, 500),
      Tween.to(amountText, { alpha: 0 }, 500),
    ]);

    dimmer.destroy();
    tierSprite.destroy();
    amountText.destroy();
  }

  private spawnCoinParticles(w: number, h: number) {
    for (let i = 0; i < 20; i++) {
      const coin = new Graphics();
      coin.circle(0, 0, 6 + Math.random() * 6);
      coin.fill({ color: 0xffd700, alpha: 0.9 });
      coin.position.set(Math.random() * w, -20);
      this.winOverlay.addChild(coin);

      const targetY = h + 20;
      const duration = 1000 + Math.random() * 1500;
      Tween.delay(Math.random() * 500).then(() =>
        Tween.to(coin, { y: targetY, x: coin.x + (Math.random() - 0.5) * 200 }, duration)
          .then(() => coin.destroy())
      );
    }
  }

  /* ─── Announcement text ────────────────────────────────────── */
  private async showAnnouncementText(message: string, color: number) {
    const w = this._w;
    const h = this._h;

    const text = new Text({
      text: message,
      style: this.candyStyle(42, color),
    });
    text.anchor.set(0.5);
    text.position.set(w / 2, h / 2);
    text.alpha = 0;
    text.scale.set(0.5);
    this.winOverlay.addChild(text);

    await Tween.to(text, { alpha: 1, 'scale.x': 1, 'scale.y': 1 }, 500, Easing.easeOutBack);
    await Tween.delay(1500);
    await Tween.to(text, { alpha: 0 }, 400);
    text.destroy();
  }

  /* ─── Scatter glow animation on 3+ scatters ────────────────── */
  private async animateScatterWin(grid: CellData[], scatterCount: number) {
    const scatterCells = grid.filter(c => c.id === 'scatter');
    if (scatterCells.length < 3) return;

    const glowSprites: Sprite[] = [];
    const glowTex = Assets.get('scatter_glow');

    for (const cell of scatterCells) {
      const x = this.gridX + cell.col * (this.cellSize + this.cellGap) + this.cellSize / 2;
      const y = this.gridY + cell.row * (this.cellSize + this.cellGap) + this.cellSize / 2;

      const glow = new Sprite(glowTex);
      glow.anchor.set(0.5);
      glow.position.set(x, y);
      glow.alpha = 0;
      const glowScale = (this.cellSize * 1.4) / Math.max(glowTex.width, glowTex.height);
      glow.scale.set(glowScale * 0.3);
      this.winOverlay.addChild(glow);
      glowSprites.push(glow);
    }

    // Animate all glows in parallel — burst + pulse
    await Promise.all(glowSprites.map((g, i) =>
      Tween.delay(i * 100).then(async () => {
        await Tween.to(g, { alpha: 1, 'scale.x': g.scale.x * 3.5, 'scale.y': g.scale.y * 3.5 }, 350, Easing.easeOutBack);
        await Tween.to(g, { 'scale.x': g.scale.x * 2.8, 'scale.y': g.scale.y * 2.8 }, 250, Easing.easeInCubic);
      })
    ));

    await Tween.delay(800);

    // Fade out
    await Promise.all(glowSprites.map(g =>
      Tween.to(g, { alpha: 0 }, 300)
    ));

    for (const g of glowSprites) g.destroy();
  }

  /* ─── Free spins ───────────────────────────────────────────── */
  private async startFreeSpins(count: number, superMode: boolean, totalWin = 0) {
    this.inFreeSpins = true;
    this.freeSpinsSuperMode = superMode;
    this.freeSpinsRemaining = count;
    this.freeSpinsTotalWin = totalWin;
    // Natural FS from base game uses default retrigger rate
    if (this.fsScatterBoost <= 1) this.fsScatterBoost = 1;

    // Switch to free spins mode
    this.multiplierGrid.reset();
    this.clearMultiplierDisplay();
    if (superMode) {
      this.multiplierGrid.initializeSuperMode();
      this.updateMultiplierDisplay();
    }

    // Visual transition
    this.playSound('scatter_sfx', 'sfx', 0.8);
    await this.animateFreeSpinsTransition(true);
    await this.showAnnouncementText(`${count} FREE SPINS!`, 0xff69b4);

    this.updateFreeSpinsLabel();

    // Switch BGM
    this.playMusic('bgm_freespins');

    // Hide buy buttons
    this.buyBtnStandard.alpha = 0;
    this.buyBtnSuper.alpha = 0;
    this.buyBtnStandard.eventMode = 'none';
    this.buyBtnSuper.eventMode = 'none';
  }

  private async endFreeSpins() {
    const totalWin = this.freeSpinsTotalWin;

    // Show win summary popup
    await this.showWinSummary(totalWin);

    // Transition back
    await this.animateFreeSpinsTransition(false);

    this.inFreeSpins = false;
    this.currentRoundId = null;
    this.freeSpinsRemaining = 0;
    this.freeSpinsLabel.alpha = 0;
    this.fsScatterBoost = 1;
    this.freeSpinsSuperMode = false;

    // Reset multipliers
    this.multiplierGrid.reset();
    this.clearMultiplierDisplay();

    // Restore BGM
    this.playMusic('bgm');

    // Show buy buttons
    this.buyBtnStandard.alpha = 1;
    this.buyBtnSuper.alpha = 1;
    this.buyBtnStandard.eventMode = 'static';
    this.buyBtnSuper.eventMode = 'static';
  }

  /* ─── Win summary popup after free spins ────────────────────── */
  private async showWinSummary(totalWin: number): Promise<void> {
    const w = this._w;
    const h = this._h;

    const overlay = new Container();
    this.winOverlay.addChild(overlay);

    // Dimmer
    const dimmer = new Graphics();
    dimmer.rect(0, 0, w, h);
    dimmer.fill({ color: 0x000000, alpha: 0.75 });
    dimmer.eventMode = 'static';
    overlay.addChild(dimmer);

    // Panel sprite
    const panelW = Math.min(500, w * 0.7);
    const panelH = Math.min(300, h * 0.45);
    const cx = w / 2;
    const cy = h / 2;

    const panelSprite = new Sprite(Assets.get('win_summary_panel'));
    panelSprite.anchor.set(0.5);
    panelSprite.position.set(cx, cy);
    panelSprite.scale.set(
      panelW / panelSprite.texture.width,
      panelH / panelSprite.texture.height,
    );
    panelSprite.alpha = 0;
    overlay.addChild(panelSprite);

    // "TOTAL WIN" title
    const title = new Text({
      text: 'TOTAL WIN',
      style: this.candyStyle(28, 0xffe0b2),
    });
    title.anchor.set(0.5);
    title.position.set(cx, cy - panelH * 0.18);
    title.alpha = 0;
    overlay.addChild(title);

    // Win amount — big golden number
    const winText = new Text({
      text: this.formatCurrency(totalWin),
      style: this.candyStyle(52, 0xffd700),
    });
    winText.anchor.set(0.5);
    winText.position.set(cx, cy + panelH * 0.05);
    winText.alpha = 0;
    winText.scale.set(0.5);
    overlay.addChild(winText);

    // Win multiplier
    const multText = new Text({
      text: `x${this.asNumber(totalWin / this.currentBet).toFixed(1)}`,
      style: this.candyStyle(22, 0xff69b4),
    });
    multText.anchor.set(0.5);
    multText.position.set(cx, cy + panelH * 0.25);
    multText.alpha = 0;
    overlay.addChild(multText);

    // Animate in
    await Promise.all([
      Tween.to(panelSprite, { alpha: 1 }, 400),
      Tween.to(title, { alpha: 1 }, 400),
    ]);
    await Tween.to(winText, { alpha: 1, 'scale.x': 1, 'scale.y': 1 }, 500, Easing.easeOutBack);
    await Tween.to(multText, { alpha: 1 }, 300);

    // Wait for tap or timeout
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => resolve(), 4000);
      dimmer.on('pointerdown', () => { clearTimeout(timer); resolve(); });
    });

    // Fade out
    await Tween.to(overlay, { alpha: 0 }, 400);
    overlay.destroy({ children: true });
  }

  private updateFreeSpinsLabel() {
    this.freeSpinsLabel.text = `FREE SPINS: ${this.asNumber(this.freeSpinsRemaining, 0)}  WIN: ${this.formatCurrency(this.freeSpinsTotalWin)}`;
    this.freeSpinsLabel.alpha = 1;
  }

  private async animateFreeSpinsTransition(toFreeSpins: boolean) {
    if (toFreeSpins) {
      await Tween.to(this.bgFreeSprite, { alpha: 1 }, 800);
    } else {
      await Tween.to(this.bgFreeSprite, { alpha: 0 }, 800);
    }
  }

  /* ─── Bonus buy ────────────────────────────────────────────── */
  private async buyBonus(superMode: boolean) {
    if (this.spinning || this.inFreeSpins) return;

    const confirmed = await this.showBuyConfirmation(superMode);
    if (!confirmed) return;

    this.spinning = true;
    this.setButtonsEnabled(false);

    try {
      const playResult = await this.playViaSdk(superMode ? 'buy_bonus_super' : 'buy_bonus', this.currentBet);
      const playData = this.extractGamePlayData(playResult);
      if (playData.kind !== 'buy_bonus') {
        throw new Error(`Unexpected buy bonus payload: ${playData.kind}`);
      }
      const bonusData = playData.bonus as BuyBonusData;
      const bonusGrid = bonusData.bonusGrid;
      const session = this.getActiveSession(playResult);
      this.setBalance(playResult.balanceAfter);
      this.currentRoundId = playResult.roundId;
      this.grid = bonusGrid;

      // Show the grid landing (player sees symbols + scatters dropping in)
      this.bonusBuyDrop = true;
      await this.animateNewGrid(bonusGrid);
      this.bonusBuyDrop = false;

      // Count how many scatters actually landed
      const scatterCount = countScatters(bonusGrid);

      // Animate scatter glows so player can see them
      await this.animateScatterWin(bonusGrid, scatterCount);

      const freeSpins = bonusData.freeSpinsAwarded;
      this.fsScatterBoost = bonusData.scatterBoost;

      // Now start free spins
      await this.startFreeSpins(session?.spinsRemaining ?? freeSpins, superMode, session?.totalWin ?? 0);
      this.syncFreeSpinStateFromSession(session);
      this.flushPendingBalanceDisplay();

      // Begin first free spin
      this.spinning = false;
      await this.finalizePlayResult(playResult);
      this.onSpinPress();
    } catch (error) {
      this.spinning = false;
      this.setButtonsEnabled(true);
      await this.showAnnouncementText(this.getBuyBonusErrorMessage(error), 0xff8080);
    }
  }

  /* ─── Buy confirmation popup ───────────────────────────────── */
  private showBuyConfirmation(superMode: boolean): Promise<boolean> {
    return new Promise(resolve => {
      const w = this._w;
      const h = this._h;
      const cost = this.getBuyBonusCost(superMode);

      const overlay = new Container();
      this.container.addChild(overlay);

      // Dimmer
      const dimmer = new Graphics();
      dimmer.rect(0, 0, w, h);
      dimmer.fill({ color: 0x000000, alpha: 0.7 });
      dimmer.eventMode = 'static';
      overlay.addChild(dimmer);

      // Modal panel
      const panelW = Math.min(420, w * 0.85);
      const panelH = Math.min(320, h * 0.45);
      const cx = w / 2;
      const cy = h / 2;

      const panel = new Graphics();
      // Dark candy background
      panel.roundRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 24);
      panel.fill({ color: 0x2a1040, alpha: 0.95 });
      // Border glow
      panel.roundRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 24);
      panel.stroke({ color: superMode ? 0xffd700 : 0xff69b4, width: 3, alpha: 0.9 });
      overlay.addChild(panel);

      // Inner highlight
      const innerGlow = new Graphics();
      innerGlow.roundRect(cx - panelW / 2 + 4, cy - panelH / 2 + 4, panelW - 8, panelH - 8, 20);
      innerGlow.stroke({ color: 0xffffff, width: 1, alpha: 0.15 });
      overlay.addChild(innerGlow);

      // Title
      const titleText = superMode ? 'SUPER FREE SPINS' : 'FREE SPINS';
      const title = new Text({
        text: titleText,
        style: this.candyStyle(26, superMode ? 0xffd700 : 0xff69b4),
      });
      title.anchor.set(0.5);
      title.position.set(cx, cy - panelH * 0.3);
      overlay.addChild(title);

      // Description
      const desc = new Text({
        text: 'Buy bonus for',
        style: this.candyStyle(16, 0xdddddd),
      });
      desc.anchor.set(0.5);
      desc.position.set(cx, cy - panelH * 0.1);
      overlay.addChild(desc);

      const pricingText = new Text({
        text: cost === null ? 'PRICE UNAVAILABLE' : this.formatCurrency(cost),
        style: this.candyStyle(28, superMode ? 0xffd700 : 0x44ff88),
      });
      pricingText.anchor.set(0.5);
      pricingText.position.set(cx, cy + panelH * 0.03);
      overlay.addChild(pricingText);

      // Multiplier info
      const multInfo = superMode
        ? 'Super mode · multipliers start at x2'
        : 'Standard mode';
      const info = new Text({
        text: multInfo,
        style: this.candyStyle(11, 0xaaaaaa),
      });
      info.anchor.set(0.5);
      info.position.set(cx, cy + panelH * 0.18);
      overlay.addChild(info);

      const cleanup = () => {
        this.container.removeChild(overlay);
        overlay.destroy({ children: true });
      };

      // ── Confirm button ──
      const btnW = panelW * 0.36;
      const btnH = 48;
      const btnY = cy + panelH * 0.35;

      const confirmBtn = new Container();
      confirmBtn.eventMode = 'static';
      confirmBtn.cursor = 'pointer';

      const confirmBg = new Graphics();
      confirmBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, 14);
      confirmBg.fill({ color: superMode ? 0xdaa520 : 0x22aa55 });
      confirmBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, 14);
      confirmBg.stroke({ color: 0xffffff, width: 2, alpha: 0.3 });
      confirmBtn.addChild(confirmBg);

      // Glossy top half
      const confirmGloss = new Graphics();
      confirmGloss.roundRect(-btnW / 2 + 2, -btnH / 2 + 2, btnW - 4, btnH / 2 - 2, 12);
      confirmGloss.fill({ color: 0xffffff, alpha: 0.15 });
      confirmBtn.addChild(confirmGloss);

      const confirmLabel = new Text({
        text: 'BUY',
        style: this.candyStyle(20, 0xffffff),
      });
      confirmLabel.anchor.set(0.5);
      confirmBtn.addChild(confirmLabel);

      confirmBtn.position.set(cx + panelW * 0.28, btnY);
      confirmBtn.on('pointerdown', () => {
        this.playSound('spin_sfx', 'ui', 0.2);
        cleanup();
        resolve(true);
      });
      overlay.addChild(confirmBtn);

      // ── Cancel button ──
      const cancelBtn = new Container();
      cancelBtn.eventMode = 'static';
      cancelBtn.cursor = 'pointer';

      const cancelBg = new Graphics();
      cancelBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, 14);
      cancelBg.fill({ color: 0x882233 });
      cancelBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, 14);
      cancelBg.stroke({ color: 0xffffff, width: 2, alpha: 0.3 });
      cancelBtn.addChild(cancelBg);

      const cancelGloss = new Graphics();
      cancelGloss.roundRect(-btnW / 2 + 2, -btnH / 2 + 2, btnW - 4, btnH / 2 - 2, 12);
      cancelGloss.fill({ color: 0xffffff, alpha: 0.15 });
      cancelBtn.addChild(cancelGloss);

      const cancelLabel = new Text({
        text: 'CANCEL',
        style: this.candyStyle(18, 0xffcccc),
      });
      cancelLabel.anchor.set(0.5);
      cancelBtn.addChild(cancelLabel);

      cancelBtn.position.set(cx - panelW * 0.28, btnY);
      cancelBtn.on('pointerdown', () => {
        cleanup();
        resolve(false);
      });
      overlay.addChild(cancelBtn);

      // Entrance animation
      overlay.alpha = 0;
      Tween.to(overlay, { alpha: 1 }, 200);
    });
  }

  private getBuyBonusErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('balance') || message.includes('fund')) {
        return 'INSUFFICIENT BALANCE';
      }
    }

    return 'BONUS BUY FAILED';
  }

  /* ─── Paytable popup ───────────────────────────────────────── */
  private showPaytable() {
    const w = this._w;
    const h = this._h;

    const overlay = new Container();
    this.container.addChild(overlay);

    // Dimmer
    const dimmer = new Graphics();
    dimmer.rect(0, 0, w, h);
    dimmer.fill({ color: 0x000000, alpha: 0.8 });
    dimmer.eventMode = 'static';
    overlay.addChild(dimmer);

    // Panel
    const panelW = Math.min(700, w * 0.92);
    const panelH = Math.min(720, h * 0.92);
    const cx = w / 2;
    const cy = h / 2;

    const panel = new Graphics();
    panel.roundRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 20);
    panel.fill({ color: 0x1e0a30, alpha: 0.95 });
    panel.roundRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 20);
    panel.stroke({ color: 0xffd700, width: 3, alpha: 0.7 });
    overlay.addChild(panel);

    // Title
    const title = new Text({
      text: 'PAYTABLE',
      style: this.candyStyle(36, 0xffd700),
    });
    title.anchor.set(0.5);
    title.position.set(cx, cy - panelH / 2 + 35);
    overlay.addChild(title);

    // Symbol rows
    const paySymbols = SYMBOLS.filter(s => s.tier !== 'scatter');
    const rowH = Math.min(60, (panelH - 120) / paySymbols.length);
    const startY = cy - panelH / 2 + 75;
    const clusterSizes = [5, 8, 10, 15];

    // Column headers
    const headerY = startY;
    const colLabelStyle = this.candyStyle(16, 0xaaaaaa);
    const symbolColX = cx - panelW * 0.35;
    for (let j = 0; j < clusterSizes.length; j++) {
      const colX = cx - panelW * 0.08 + j * (panelW * 0.17);
      const hdr = new Text({
        text: `${clusterSizes[j]}+`,
        style: colLabelStyle,
      });
      hdr.anchor.set(0.5);
      hdr.position.set(colX, headerY);
      overlay.addChild(hdr);
    }

    // Symbol rows with sprites and payouts
    for (let i = 0; i < paySymbols.length; i++) {
      const sym = paySymbols[i];
      const rowY = startY + (i + 1) * rowH;

      // Row bg stripe (alternating)
      if (i % 2 === 0) {
        const stripe = new Graphics();
        stripe.rect(cx - panelW / 2 + 10, rowY - rowH / 2 + 2, panelW - 20, rowH - 4);
        stripe.fill({ color: 0xffffff, alpha: 0.04 });
        overlay.addChild(stripe);
      }

      // Symbol sprite
      const tex = Assets.get(sym.id);
      if (tex) {
        const spr = new Sprite(tex);
        spr.anchor.set(0.5);
        const sprScale = Math.min((rowH - 8) / tex.height, (rowH - 8) / tex.width);
        spr.scale.set(sprScale);
        spr.position.set(symbolColX - 20, rowY);
        overlay.addChild(spr);
      }

      // Symbol name
      const nameText = new Text({
        text: sym.name,
        style: this.candyStyle(17, sym.color),
      });
      nameText.anchor.set(0, 0.5);
      nameText.position.set(symbolColX + 10, rowY);
      overlay.addChild(nameText);

      // Payout values
      const payTable = CLUSTER_PAYOUTS[sym.id];
      if (payTable) {
        for (let j = 0; j < clusterSizes.length; j++) {
          const sz = clusterSizes[j];
          const payout = payTable[sz] ?? 0;
          const colX = cx - panelW * 0.08 + j * (panelW * 0.17);
          const payText = new Text({
            text: `x${payout}`,
            style: this.candyStyle(18, 0xffffff),
          });
          payText.anchor.set(0.5);
          payText.position.set(colX, rowY);
          overlay.addChild(payText);
        }
      }
    }

    // Separator
    const sepY = startY + (paySymbols.length + 1) * rowH + 5;
    const sep = new Graphics();
    sep.rect(cx - panelW * 0.4, sepY, panelW * 0.8, 2);
    sep.fill({ color: 0xffd700, alpha: 0.3 });
    overlay.addChild(sep);

    // Scatter info
    const scatterY = sepY + 30;
    const scatterTex = Assets.get('scatter');
    if (scatterTex) {
      const scatSpr = new Sprite(scatterTex);
      scatSpr.anchor.set(0.5);
      const scatScale = Math.min(40 / scatterTex.height, 40 / scatterTex.width);
      scatSpr.scale.set(scatScale);
      scatSpr.position.set(cx - panelW * 0.3, scatterY);
      overlay.addChild(scatSpr);
    }
    const scatInfo = new Text({
      text: 'SCATTER  —  3+ triggers FREE SPINS (10-30)',
      style: this.candyStyle(17, 0xffd700),
    });
    scatInfo.anchor.set(0, 0.5);
    scatInfo.position.set(cx - panelW * 0.2, scatterY);
    overlay.addChild(scatInfo);

    // Multiplier info
    const multInfoY = scatterY + 30;
    const multInfo = new Text({
      text: 'Multiplier spots: x2 → x4 → x8 → ... → x1024\nAll multipliers multiply cluster wins!',
      style: this.candyStyle(15, 0xddaaff, { align: 'center' }),
    });
    multInfo.anchor.set(0.5, 0);
    multInfo.position.set(cx, multInfoY);
    overlay.addChild(multInfo);

    // Close button
    const closeBtn = new Container();
    closeBtn.eventMode = 'static';
    closeBtn.cursor = 'pointer';
    const closeBg = new Graphics();
    closeBg.circle(0, 0, 20);
    closeBg.fill({ color: 0xaa2244 });
    closeBg.circle(0, 0, 20);
    closeBg.stroke({ color: 0xffffff, width: 2, alpha: 0.4 });
    closeBtn.addChild(closeBg);
    const closeX = new Text({ text: '✕', style: this.candyStyle(18, 0xffffff) });
    closeX.anchor.set(0.5);
    closeBtn.addChild(closeX);
    closeBtn.position.set(cx + panelW / 2 - 30, cy - panelH / 2 + 30);
    closeBtn.on('pointerdown', () => {
      this.container.removeChild(overlay);
      overlay.destroy({ children: true });
    });
    overlay.addChild(closeBtn);

    // Also close on dimmer tap
    dimmer.on('pointerdown', () => {
      this.container.removeChild(overlay);
      overlay.destroy({ children: true });
    });

    // Entrance animation
    overlay.alpha = 0;
    Tween.to(overlay, { alpha: 1 }, 200);
  }

  /* ─── UI helpers ───────────────────────────────────────────── */
  private updateBalanceDisplay() {
    this.balanceValueLabel.text = this.formatCurrency(this.balance);
  }

  /** Applies expanded invisible hit area (factor > 1 gives bigger click zone) */
  private addExpandedHitArea(btn: Container, factor: number) {
    const hit = new Graphics();
    const r = 50 * factor; // base radius for circle-shaped buttons
    hit.rect(-r, -r, r * 2, r * 2);
    hit.fill({ color: 0xffffff, alpha: 0.001 });
    btn.addChildAt(hit, 0); // behind visuals
  }

  private setButtonsEnabled(enabled: boolean) {
    const mode = enabled ? 'static' : 'none';
    const tint = enabled ? 0xffffff : 0x888888;

    this.spinBtn.eventMode = mode;
    this.spinBtn.alpha = enabled ? 1 : 0.55;
    this.spinBtnSprite.tint = tint;

    this.betMinusBtn.eventMode = mode;
    this.betPlusBtn.eventMode = mode;
    this.betMinusBtn.alpha = enabled ? 1 : 0.4;
    this.betPlusBtn.alpha = enabled ? 1 : 0.4;

    this.buyBtnStandard.eventMode = mode;
    this.buyBtnSuper.eventMode = mode;
    this.buyBtnStandard.alpha = enabled ? 1 : 0.5;
    this.buyBtnSuper.alpha = enabled ? 1 : 0.5;
    (this.buyBtnStandard.getChildAt(1) as Sprite).tint = tint;
    (this.buyBtnSuper.getChildAt(1) as Sprite).tint = tint;
  }
}
