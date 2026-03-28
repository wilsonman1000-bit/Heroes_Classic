import { hero } from '../index.web.js';
import { showAccueil } from '../accueil.web.js';
import { applyPlayerSkillTurn } from '../battleTurn.web.js';
import type { Skill } from '../skill.js';
import { getSkillIconSrc, renderSkillButtons } from '../skillUi.web.js';
import { getPartyMembers } from '../party.web.js';
import { createEnemy } from '../enemies.js';
import { ensureTacticalStyles } from './styles.web.js';
import {
    getSkillRange,
    getSkillStableKey,
    isAllyHealSkill,
    isSelfTargetingSkill,
    isWithinSkillRangeDirectional,
} from './targeting.js';
import {
    advanceTurn,
    createQuickSkirmishFromParty,
    getTeamAliveCount,
    getUnitById,
    getUnitAt,
    listReachableTiles,
    posKey,
    startUnitTurn,
    type Pos,
    type UnitId,
} from '../tacticalBoard.js';
import { renderBarsRow, renderUnitHtml } from './render.web.js';
import { bindMovePreview } from './movePreview.web.js';
import { playTacticalSkillAudio } from './sounds.web.js';
import { createTacticalAnimator } from './animations.web.js';
import { showTemporaryMessage } from '../uiNotifications.js';
import { createEnemyAutoRunner } from './enemyAuto.web.js';
import { bindTacticalGridInput } from './input.web.js';
import { escapeHtml } from '../utils.web.js';
import { renderItemIconHtml } from '../itemIcons.web.js';
import { getIdleSpriteSrc } from '../characterSprites.web.js';
import { mountPixiCanvas, unmountBattleCanvas } from '../pixi/pixiBootstrap.web.js';
import { renderTacticalOverlayFromDom } from '../pixi/tacticalOverlay.web.js';
import { advanceGameTimeHours } from '../daySystem.web.js';

import type { EnemyId } from '../enemies.js';

export type TacticalSkirmishOptions = {
    // “Fuir” pendant le combat
    onFlee?: () => void;
    // Bouton retour générique (fallback)
    onBack?: () => void;
    // “Retour forêt” à la fin du combat
    onReturnAfterCombat?: () => void;

    // Optional: notify the caller when the combat ends.
    // Useful for world-map encounters that must disappear after a win.
    onCombatEnd?: (outcome: 'won' | 'fled' | 'back') => void;

    // Optional overrides for enemy selection (used by Combat Plateau menu)
    enemyId?: EnemyId;
    enemyCount?: number;
    enemyLevel?: number;

    // Optional override for tactical combat background image (ex: from world maps)
    // If omitted, the default CSS background remains in effect.
    backgroundSrc?: string;

    // Flow mode:
    // - normal: fin de combat => pas de plateau de récompenses (récompenses de base uniquement)
    // - donjon: plateau de récompenses (choix 1/3) + enchaînement de vagues
    mode?: 'normal' | 'donjon';
};

export function showTacticalSkirmish(options: TacticalSkirmishOptions = {}): void {
    ensureTacticalStyles();

    const mode = options.mode ?? 'normal';
    const isDonjon = mode === 'donjon';

    // Vue isométrique (affichage uniquement). La logique reste en grille 9x9.
    const USE_ISO_VIEW = true;

    const app = document.getElementById('app');
    if (!app) return;

    // Ensure background music is playing (resume without restarting if already loaded)
    const bgAudioManager = (window as any).game?.audioManager;
    if (bgAudioManager) {
        // Stop other ambient looping music (ex: auberge) when tactical background starts
        try { bgAudioManager.pauseAllLooping('background'); } catch (e) { /* noop */ }
        // Ensure auberge is explicitly paused (covers cases where it was played non-looping).
        try { bgAudioManager.pause('auberge'); } catch (e) { /* noop */ }
        const already = typeof bgAudioManager.isPlaying === 'function' ? Boolean(bgAudioManager.isPlaying('background')) : false;
        if (!already) {
            // Resume if paused, otherwise start (resume will fallback to play)
            try {
                bgAudioManager.resume('background');
            } catch (e) {
                try { bgAudioManager.play('background'); } catch (e2) { /* noop */ }
            }
        }
    }

    const enemyId = options.enemyId ?? ('gobelin' as const);
    const enemyCount = Math.max(1, Math.floor(Number(options.enemyCount ?? 3)));

    // Donjon (enchaînement): même logique, commence au niveau du héros (sauf override)
    const baseEnemyLevel = Math.max(1, Math.floor(Number(options.enemyLevel ?? hero.level ?? 1)));
    let enemyLevel = baseEnemyLevel;
    let baseRewardsAppliedForThisFight = false;
    let questVictoryNotifiedForThisFight = false;

    type PostWinRewardKind = 'herb' | 'buff' | 'treasure' | 'retreat' | 'campfire';
    type PostWinBuffKind = 'atk10' | 'manaRegen4' | 'maxMana10' | 'dmgTakenMinus10';
    type PostWinTreasureKind = 'wood1' | 'goldX2' | 'herb1';
    type PostWinState = {
        active: true;
        pointsVisible: boolean;
        baseXp: number;
        baseGold: number;
        herbPos: Pos;
        buffPos: Pos;
        treasurePos: Pos;
        retreatPos: Pos;
        chosenKind: Exclude<PostWinRewardKind, 'retreat'> | null;
        chosenBuff: PostWinBuffKind | null;
        chosenTreasure: PostWinTreasureKind | null;
        spawnInTurns: number | null;
    };

    const rewardMultiplierForLevel = (lvl: number): number => {
        // Donjon: +25% par enchaînement (combat de base => 0%), capé à +100%
        const steps = isDonjon ? Math.max(0, Math.floor(lvl) - baseEnemyLevel) : 0;
        return Math.min(2, 1 + steps * 0.25);
    };

    // IMPORTANT: on conserve la party réelle (pas des clones) pour que les PV/Mana diminués persistent
    // en dehors du combat plateau (et entre les combats enchaînés).
    // createQuickSkirmishFromParty clone déjà les acteurs pour l'état du plateau.
    const sessionParty = getPartyMembers().slice(0, 3);
    const buildState = () => {
        const s = createQuickSkirmishFromParty(sessionParty, { enemyId, enemyLevel: enemyLevel, enemyCount });
        // Adventure-only mechanics (temporary effects/penalties cleared on exit)
        (s as any).__adventureMode = true;
        return s;
    };

    let state = buildState();
    // Nouveau système de tours: le joueur choisit l'allié qui commence.
    // Demande: au début du premier combat plateau, permettre au joueur de placer ses héros.
    // Ordre de placement automatique: guerrier (ally-1) -> mage (ally-2) -> voleur (ally-3).
    try {
                // Déploiement local à cette série de combats (premier combat de la série)
                (state as any).__deployment = {
                    active: true,
                    step: 0,
                    order: ['ally-1', 'ally-2', 'ally-3'],
                    // Zone de placement: 4 dernières lignes (calculée dynamiquement)
                    minY: Math.max(0, (state.height ?? 9) - 4),
                };
                state.activeUnitId = 'ally-1';
                (state as any).sideToAct = 'allies';
                state.log.unshift('Phase de placement: clique une case en bas pour placer tes héros.');
                state.log.unshift('Placement: Guerrier -> Mage -> Voleur.');
            } catch (e) {
                // noop
            }
    let selectedSkillKey: string | null = null;
    let selectedPostCombatInvIdx: number | null = null;
    let renderRef: (() => void) | null = null;

    let isoResizeBound = false;

    let pixiMountedListenerBound = false;

    // Integrated-terrain background cache (contain math needs natural image size).
    let integratedBgUrl: string | null = null;
    let integratedBgNaturalW = 0;
    let integratedBgNaturalH = 0;
    let integratedBgLoading = false;

    const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));

    // Mirror the world-map Pixi boardRect logic (centered vw/vh * scale).
    // IMPORTANT: we do NOT modify the map renderer; we just align combat to its existing behavior.
    const applyCombatBoardRectLikeMap = () => {
        const wrapEl = document.querySelector('.tactical-wrap.tactical-combat') as HTMLElement | null;
        if (!wrapEl) return;

        const vw = Math.max(1, Math.floor(Number(window.innerWidth ?? 1)));
        const vh = Math.max(1, Math.floor(Number(window.innerHeight ?? 1)));
        const rawScale = Number((options as any).boardScale ?? 0.6);
        const scale = clamp(Number.isFinite(rawScale) ? rawScale : 0.6, 0.35, 1.0);
        const w = Math.max(1, Math.floor(vw * scale));
        const h = Math.max(1, Math.floor(vh * scale));
        const left = Math.floor((vw - w) / 2);
        const top = Math.floor((vh - h) / 2);

        wrapEl.classList.add('align-map');
        wrapEl.style.setProperty('--boardLeft', `${left}px`);
        wrapEl.style.setProperty('--boardTop', `${top}px`);
        wrapEl.style.setProperty('--boardW', `${w}px`);
        wrapEl.style.setProperty('--boardH', `${h}px`);
        // Keep legacy sizing vars coherent for any rules still using --boardSize.
        wrapEl.style.setProperty('--boardSize', `${h}px`);
    };

    const layoutIsoGrid = () => {
        if (!USE_ISO_VIEW) return;
        const gridEl = document.getElementById('tacticalGrid') as HTMLElement | null;
        if (!gridEl) return;
        if (!gridEl.classList.contains('iso')) return;

        const cols = Math.max(1, Math.floor(Number(state.width ?? 9)));
        const rows = Math.max(1, Math.floor(Number(state.height ?? 9)));

        // Base sizing matches the world-map scheduleIsoLayout(): pad=10, gap from meta (default 2).
        const gridW = Math.max(0, gridEl.clientWidth);
        const gridH = Math.max(0, gridEl.clientHeight);
        // If the browser hasn't laid out the grid yet, measurements can be 0.
        if (gridW < 80 || gridH < 80) return;
        const pad = 10;
        const ISO_SCALE = clamp(Number((options as any).isoScale ?? 0.85), 0.6, 2.2);
        const ASPECT = clamp(Number((options as any).tileAspect ?? 0.68), 0.35, 0.9);
        const gap = Math.max(0, Math.floor(Number((options as any).tileGap ?? 2)));

        const baseTileW = Math.max(26, (gridW - pad * 2 - gap * (cols - 1)) / Math.max(4, cols));
        const tileW = Math.max(28, Math.floor(baseTileW * ISO_SCALE));
        const tileH = Math.max(16, Math.floor(tileW * ASPECT));

        const halfW = tileW / 2;
        const halfH = tileH / 2;

        // Add a real isometric gap so tiles don't visually cover each other.
        const isoGapX = Math.max(0, Math.floor(gap * 1.0));
        const isoGapY = Math.max(0, Math.floor(gap * 0.65));
        const stepW = halfW + isoGapX;
        const stepH = halfH + isoGapY;

        // Cache tile size in CSS vars (used by .tactical-grid.iso styles)
        gridEl.style.setProperty('--isoTileW', `${tileW}px`);
        gridEl.style.setProperty('--isoTileH', `${tileH}px`);

        // If the combat board uses integrated terrain, compute background alignment for per-tile cutouts.
        const panelEl = gridEl.closest('.tactical-board-panel') as HTMLElement | null;
        const bgEl = panelEl?.querySelector('.tactical-board-bg') as HTMLElement | null;
        const bgRect = bgEl ? bgEl.getBoundingClientRect() : null;
        const gridRect = gridEl.getBoundingClientRect();

        let bgOffsetX = 0;
        let bgOffsetY = 0;
        let bgDrawW = bgRect?.width ?? 0;
        let bgDrawH = bgRect?.height ?? 0;

        if (bgEl && bgRect && bgRect.width > 10 && bgRect.height > 10) {
            const bgImageCss = getComputedStyle(bgEl).backgroundImage;
            gridEl.style.setProperty('--tacticalBgImage', bgImageCss || 'none');

            // Parse url("...") from computed background-image.
            const m = /url\((['\"]?)(.*?)\1\)/.exec(bgImageCss || '');
            const url = m?.[2] ? String(m[2]) : null;
            if (url && url !== integratedBgUrl && !integratedBgLoading) {
                integratedBgLoading = true;
                integratedBgUrl = url;
                const img = new Image();
                img.onload = () => {
                    integratedBgNaturalW = (img as any).naturalWidth || img.width || 0;
                    integratedBgNaturalH = (img as any).naturalHeight || img.height || 0;
                    integratedBgLoading = false;
                    scheduleIsoLayout();
                };
                img.onerror = () => {
                    integratedBgNaturalW = 0;
                    integratedBgNaturalH = 0;
                    integratedBgLoading = false;
                };
                img.src = url;
            }

            // Match CSS background-size: contain; background-position: center.
            if (integratedBgNaturalW > 0 && integratedBgNaturalH > 0) {
                const s = Math.min(bgRect.width / integratedBgNaturalW, bgRect.height / integratedBgNaturalH);
                bgDrawW = integratedBgNaturalW * s;
                bgDrawH = integratedBgNaturalH * s;
                bgOffsetX = (bgRect.width - bgDrawW) / 2;
                bgOffsetY = (bgRect.height - bgDrawH) / 2;
            } else {
                // Fallback: assume stretched to element box.
                bgDrawW = bgRect.width;
                bgDrawH = bgRect.height;
                bgOffsetX = 0;
                bgOffsetY = 0;
            }

            gridEl.style.setProperty('--tacticalBgSize', `${bgDrawW}px ${bgDrawH}px`);
        } else {
            gridEl.style.setProperty('--tacticalBgImage', 'none');
            gridEl.style.setProperty('--tacticalBgSize', 'auto');
        }

        // Center the diamond map inside the square board.
        const minX = -(rows - 1) * stepW;
        const maxX = (cols - 1) * stepW;
        const minY = 0;
        const maxY = (cols + rows - 2) * stepH;
        const fullW = (maxX - minX) + tileW;
        const fullH = (maxY - minY) + tileH;
        const offsetX = (gridW - fullW) / 2 + tileW / 2 - minX;
        const offsetY = (gridH - fullH) / 2 + tileH / 2 - minY;

        const tiles = gridEl.querySelectorAll<HTMLElement>('.tile[data-x][data-y]');

        // Ensure the always-visible isometric grid overlay exists.
        let overlay = gridEl.querySelector('svg.iso-grid-overlay') as SVGSVGElement | null;
        if (!overlay) {
            overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
            overlay.classList.add('iso-grid-overlay');
            // Put the overlay before tiles (behind units).
            gridEl.insertBefore(overlay, gridEl.firstChild);
        }
        overlay.setAttribute('viewBox', `0 0 ${gridW} ${gridH}`);
        overlay.setAttribute('preserveAspectRatio', 'none');

        const hoverKey = String((gridEl as any).dataset?.isoHoverKey ?? '');

        const polygonFor = (cx: number, cy: number): string => {
            const p1 = `${cx},${cy - halfH}`;
            const p2 = `${cx + halfW},${cy}`;
            const p3 = `${cx},${cy + halfH}`;
            const p4 = `${cx - halfW},${cy}`;
            return `${p1} ${p2} ${p3} ${p4}`;
        };

        const polyParts: string[] = [];
        for (const el of tiles) {
            const x = Number(el.dataset.x);
            const y = Number(el.dataset.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            const cx = offsetX + (x - y) * stepW;
            const cy = offsetY + (x + y) * stepH;

            el.style.left = `${cx}px`;
            el.style.top = `${cy}px`;
            // Stable painter's ordering (back to front)
            el.style.zIndex = String(Math.floor((x + y) * 100 + x));

            // Per-tile background cutout positioning (terrain intégré).
            if (bgEl && bgRect && bgRect.width > 10 && bgRect.height > 10) {
                const tileViewportX = gridRect.left + cx;
                const tileViewportY = gridRect.top + cy;
                const localX = tileViewportX - bgRect.left;
                const localY = tileViewportY - bgRect.top;
                const bgPosX = bgOffsetX - localX + tileW / 2;
                const bgPosY = bgOffsetY - localY + tileH / 2;
                el.style.setProperty('--tacticalBgPosX', `${bgPosX}px`);
                el.style.setProperty('--tacticalBgPosY', `${bgPosY}px`);
            } else {
                el.style.setProperty('--tacticalBgPosX', '0px');
                el.style.setProperty('--tacticalBgPosY', '0px');
            }

            // Keep overlay polygons in sync with the current tile classes (reachable/path/range/active/etc).
            const tileKey = `${x},${y}`;
            const classes: string[] = ['iso-tile'];
            for (const k of ['move-path', 'move-dest', 'in-range', 'in-range-enemy', 'active', 'active-enemy-turn', 'reward-tile']) {
                if (el.classList.contains(k)) classes.push(k);
            }
            if (tileKey === hoverKey) classes.push('hovered');

            const pts = polygonFor(cx, cy);
            polyParts.push(`<polygon class="${classes.join(' ')}" points="${pts}"></polygon>`);
        }

        overlay.innerHTML = polyParts.join('');
    };

    const scheduleIsoLayout = () => {
        if (!USE_ISO_VIEW) return;
        // Do 2 passes: after paint + a short delay (fonts/images/styles may affect sizing).
        requestAnimationFrame(() => {
            layoutIsoGrid();
            setTimeout(() => layoutIsoGrid(), 80);
        });
    };

    const animator = createTacticalAnimator({
        getState: () => state,
        render: () => renderRef?.(),
    });

    const flashUnitAtPos = (pos: Pos, kind: 'damage' | 'heal' | 'reduced') => {
        const attempt = (delay = 0) => {
            setTimeout(() => {
                try {
                    const tile = document.querySelector(`.tactical-grid .tile[data-x="${pos.x}"][data-y="${pos.y}"]`) as HTMLElement | null;
                    console.debug('[flashUnitAtPos] attempt', { pos, kind, found: !!tile, delay });
                    if (!tile) {
                        // retry once after a short delay in case the DOM is being re-rendered
                        if (delay === 0) attempt(80);
                        return;
                    }
                    const sprite = tile.querySelector('.unit-sprite') as HTMLElement | null;
                    const hpBar = tile.querySelector('.unit-sprite-bar.hp') as HTMLElement | null;
                    if (kind === 'damage') {
                        if (sprite) { sprite.classList.add('flash-damage'); setTimeout(() => sprite.classList.remove('flash-damage'), 600); }
                        if (hpBar) { hpBar.classList.add('flash-damage'); setTimeout(() => hpBar.classList.remove('flash-damage'), 600); }
                    } else if (kind === 'heal') {
                        if (sprite) { sprite.classList.add('flash-heal'); setTimeout(() => sprite.classList.remove('flash-heal'), 360); }
                        if (hpBar) { hpBar.classList.add('flash-heal'); setTimeout(() => hpBar.classList.remove('flash-heal'), 360); }
                    } else if (kind === 'reduced') {
                        if (hpBar) { hpBar.classList.add('flash-reduced'); setTimeout(() => hpBar.classList.remove('flash-reduced'), 360); }
                    }
                } catch (e) {
                    console.error('[flashUnitAtPos] error', e);
                }
            }, delay);
        };
        attempt(0);
    };

    const spawnFloatAtPos = (pos: Pos, kind: 'damage' | 'heal', amount: number) => {
        const val = Math.max(0, Math.floor(Number(amount ?? 0)));
        if (val <= 0) return;

        const attempt = (delay = 0) => {
            setTimeout(() => {
                try {
                    const tile = document.querySelector(`.tactical-grid .tile[data-x="${pos.x}"][data-y="${pos.y}"]`) as HTMLElement | null;
                    if (!tile) {
                        if (delay === 0) attempt(80);
                        return;
                    }

                    const el = document.createElement('div');
                    el.className = `tactical-float ${kind}`;
                    el.textContent = String(val);
                    const jitterX = Math.max(-10, Math.min(10, (Math.random() * 18 - 9)));
                    const jitterY = Math.max(-8, Math.min(8, (Math.random() * 14 - 7)));
                    el.style.left = `${kind === 'damage' ? 78 : 30}%`;
                    el.style.top = `${kind === 'damage' ? 12 : 18}%`;
                    el.style.marginLeft = `${Math.round(jitterX)}px`;
                    el.style.marginTop = `${Math.round(jitterY)}px`;

                    tile.appendChild(el);
                    setTimeout(() => {
                        try { el.remove(); } catch { /* noop */ }
                    }, 2400);
                } catch {
                    // noop
                }
            }, delay);
        };

        attempt(0);
    };


    const enemyAuto = createEnemyAutoRunner({
        getState: () => state,
        render: () => renderRef?.(),
        moveAnimated: (unitId, dest) => animator.animateMoveTo(unitId, dest),
        moveAnimatedFree: (unitId, dest) => animator.animateMoveFree(unitId, dest),
    });

    const syncFromActors = () => {
        for (const u of state.units) {
            if (!u.actor) continue;
            u.pv = Math.max(0, Math.floor(u.actor.pv ?? 0));
            // Affichage: utiliser les maxima effectifs (équipement/passifs) sans les rendre permanents.
            u.maxPv = Math.max(1, Math.floor((u.actor as any).effectiveMaxPv ?? u.actor.maxPv ?? u.maxPv ?? 1));
            u.actionPoints = Math.max(0, Math.floor((u.actor as any).actionPoints ?? u.actionPoints ?? 0));
            u.actionPointsMax = Math.max(1, Math.floor((u.actor as any).actionPointsMax ?? u.actionPointsMax ?? 1));
        }

        // Sync vers la party de session (indexée sur ally-1/2/3)
        const allies = state.units.filter((u) => u.team === 'allies');
        for (let i = 0; i < Math.min(allies.length, sessionParty.length); i++) {
            const u = allies[i];
            const a = u?.actor;
            const dst = sessionParty[i];
            if (!a || !dst) continue;
            dst.pv = Math.max(0, Math.floor(a.pv ?? dst.pv));
            dst.maxPv = Math.max(1, Math.floor(a.maxPv ?? dst.maxPv));
            dst.currentMana = Math.max(0, Math.floor((a as any).currentMana ?? dst.currentMana));
            dst.maxMana = Math.max(0, Math.floor((a as any).maxMana ?? dst.maxMana));
            dst.activeEffects = Array.isArray((a as any).activeEffects) ? (a as any).activeEffects : dst.activeEffects;
            (dst as any).__adventureMaxManaBonus = Math.max(
                0,
                Math.floor(Number((a as any).__adventureMaxManaBonus ?? (dst as any).__adventureMaxManaBonus ?? 0))
            );
            (dst as any).__adventureMaxHpPenalty = Math.max(
                0,
                Math.floor(Number((a as any).__adventureMaxHpPenalty ?? (dst as any).__adventureMaxHpPenalty ?? 0))
            );
            dst.manaRegenPerTurn = Math.max(0, Math.floor((a as any).manaRegenPerTurn ?? dst.manaRegenPerTurn));
            dst.baseAttack = Math.max(0, Math.floor((a as any).baseAttack ?? dst.baseAttack));
        }
    };

    const playSkillAudio = (skill: Skill) => {
        const audioManager = (window as any).game?.audioManager;
        if (!audioManager) return;
        playTacticalSkillAudio(skill, audioManager);
    };



    const computeBaseRewardsForFight = (): { xp: number; gold: number; wood: number; herb: number } => {
        const enemy = createEnemy(enemyId as any, enemyLevel);
        const mult = rewardMultiplierForLevel(enemyLevel);
        const totalXp = Math.max(0, Math.floor((enemy.xpReward ?? 0) * enemyCount * mult));
        const totalGold = Math.max(0, Math.floor((enemy.goldReward ?? 0) * enemyCount * mult));
        const totalWood = Math.max(0, Math.floor(Number((enemy as any).woodReward ?? 0) * enemyCount * mult));
        const totalHerb = Math.max(0, Math.floor(Number((enemy as any).herbReward ?? 0) * enemyCount * mult));
        return { xp: totalXp, gold: totalGold, wood: totalWood, herb: totalHerb };
    };

    const applyBaseRewardsIfNeeded = () => {
        if (baseRewardsAppliedForThisFight) return;
        baseRewardsAppliedForThisFight = true;

        const { xp, gold, wood, herb } = computeBaseRewardsForFight();
        if (xp > 0) hero.gainXP(xp);
        if (gold > 0) hero.gold = Math.max(0, Math.floor((hero.gold ?? 0) + gold));
        if (wood > 0) (hero as any).wood = Math.max(0, Math.floor(Number((hero as any).wood ?? 0) + wood));
        if (herb > 0) (hero as any).herb = Math.max(0, Math.floor(Number((hero as any).herb ?? 0) + herb));
        const woodTxt = wood > 0 ? ` et ${wood} bois` : '';
        const herbTxt = herb > 0 ? ` et ${herb} herbes` : '';
        const text = `Récompenses: +${xp} XP, +${gold} or${woodTxt}${herbTxt}.`;
        state.log.unshift(text);
        try {
            showTemporaryMessage(`Victoire ! ${text}`, 4000);
        } catch (e) {
            // noop
        }
    };

    const ensurePostWinState = (baseXp: number, baseGold: number): PostWinState => {
        const s: any = state as any;
        if (s.__postWin && s.__postWin.active) return s.__postWin as PostWinState;

        const midX = Math.floor((state.width - 1) / 2);
        const midY = Math.floor((state.height - 1) / 2);

        const post: PostWinState = {
            active: true,
            pointsVisible: true,
            baseXp,
            baseGold,
            herbPos: { x: 0, y: midY },
            buffPos: { x: midX, y: 0 },
            treasurePos: { x: state.width - 1, y: midY },
            retreatPos: { x: midX, y: state.height - 1 },
            chosenKind: null,
            chosenBuff: null,
            chosenTreasure: null,
            spawnInTurns: null,
        };
        s.__postWin = post;
        return post;
    };

    const applyHerbReward = (): string => {
        const healPct = 0.33;
        const allies = state.units.filter((u) => u.team === 'allies' && u.pv > 0);
        for (const u of allies) {
            const a = u.actor;
            if (!a) continue;
            const maxHp = Math.max(1, Math.floor(a.effectiveMaxPv));
            const before = Math.max(0, Math.floor(a.pv));
            const heal = Math.max(1, Math.floor(maxHp * healPct));
            a.maxPv = maxHp;
            a.pv = Math.min(maxHp, before + heal);
            u.pv = Math.max(0, Math.floor(a.pv));
            u.maxPv = Math.max(1, Math.floor(a.maxPv));
        }
        const text = `Herbe médicinale: le groupe récupère ~33% PV.`;
        state.log.unshift(text);
        return text;
    };

    const applyBuffReward = (kind: PostWinBuffKind): string => {
        const allies = state.units.filter((u) => u.team === 'allies' && u.pv > 0);
        for (const u of allies) {
            const p = u.actor;
            if (!p) continue;
            (p as any).activeEffects = Array.isArray((p as any).activeEffects) ? (p as any).activeEffects : [];

            if (kind === 'atk10') {
                (p as any).activeEffects.push({ type: 'buff', amount: 0.10, remainingTurns: -1, sourceSkill: 'adventure_atk10' });
            } else if (kind === 'manaRegen4') {
                (p as any).activeEffects.push({ type: 'mana_regen', amount: 4, remainingTurns: -1, sourceSkill: 'adventure_manaRegen4' });
            } else if (kind === 'maxMana10') {
                (p as any).__adventureMaxManaBonus = Math.max(0, Math.floor(Number((p as any).__adventureMaxManaBonus ?? 0))) + 10;
                p.maxMana = Math.max(0, Math.floor(p.maxMana + 10));
                p.currentMana = Math.min(p.currentMana + 10, p.effectiveMaxMana);
            } else if (kind === 'dmgTakenMinus10') {
                // On réutilise l'effet "defense" mais avec remainingTurns=-1 pour éviter la décrémentation à chaque coup.
                (p as any).activeEffects.push({ type: 'defense', amount: 0.10, remainingTurns: -1, sourceSkill: 'adventure_dmgMinus10' });
            }

            // Sync visible stats
            u.pv = Math.max(0, Math.floor(p.pv));
            u.maxPv = Math.max(1, Math.floor(p.maxPv));
        }

        const label =
            kind === 'atk10'
                ? '+10% attaque (aventure)'
                : kind === 'manaRegen4'
                  ? '+4 mana/tour (aventure)'
                  : kind === 'maxMana10'
                    ? '+10 mana max (aventure)'
                    : '-10% dégâts reçus (aventure)';
        state.log.unshift(`Bonus: ${label}.`);
        return `Bonus: ${label}.`;
    };

    const applyTreasureReward = (kind: PostWinTreasureKind, baseXp: number, baseGold: number): string => {
        if (kind === 'wood1') {
            (hero as any).wood = Math.max(0, Math.floor(Number((hero as any).wood ?? 0) + 1));
            const t = `Trésor: +1 bois.`;
            state.log.unshift(t);
            return t;
        }
        if (kind === 'goldX2') {
            hero.gold = Math.max(0, Math.floor((hero.gold ?? 0) + baseGold));
            const t = `Trésor: or x2 (+${baseGold}).`;
            state.log.unshift(t);
            return t;
        }
        if (kind === 'herb1') {
            (hero as any).herb = Math.max(0, Math.floor(Number((hero as any).herb ?? 0) + 1));
            const t = `Trésor: +1 herbe.`;
            state.log.unshift(t);
            return t;
        }
        // Fallback (shouldn't happen)
        const t = `Trésor: rien.`;
        state.log.unshift(t);
        return t;
    };

    const applyCampfireRest = () => {
        const allies = state.units.filter((u) => u.team === 'allies');
        for (const u of allies) {
            const a: any = u.actor;
            if (!a) continue;
            const maxHp = Math.max(1, Math.floor(Number(a.effectiveMaxPv ?? a.maxPv ?? u.maxPv ?? 1)));
            const maxMana = Math.max(0, Math.floor(Number(a.effectiveMaxMana ?? a.maxMana ?? 0)));
            a.pv = maxHp;
            a.maxPv = maxHp;
            a.currentMana = maxMana;
            u.pv = Math.max(0, Math.floor(a.pv));
            u.maxPv = Math.max(1, Math.floor(a.maxPv));
        }
        state.log.unshift(`Feu de camp: le groupe récupère tous ses PV et son mana.`);
    };

    const countCampfiresInParty = (): number => {
        // Le feu de camp peut être porté par n'importe quel membre de la party.
        let count = 0;
        for (const p of sessionParty) {
            const inv = ((p as any)?.inventory ?? []) as any[];
            count += inv.filter((it) => String(it?.id ?? '') === 'feu_de_camp').length;
        }
        return count;
    };

    const consumeOneCampfireFromParty = (): boolean => {
        for (const p of sessionParty) {
            const inv = (((p as any)?.inventory ?? []) as any[]).slice();
            const idx = inv.findIndex((it) => String(it?.id ?? '') === 'feu_de_camp');
            if (idx >= 0) {
                inv.splice(idx, 1);
                (p as any).inventory = inv;
                return true;
            }
        }
        return false;
    };

    const clearAdventureBonuses = () => {
        // Les bonus du plateau de récompenses sont temporaires: on les retire en quittant le plateau.
        for (const p of sessionParty) {
            if (!p) continue;

            const effects = Array.isArray((p as any).activeEffects) ? (p as any).activeEffects : [];
            (p as any).activeEffects = effects.filter((e: any) => !String(e?.sourceSkill ?? '').startsWith('adventure_'));

            const mmBonus = Math.max(0, Math.floor(Number((p as any).__adventureMaxManaBonus ?? 0)));
            if (mmBonus > 0) {
                (p as any).__adventureMaxManaBonus = 0;
                p.maxMana = Math.max(0, Math.floor(Number((p as any).maxMana ?? 0) - mmBonus));
                p.currentMana = Math.min(Math.max(0, Math.floor(Number((p as any).currentMana ?? 0))), p.effectiveMaxMana);
            }

            // Adventure wound system: max HP penalties persist after combat.
            // Only resting at the inn currently restores lost max HP.
        }
    };

    const spawnNextWave = () => {
        if (!isDonjon) return;
        // Conserve positions actuelles des alliés
        const prevAllyPositions: Pos[] = state.units
            .filter((u) => u.team === 'allies')
            .map((u) => ({ x: u.pos.x, y: u.pos.y }));

        // Sync party session depuis l'état courant
        syncFromActors();

        enemyLevel += 1;
        baseRewardsAppliedForThisFight = false;
        questVictoryNotifiedForThisFight = false;
        selectedSkillKey = null;
        enemyAuto.reset();

        const next = buildState();
        // Réinjecte positions alliées
        const nextAllies = next.units.filter((u) => u.team === 'allies');
        for (let i = 0; i < Math.min(nextAllies.length, prevAllyPositions.length); i++) {
            const pos = prevAllyPositions[i];
            if (pos) nextAllies[i]!.pos = { x: pos.x, y: pos.y };
        }
        // Nouveau combat => on repart en sélection d'allié
        (next as any).__postWin = undefined;

        state = next;
        state.log.unshift(`De nouveaux ennemis apparaissent (niv ${enemyLevel}).`);

        // In speed/initiative mode, automatically start the next unit's turn.
        if (((state as any).turnMode ?? 'speed') !== 'pick-alternate' && !state.activeUnitId) {
            const msgs = advanceTurn(state);
            for (const m of msgs.slice(0, 4)) state.log.unshift(m);
        }

        // Play start-of-combat sound for the spawned wave
        const am2 = (window as any).game?.audioManager;
        if (am2) am2.play('cestparti_olaf');
        render();
    };

    const resetFight = () => {
        baseRewardsAppliedForThisFight = false;
        questVictoryNotifiedForThisFight = false;
        selectedSkillKey = null;
        enemyAuto.reset();

        state = buildState();

        // In speed/initiative mode, automatically start the first unit's turn.
        if (((state as any).turnMode ?? 'speed') !== 'pick-alternate' && !state.activeUnitId) {
            const msgs = advanceTurn(state);
            for (const m of msgs.slice(0, 4)) state.log.unshift(m);
        }

        render();
    };

    const onFlee = options.onFlee ?? options.onBack ?? showAccueil;
    const onBackAfterCombat = options.onReturnAfterCombat ?? options.onBack ?? showAccueil;

    let combatEndOutcomeNotified: 'won' | 'fled' | 'back' | null = null;
    const notifyCombatEnd = (outcome: 'won' | 'fled' | 'back') => {
        if (combatEndOutcomeNotified) return;
        combatEndOutcomeNotified = outcome;
        try {
            options.onCombatEnd?.(outcome);
        } catch {
            // ignore
        }
    };

    const leaveSkirmish = (cb: () => void) => {
        try {
            // Assure qu'on part avec la party synchronisée, puis retire les bonus aventure.
            syncFromActors();
            clearAdventureBonuses();
        } catch (e) {
            console.error('[leaveSkirmish] cleanup error', e);
        }

		// Time passes when a combat is resolved (win/lose/flee).
		try {
			const h = (getPartyMembers()[0] as any) ?? (window as any).game?.hero ?? (hero as any);
			if (h) advanceGameTimeHours(h, 1, { reason: 'combat' });
		} catch {
			// ignore
		}

        // Destroy Pixi overlay if mounted for this screen.
        try { unmountBattleCanvas(); } catch (e) { /* noop */ }

        // Remove temporary sprite listener
        try { window.removeEventListener('tempSpriteChanged', onTempSpriteChanged); } catch (e) { /* noop */ }

        cb();
    };

    const getDefaultAllyUnit = () => state.units.find((u) => u.team === 'allies' && u.pv > 0) ?? null;
    const getActiveAllyUnit = () => {
        const u = state.activeUnitId ? getUnitById(state, state.activeUnitId) : undefined;
        return u && u.team === 'allies' && u.pv > 0 ? u : null;
    };
    const getInventoryTargetUnit = () => getActiveAllyUnit() ?? getDefaultAllyUnit();

    const render = () => {
        const alliesAlive = getTeamAliveCount(state, 'allies');
        const enemiesAlive = getTeamAliveCount(state, 'enemies');
        const combatEnded = alliesAlive === 0 || enemiesAlive === 0;
        const won = combatEnded && enemiesAlive === 0;

        if (won) notifyCombatEnd('won');

        const baseRewards = won ? computeBaseRewardsForFight() : { xp: 0, gold: 0, wood: 0, herb: 0 };
        if (won) applyBaseRewardsIfNeeded();

        // Quêtes: notifie une seule fois par combat gagné.
        if (won && !questVictoryNotifiedForThisFight) {
            questVictoryNotifiedForThisFight = true;
            try {
                (window as any).game?.questManager?.emit({
                    type: 'win_tactical',
                    enemyId: String(enemyId),
                    enemyCount: Number(enemyCount ?? 1) || 1,
                    enemyLevel: Number(enemyLevel ?? 1) || 1,
                });
            } catch (e) {
                console.error('[quest] win_tactical emit error', e);
            }
        }
        // Post-win reward board (3 rewards to pick) exists only in donjon mode.
        const postWin = won && isDonjon ? ensurePostWinState(baseRewards.xp, baseRewards.gold) : null;
        const inPostWin = Boolean(postWin && postWin.active);

        // IMPORTANT: persiste en continu les PV/Mana actuels vers la party réelle.
        // Sans ça, en quittant le plateau, les héros reviendraient avec d'anciens PV.
        syncFromActors();

        const active = state.activeUnitId ? getUnitById(state, state.activeUnitId) : undefined;
        const reachable = active && active.team === 'allies' ? listReachableTiles(state, active.id) : [];
        const reachableSet = new Set<string>(reachable.map(posKey));

        const activeActor = active?.actor;
        const selectedSkill: Skill | null = (() => {
            if (!activeActor) return null;
            if (!selectedSkillKey) return null;
            const skills = ((activeActor as any).skills ?? []) as Skill[];
            return skills.find((s) => getSkillStableKey(s) === selectedSkillKey) ?? null;
        })();

        const deselectSkill = () => {
            if (!selectedSkillKey) return;
            selectedSkillKey = null;
        };

        const title = `Combat plateau — ${enemyId} (niv ${enemyLevel})`;
        const turnInfo = active ? `Tour: ${active.name}` : 'Tour';

        const isSpeedTurnMode = ((state as any).turnMode ?? 'speed') !== 'pick-alternate';
        const getPortraitSrc = (u: any): string => {
            if (!u) return 'ImagesRPG/imagespersonnage/trueplayer.png';
            if (u.team === 'enemies') {
                const img = String((u.actor as any)?.image ?? '');
                return img || 'ImagesRPG/imagespersonnage/trueennemi.png';
            }
            const cls = String((u.actor as any)?.characterClass ?? '').toLowerCase();
            const stun = Math.max(0, Math.floor(Number((u.actor as any)?.stunTurns ?? 0)));
            const temp = String((u.actor as any)?.__tempSprite ?? '');
            if (temp) return temp;
            if (cls === 'guerrier' && stun > 0) return 'ImagesRPG/imagespersonnage/perso_guerrier_mort.png';
            if (cls === 'mage') return 'ImagesRPG/imagespersonnage/mage.png';
            if (cls === 'voleur') return 'ImagesRPG/imagespersonnage/voleur.png';
            if (cls === 'guerrier') {
                const idle = getIdleSpriteSrc(cls);
                return (idle ? idle.replace(/^\.\//, '') : 'ImagesRPG/imagespersonnage/true_perso_guerrier.png');
            }
            return 'ImagesRPG/imagespersonnage/trueplayer.png';
        };

        const initiativeHtml = (() => {
            if (!isSpeedTurnMode) return '';
            const order = Array.isArray((state as any).turnOrder) ? ((state as any).turnOrder as string[]).filter(Boolean) : [];
            if (!order.length) return '';

            // Display from the current actor (turnIndex) if available, otherwise from activeUnitId, otherwise from start.
            let startIdx = Math.max(0, Math.floor(Number((state as any).turnIndex ?? 0)));
            if (startIdx <= 0 && (state as any).activeUnitId) {
                const i = order.indexOf(String((state as any).activeUnitId));
                if (i >= 0) startIdx = i;
            }
            startIdx = Math.max(0, Math.min(order.length - 1, startIdx));

            const items = order
                .map((_, k) => {
                    const idx = (startIdx + k) % order.length;
                    const id = order[idx]!;
                    const u = getUnitById(state, id as any);
                    const alive = Boolean(u && u.pv > 0);
                    const isActive = Boolean((state as any).activeUnitId && String((state as any).activeUnitId) === id);
                    const spd = Math.max(0, Math.floor(Number((u as any)?.speed ?? 0)));
                    const border = (u as any)?.team === 'enemies' ? 'rgba(244,67,54,0.55)' : 'rgba(76,175,80,0.55)';
                    const bg = isActive ? 'rgba(255,217,101,0.14)' : 'rgba(255,255,255,0.04)';
                    const opacity = alive ? 1 : 0.28;
                    const name = String((u as any)?.name ?? id);
                    const img = getPortraitSrc(u);
                    return `
                        <div title="${escapeHtml(name)} (VIT ${spd})" style="display:flex;align-items:center;gap:8px;min-width:120px;padding:6px 8px;border-radius:10px;background:${bg};border:1px solid ${border};opacity:${opacity};${isActive ? 'box-shadow:0 0 0 2px rgba(255,217,101,0.25) inset;' : ''}">
                            <img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" style="width:28px;height:28px;border-radius:8px;object-fit:cover;flex:0 0 auto;" />
                            <div style="min-width:0;display:flex;flex-direction:column;line-height:1.05;">
                                <div style="font-weight:800;font-size:0.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;">${escapeHtml(name)}</div>
                                <div style="opacity:0.85;font-size:0.82em;">VIT ${spd}</div>
                            </div>
                        </div>
                    `;
                })
                .join('');

            return `
                <div class="tactical-panel" style="margin-top:8px;">
                    <div style="font-weight:800;margin-bottom:6px;">Initiative</div>
                    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;">
                        ${items}
                    </div>
                </div>
            `;
        })();

        const pw: any = (state as any).__postWin;
        const showDestinations = Boolean(inPostWin && pw?.active);
        const pointsVisible = Boolean(showDestinations && pw?.pointsVisible);

        const isPos = (p: any, x: number, y: number): boolean => Boolean(p && Number(p.x) === x && Number(p.y) === y);
        const markerHtmlFor = (x: number, y: number): string => {
            if (!showDestinations) return '';

            // Demi-tour toujours visible en post-win
            if (isPos(pw?.retreatPos, x, y)) return `<div class="reward-marker reward-retreat">Demi-tour</div>`;

            if (!pointsVisible) return '';
            if (isPos(pw?.herbPos, x, y)) return `<div class="reward-marker reward-marker-icon"><img src="ImagesRPG/imageskill/herbe.png" alt="Herbe" class="reward-marker-img"></div>`;
            if (isPos(pw?.buffPos, x, y)) return `<div class="reward-marker reward-marker-icon"><img src="ImagesRPG/imageskill/trefle.png" alt="Bonus" class="reward-marker-img"></div>`;
            if (isPos(pw?.treasurePos, x, y)) return `<div class="reward-marker reward-marker-icon"><img src="ImagesRPG/imageskill/tresor.png" alt="Trésor" class="reward-marker-img"></div>`;
            return '';
        };

        const alliesActedSet = new Set<string>(((state as any).alliesActedIds ?? []) as string[]);

        const deployState: any = (state as any).__deployment;
        const deployMinY = Math.max(0, Math.floor(Number(deployState?.minY ?? (state.height - 4))));
        const deployStep = Math.max(0, Math.floor(Number(deployState?.step ?? 0)));
        const deployOrder: string[] = Array.isArray(deployState?.order) && deployState.order.length ? deployState.order : ['ally-1','ally-2','ally-3'];

        const tiles: string[] = [];
        for (let y = 0; y < state.height; y++) {
            for (let x = 0; x < state.width; x++) {
                const pos: Pos = { x, y };
                const u = state.units.find((uu) => uu.pv > 0 && uu.pos.x === x && uu.pos.y === y);

                let cls = 'tile';
                if (active && active.pos.x === x && active.pos.y === y) {
                    cls += active.team === 'enemies' ? ' active-enemy-turn' : ' active';
                }
                if (reachableSet.has(posKey(pos))) cls += ' reachable';

                if (activeActor && selectedSkill) {
                    const inRange = isWithinSkillRangeDirectional(activeActor, selectedSkill, active.pos, pos);
                    if (inRange) cls += ' in-range';
                    if (inRange && u && u.team === 'enemies') cls += ' in-range-enemy';
                }

                const marker = !u ? markerHtmlFor(x, y) : '';
                if (marker) cls += ' reward-tile';

                // Deployment: highlight allowed placement tiles on the last rows
                if (deployState?.active && !u && y >= deployMinY) {
                    cls += ' deployment-allowed';
                }

                // In pick-alternate mode, grey-out allies who already acted this cycle (exclude the currently active unit).
                if ((state as any).turnMode === 'pick-alternate' && u && u.team === 'allies' && u.id !== state.activeUnitId) {
                    if (alliesActedSet.has(u.id)) cls += ' acted';
                }

                tiles.push(
                    `<div class="${cls}" data-x="${x}" data-y="${y}" data-unit-id="${u ? u.id : ''}"><div class="tile-bg" aria-hidden="true"></div>${u ? renderUnitHtml(u) : marker}</div>`
                );
            }
        }

        const alliesHtml = state.units
            .filter((u) => u.team === 'allies')
            .map((u) => renderBarsRow(u, u.id === state.activeUnitId))
            .join('');
        const enemiesHtml = state.units
            .filter((u) => u.team === 'enemies')
            .map((u) => renderBarsRow(u, u.id === state.activeUnitId))
            .join('');

        const inventoryHtml = (() => {
            const inv = ((hero as any).inventory ?? []) as any[];
            const gold = Math.max(0, Math.floor(Number((hero as any).gold ?? 0)));
            const wood = Math.max(0, Math.floor(Number((hero as any).wood ?? 0)));
            const herb = Math.max(0, Math.floor(Number((hero as any).herb ?? 0)));

            const campfireCount = countCampfiresInParty();
            const canUseCampfire = Boolean(inPostWin && pointsVisible && !pw?.chosenKind && campfireCount > 0);

            const itemsHtml = inv
                .map((it, idx) => {
                    const ctor = String((it as any)?.constructor?.name ?? '');
                    const canUse = ctor === 'Consumable';
                    const canEquip = ctor === 'Equipment';
                    const isSelected = selectedPostCombatInvIdx === idx;
                    const q = Math.max(1, Math.floor(Number((it as any)?.quantity ?? 1)));
                    const showQty = Boolean((it as any)?.stackable) && q > 1;
                    const qtyHtml = showQty ? `<span style="margin-left:2px;opacity:0.9;font-weight:900;">x${q}</span>` : '';
                    const icon = renderItemIconHtml(it, { size: 51 });
                    return `
                        <div data-tactical-inv-row="${idx}" style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;user-select:none;${isSelected ? 'outline:1px solid rgba(255,235,59,0.35);border-radius:10px;background:rgba(255,255,255,0.05);padding-left:8px;padding-right:8px;' : ''}">
                            <div style="min-width:0;">
                                <div style="display:flex;align-items:center;gap:8px;">${icon}${qtyHtml}</div>
                            </div>
                            <div style="white-space:nowrap;display:flex;gap:8px;align-items:center;">
                                ${isSelected && canUse ? `<button class="btn" data-inv-use-idx="${idx}" style="min-width:84px;">Utiliser</button>` : ''}
                                ${isSelected && canEquip ? `<button class="btn" data-inv-equip-idx="${idx}" style="min-width:84px;">Équiper</button>` : ''}
                            </div>
                        </div>
                    `;
                })
                .join('');

            return `
                <div style="font-weight:700;margin-bottom:6px;">Inventaire</div>
                <div class="tactical-log" id="tacticalInventoryBlock">
                    <div class="line">Or: ${gold}</div>
                    <div class="line">Bois: ${wood}</div>
                    <div class="line">Herbes: ${herb}</div>
                    ${canUseCampfire ? `<div class="line" style="margin:6px 0 8px 0;"><button class="btn" id="useCampfireBtn" style="min-width:180px;">Utiliser Feu de camp (${campfireCount})</button></div>` : ''}
                    ${inv.length ? itemsHtml : '<div class="line" style="opacity:0.8;">(vide)</div>'}
                </div>
            `;
        })();

        const logHtml = (state.log ?? [])
            .slice(0, 10)
            .map((l) => `<div class="line">${String(l)}</div>`)
            .join('');

        const canAct = Boolean(active && active.team === 'allies' && active.pv > 0 && (!combatEnded || inPostWin));

        const gridStyle = enemyId === 'arbre' ? 'style="background-image: url(\'ImagesRPG/imagesfond/image_combat3.jpeg\');"' : '';

        app.innerHTML = `

            <div class="tactical-wrap tactical-combat">
                <div class="tactical-hud">
                    <div class="tactical-panel">
                        <div style="font-weight:700;">${title}</div>
                        <div style="opacity:0.9;">${turnInfo}</div>
                    </div>
                    ${initiativeHtml}
                </div>

                <div class="tactical-main">
                    <div class="tactical-side">
                        <div class="tactical-panel team-panel" id="tacticalAlliesPanel">${alliesHtml}</div>
                        <div class="tactical-panel log-panel tactical-log-left">
                            <div style="font-weight:700;margin-bottom:6px;">Historique</div>
                            <div class="tactical-log">${logHtml}</div>
                        </div>
                    </div>

                    <div class="tactical-board-panel${USE_ISO_VIEW ? ' integrated-terrain' : ''}">
                        <div class="tactical-board-bg" aria-hidden="true"></div>
                        <div class="tactical-center">
                            ${deployState?.active ? (function(){
                                const names = deployOrder.map((id,i) => {
                                    const u = state.units.find((uu) => uu.id === id);
                                    const defaultNames = ['Guerrier','Mage','Voleur'];
                                    const n = u?.name ?? defaultNames[i] ?? id;
                                    if (i === deployStep) return `<span style="color:#ffd965;font-weight:800;">${n}</span>`;
                                    return `<span style="opacity:0.85;">${n}</span>`;
                                }).join(' / ');
                                return `<div class="deployment-banner" style="padding:6px;margin:6px 0 10px 0;background:rgba(0,0,0,0.55);border-radius:6px;color:#fff;font-weight:700;text-align:center;">PLACE: ${names}</div>`;
                            })() : ''}
                            <div class="tactical-grid${USE_ISO_VIEW ? ' iso integrated-terrain' : ''}" id="tacticalGrid" ${gridStyle}><div class="tactical-pixi-layer" id="tacticalPixiLayer" aria-hidden="true"></div>${tiles.join('')}</div>
                        </div>
                    </div>

                    <div class="tactical-side tactical-side-right">
                        <div class="tactical-panel team-panel" id="tacticalEnemiesPanel">${combatEnded ? inventoryHtml : enemiesHtml}</div>
                    </div>
                </div>

                <div class="tactical-skillbar tactical-skillbar-left" id="tacticalSkillsLeft"></div>
                <div class="tactical-skillbar tactical-skillbar-right" id="tacticalSkillsRight"></div>

                <div class="tactical-actions tactical-board-actions" aria-label="Actions de combat">
                    ${!combatEnded || inPostWin ? `<button class="btn" id="tacticalPassBtn">Passer le tour</button>` : ''}
                    ${!combatEnded ? `<button class="btn" id="tacticalFleeBtn">Fuir</button>` : ''}
                    ${combatEnded && won && !inPostWin ? `<button class="btn" id="tacticalWinBtn">Retour</button>` : ''}
                    ${combatEnded && !won && !inPostWin ? `<button class="btn" id="tacticalBackBtn">Retour</button>` : ''}
                </div>
            </div>
        `;

        // Allow per-instance combat background (e.g. same as the current world map).
        // Must be applied before scheduleIsoLayout() so integrated-terrain cutouts align.
        const boardPanelEl = app.querySelector('.tactical-board-panel') as HTMLElement | null;
        const wrapEl = app.querySelector('.tactical-wrap') as HTMLElement | null;
        if (boardPanelEl) {
            const src = String(options.backgroundSrc ?? '').trim();
            if (src) {
                boardPanelEl.style.setProperty('--tacticalBoardBgImage', `url("${src}")`);
                wrapEl?.style.setProperty('--tacticalBoardBgImage', `url("${src}")`);
            } else {
                boardPanelEl.style.removeProperty('--tacticalBoardBgImage');
                wrapEl?.style.removeProperty('--tacticalBoardBgImage');
            }
        }

        // Lock the combat board to the same viewport-centered rect as the world map.
        // Must run before scheduleIsoLayout() so measurements use the locked size.
        try { applyCombatBoardRectLikeMap(); } catch { /* noop */ }

        document.getElementById('tacticalFleeBtn')?.addEventListener('click', () => {
            notifyCombatEnd('fled');
            leaveSkirmish(onFlee);
        });
        document.getElementById('tacticalBackBtn')?.addEventListener('click', () => {
            notifyCombatEnd('back');
            leaveSkirmish(onBackAfterCombat);
        });
        document.getElementById('tacticalWinBtn')?.addEventListener('click', () => {
            // Outcome 'won' is already notified once when won becomes true.
            leaveSkirmish(onBackAfterCombat);
        });

        // After DOM creation, apply isometric positioning (absolute diamond layout).
        scheduleIsoLayout();

        // Enable Pixi units mode (hide DOM <img>, keep bars/effects for now).
        const gridForPixi = document.getElementById('tacticalGrid');
        if (gridForPixi) {
            gridForPixi.classList.add('pixi-units');
            // The integrated-terrain mode relies on per-tile opaque cutouts (tile-bg) and hides the SVG grid.
            // While we transition to Pixi, disable it so the board background stays visible.
            gridForPixi.classList.remove('integrated-terrain');
        }

        const boardPanelForPixi = document.querySelector('.tactical-board-panel') as HTMLElement | null;
        if (boardPanelForPixi) {
            boardPanelForPixi.classList.add('pixi-mode');
            boardPanelForPixi.classList.remove('integrated-terrain');
        }

        // Keep Pixi overlay synced to the computed DOM layout (2 passes like iso layout).
        requestAnimationFrame(() => {
            try { renderTacticalOverlayFromDom(); } catch (e) { console.error('[pixi] overlay render failed', e); }
            setTimeout(() => {
                try { renderTacticalOverlayFromDom(); } catch (e) { console.error('[pixi] overlay render failed', e); }
            }, 90);
        });

        // If Pixi mounts after our scheduled pass (async init), re-render once.
        if (!pixiMountedListenerBound) {
            pixiMountedListenerBound = true;
            window.addEventListener('pixiMounted', () => {
                try { renderTacticalOverlayFromDom(); } catch (e) { console.error('[pixi] overlay render failed', e); }
            });
        }
        if (USE_ISO_VIEW && !isoResizeBound) {
            isoResizeBound = true;
            window.addEventListener('resize', () => {
                // Let layout settle before measuring.
                try { applyCombatBoardRectLikeMap(); } catch { /* noop */ }
                scheduleIsoLayout();
            });
        }

        // Allow clicking allies in the allies panel to start their turn when placement just finished
        const alliesPanelEl = document.getElementById('tacticalAlliesPanel');
        alliesPanelEl?.addEventListener('click', (evt) => {
            try {
                const selectMode = Boolean((state as any).__placementJustFinished);
                if (!selectMode) return;
                const el = (evt.target as HTMLElement | null)?.closest('.ally-entry') as HTMLElement | null;
                if (!el) return;
                const uid = String(el.dataset.unitId ?? '');
                if (!uid) return;
                const u = getUnitById(state, uid);
                if (!u || u.pv <= 0) return;

                (state as any).__placementJustFinished = false;
                state.activeUnitId = uid;
                const msgs = startUnitTurn(state, uid);
                for (const m of msgs.slice(0, 4)) state.log.unshift(m);

                // Étourdissement: si le personnage est étourdi, il passe immédiatement.
                if ((state as any).__autoPassActiveUnit === uid) {
                    (state as any).__autoPassActiveUnit = null;
                    const passMsgs = advanceTurn(state);
                    for (const m of passMsgs.slice(0, 4)) state.log.unshift(m);
                    renderRef?.();
                    return;
                }

                state.log.unshift(`${u.name} commence son tour.`);
                renderRef?.();
            } catch (e) {
                // noop
            }
        });

        document.getElementById('tacticalPassBtn')?.addEventListener('click', () => {
            const selectMode = Boolean((state as any).__placementJustFinished);
            if (!canAct) {
                // In selection mode right after placement, allow skipping (continues the turn flow).
                if (selectMode) {
                    (state as any).__placementJustFinished = false;
                    const msgs = advanceTurn(state);
                    for (const m of msgs.slice(0, 4)) state.log.unshift(m);
                    render();
                    return;
                }

                if (active && active.team === 'enemies') {
                    state.log.unshift('Tour ennemi: impossible de passer.');
                } else {
                    state.log.unshift('Impossible de passer maintenant.');
                }
                render();
                return;
            }
            selectedSkillKey = null;

            // Post-win (donjon): si une récompense (ou un feu de camp) a été choisi(e), on décompte 3 tours avant l'apparition des monstres.
            const pw: PostWinState | undefined = (state as any).__postWin as any;
            const beforeId = state.activeUnitId;
            const beforeUnit = beforeId ? getUnitById(state, beforeId) : undefined;

            const msgs = advanceTurn(state);
            for (const m of msgs.slice(0, 4)) state.log.unshift(m);

            if (isDonjon && pw && pw.active && pw.chosenKind && typeof pw.spawnInTurns === 'number' && pw.spawnInTurns > 0) {
                if (beforeUnit && beforeUnit.team === 'allies') {
                    pw.spawnInTurns -= 1;
                    if (pw.spawnInTurns <= 0) {
                        spawnNextWave();
                        return;
                    }
                    state.log.unshift(`Monstres dans ${pw.spawnInTurns} tour(s)…`);
                }
            }

            render();
        });

        // Feu de camp (uniquement en post-win, avant choix de récompense)
        document.getElementById('useCampfireBtn')?.addEventListener('click', () => {
            const pw: any = (state as any).__postWin;
            if (!pw || !pw.active) return;
            if (!pw.pointsVisible || pw.chosenKind) return;

            if (!consumeOneCampfireFromParty()) {
                state.log.unshift('Aucun feu de camp dans l’inventaire.');
                render();
                return;
            }

            // Applique l'effet "repos auberge" au groupe
            applyCampfireRest();
            syncFromActors();

            // Fait disparaître les récompenses; en donjon, déclenche l'arrivée des monstres dans 3 tours
            pw.chosenKind = 'campfire';
            pw.pointsVisible = false;
            pw.spawnInTurns = isDonjon ? 3 : null;
            state.log.unshift('Les autres récompenses disparaissent…');
            if (isDonjon) state.log.unshift('Monstres dans 3 tours…');
            render();
        });

        // Inventaire (post-combat): utiliser / équiper
        (document.querySelectorAll('[data-inv-use-idx]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedPostCombatInvIdx = null;
                const idx = Number(btn.getAttribute('data-inv-use-idx'));
                const inv = ((hero as any).inventory ?? []) as any[];
                const item = inv[idx];
                if (!item) return;

                const targetUnit = getInventoryTargetUnit();
                const targetActor = targetUnit?.actor;
                if (!targetUnit || !targetActor) {
                    state.log.unshift('Aucune cible pour utiliser l’objet.');
                    render();
                    return;
                }

                // On applique l'effet sur l'acteur du plateau (pour feedback immédiat),
                // puis on supprime l'objet du vrai inventaire.
                const ctor = String((item as any)?.constructor?.name ?? '');
                if (ctor !== 'Consumable' || typeof (item as any).use !== 'function') {
                    state.log.unshift('Cet objet ne peut pas être utilisé.');
                    render();
                    return;
                }

                const msg = String((item as any).use(targetActor));
                inv.splice(idx, 1);
                (hero as any).inventory = inv;

                // Sync PV/Mana vers la party réelle
                syncFromActors();
                state.log.unshift(msg);
                render();
            });
        });

        (document.querySelectorAll('[data-inv-equip-idx]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedPostCombatInvIdx = null;
                const idx = Number(btn.getAttribute('data-inv-equip-idx'));
                const inv = ((hero as any).inventory ?? []) as any[];
                const item = inv[idx];
                if (!item) return;

                const targetUnit = getInventoryTargetUnit();
                const targetActor = targetUnit?.actor;
                if (!targetUnit || !targetActor) {
                    state.log.unshift('Aucune cible pour équiper.');
                    render();
                    return;
                }

                const ctor = String((item as any)?.constructor?.name ?? '');
                if (ctor !== 'Equipment') {
                    state.log.unshift('Cet objet ne peut pas être équipé.');
                    render();
                    return;
                }

                // Inventaire partagé (hero) => on équipe sur la cible (acteur du plateau + party réelle)
                const eq = item as any;
                const slot = String(eq?.slot ?? '') as any;
                if (!slot) {
                    state.log.unshift('Équipement invalide.');
                    render();
                    return;
                }

                // Enlève du sac
                inv.splice(idx, 1);
                (hero as any).inventory = inv;

                // Retourne l'ancien équipement dans le sac partagé
                const prev = (targetActor as any).equipment?.[slot];
                if (prev) {
                    (hero as any).inventory = [...((hero as any).inventory ?? []), prev];
                }

                // Applique sur l'acteur du plateau
                (targetActor as any).equipment = Object.assign({}, (targetActor as any).equipment);
                (targetActor as any).equipment[slot] = eq;
                if (eq.hpBonus && eq.hpBonus > 0) {
                    (targetActor as any).pv = Math.min((targetActor as any).pv + eq.hpBonus, (targetActor as any).effectiveMaxPv);
                }
                if (eq.manaBonus && eq.manaBonus > 0) {
                    (targetActor as any).currentMana = Math.min((targetActor as any).currentMana + eq.manaBonus, (targetActor as any).effectiveMaxMana);
                }
                (targetActor as any).pv = Math.min((targetActor as any).pv, (targetActor as any).effectiveMaxPv);
                (targetActor as any).currentMana = Math.min((targetActor as any).currentMana, (targetActor as any).effectiveMaxMana);

                // Sync vers la party réelle et refresh unités
                syncFromActors();
                state.log.unshift(`${targetActor.name} équipe ${String(eq?.name ?? 'un équipement')}.`);
                render();
            });
        });

        // Inventaire (post-combat): sélection (click) / désélection (clic droit ou espace vide)
        (document.querySelectorAll('[data-tactical-inv-row]') as NodeListOf<HTMLElement>).forEach((row) => {
            row.addEventListener('click', (ev) => {
                const t = ev.target as HTMLElement | null;
                if (t?.closest('button')) return;
                const idx = Number(row.getAttribute('data-tactical-inv-row'));
                selectedPostCombatInvIdx = Number.isFinite(idx) ? idx : null;
                render();
            });
            row.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                selectedPostCombatInvIdx = null;
                render();
            });
        });

        (document.getElementById('tacticalInventoryBlock') as HTMLElement | null)?.addEventListener('click', (ev) => {
            const t = ev.target as HTMLElement | null;
            if (!t) return;
            if (t.closest('[data-tactical-inv-row]') || t.closest('button')) return;
            selectedPostCombatInvIdx = null;
            render();
        });

        // Skills (split into 2 rows: 7 left, remaining right)
        const skillsLeftDiv = document.getElementById('tacticalSkillsLeft');
        const skillsRightDiv = document.getElementById('tacticalSkillsRight');
        if (skillsLeftDiv && skillsRightDiv && canAct && activeActor && !inPostWin) {
            const skills = (((activeActor as any).skills ?? []) as Skill[]).filter(Boolean);
            const playerPA = Math.max(0, Math.floor((active as any).actionPoints ?? 0));

            const leftSkills = skills.slice(0, 7);
            const rightSkills = skills.slice(7, 14);

            renderSkillButtons(
                skillsLeftDiv,
                leftSkills,
                (skill: Skill) => {
                    const cur = state.activeUnitId ? getUnitById(state, state.activeUnitId) : undefined;
                    if (!cur || cur.team !== 'allies' || cur.pv <= 0 || !cur.actor) return;

                    const apCost = Math.max(0, Math.floor((skill as any).actionPoints ?? 0));
                    if (cur.actionPoints < apCost) {
                        state.log.unshift(`Pas assez de PA (coût: ${apCost}).`);
                        render();
                        return;
                    }

                    const cd = (cur.actor as any)?.getSkillCooldownRemaining?.(skill) ?? 0;
                    if (cd > 0) {
                        state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                        render();
                        return;
                    }

                    // Heal: sélectionne puis clic sur allié
                    if (isAllyHealSkill(skill)) {
                        selectedSkillKey = getSkillStableKey(skill);
                        state.log.unshift(`Compétence sélectionnée: ${skill.name} (cible un allié)`);
                        render();
                        return;
                    }

                    // Déplacement: sélectionne puis clic sur une case (ou allié puis case pour le lancer)
                    if ((skill as any).type === 'movement') {
                        selectedSkillKey = getSkillStableKey(skill);
                        const sid = String((skill as any).skillId ?? '');
                        if (sid === 'lancer_allie') {
                            state.log.unshift(`Compétence sélectionnée: ${skill.name} (1) clique un allié adjacent, (2) clique une case libre)`);
                        } else if (sid === 'lancer_ennemi') {
                            state.log.unshift(`Compétence sélectionnée: ${skill.name} (1) clique un ennemi adjacent, (2) clique une case libre)`);
                        } else {
                            state.log.unshift(`Compétence sélectionnée: ${skill.name} (clique une case cible)`);
                        }
                        render();
                        return;
                    }

                    // Self skills: cast immédiat
                    if (isSelfTargetingSkill(skill)) {
                        const sid = String((skill as any).skillId ?? '');

                        // Special-case: mana_groupe is a self-cast button, but affects the whole party.
                        if (sid === 'mana_groupe') {
                            cur.actionPoints -= apCost;
                            cur.actor.actionPoints = cur.actionPoints;

                            const manaCost = Math.max(0, Math.floor((skill as any).manaCost ?? 0));
                            if (cur.actor.currentMana < manaCost) {
                                cur.actionPoints += apCost;
                                cur.actor.actionPoints = cur.actionPoints;
                                state.log.unshift(`Pas assez de mana pour utiliser ${skill.name}.`);
                                render();
                                return;
                            }

                            cur.actor.currentMana -= manaCost;
                            cur.actor.startSkillCooldown?.(skill);

                            const allies = state.units.filter((u) => u.team === 'allies' && u.actor);
                            const perAllyLines: string[] = [];
                            for (const u of allies) {
                                const a: any = u.actor as any;
                                const before = Math.max(0, Math.floor(a.currentMana ?? 0));
                                const maxMana = Math.max(0, Math.floor(a.effectiveMaxMana ?? a.maxMana ?? 0));
                                a.currentMana = Math.min(maxMana, before + 20);
                                const gained = a.currentMana - before;
                                if (gained > 0) perAllyLines.push(`${u.name} +${gained} mana.`);
                            }

                            playSkillAudio(skill);
                            state.log.unshift(`${cur.actor.name} utilise ${skill.name} et régénère 20 mana pour tout le groupe.`);
                            for (const l of perAllyLines.slice(0, 4)) state.log.unshift(l);
                            syncFromActors();
                            render();
                            return;
                        }

                        cur.actionPoints -= apCost;
                        cur.actor.actionPoints = cur.actionPoints;

                        const beforePvSelf = Math.max(0, Math.floor(Number(cur.actor.pv ?? 0)));

                        const res = applyPlayerSkillTurn({ caster: cur.actor, target: cur.actor, skill, turn: 1 });
                        if (!res.ok) {
                            cur.actionPoints += apCost;
                            cur.actor.actionPoints = cur.actionPoints;
                            state.log.unshift(res.message);
                            render();
                            return;
                        }

                        const afterPvSelf = Math.max(0, Math.floor(Number(cur.actor.pv ?? 0)));
                        const deltaPvSelf = afterPvSelf - beforePvSelf;

                        playSkillAudio(skill);
                        state.log.unshift(res.message);
                        if (res.extraHistory?.length) {
                            for (const l of res.extraHistory.slice(0, 4)) state.log.unshift(l);
                        }
                        syncFromActors();
                        render();

                        // Flash effects for self-targeting results (after render)
                        if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
                            flashUnitAtPos(cur.pos, 'damage');
                            if (res.damageFlashOnTarget.reduced) flashUnitAtPos(cur.pos, 'reduced');
                            spawnFloatAtPos(cur.pos, 'damage', res.damageFlashOnTarget.actualDamage);
                        }
                        if (res.healFlashOnCaster) {
                            flashUnitAtPos(cur.pos, 'heal');
                            if (deltaPvSelf > 0) spawnFloatAtPos(cur.pos, 'heal', deltaPvSelf);
                        }

                        return;
                    }

                    // Enemy targeting: on sélectionne, puis clic sur ennemi
                    selectedSkillKey = getSkillStableKey(skill);
                    state.log.unshift(`Compétence sélectionnée: ${skill.name} (portée ${getSkillRange(skill)})`);
                    render();
                },
                {
                    buttonClass: 'btn skill-btn',
                    buttonStyle: 'margin:0;display:inline-flex;',
                    playerPA,
                    getCooldownRemaining: (s) => {
                        const cur = state.activeUnitId ? getUnitById(state, state.activeUnitId) : undefined;
                        return (cur?.actor as any)?.getSkillCooldownRemaining?.(s) ?? 0;
                    },
                }
            );

            // Render the remaining skills on the bottom-right.
            if (rightSkills.length) {
                renderSkillButtons(
                    skillsRightDiv,
                    rightSkills,
                    (skill: Skill) => {
                        const cur = state.activeUnitId ? getUnitById(state, state.activeUnitId) : undefined;
                        if (!cur || cur.team !== 'allies' || cur.pv <= 0 || !cur.actor) return;

                        const apCost = Math.max(0, Math.floor((skill as any).actionPoints ?? 0));
                        if (cur.actionPoints < apCost) {
                            state.log.unshift(`Pas assez de PA (coût: ${apCost}).`);
                            render();
                            return;
                        }

                        const cd = (cur.actor as any)?.getSkillCooldownRemaining?.(skill) ?? 0;
                        if (cd > 0) {
                            state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                            render();
                            return;
                        }

                        if (isAllyHealSkill(skill)) {
                            selectedSkillKey = getSkillStableKey(skill);
                            state.log.unshift(`Compétence sélectionnée: ${skill.name} (cible un allié)`);
                            render();
                            return;
                        }

                        if ((skill as any).type === 'movement') {
                            selectedSkillKey = getSkillStableKey(skill);
                            const sid = String((skill as any).skillId ?? '');
                            if (sid === 'lancer_allie') {
                                state.log.unshift(`Compétence sélectionnée: ${skill.name} (1) clique un allié adjacent, (2) clique une case libre)`);
                            } else if (sid === 'lancer_ennemi') {
                                state.log.unshift(`Compétence sélectionnée: ${skill.name} (1) clique un ennemi adjacent, (2) clique une case libre)`);
                            } else {
                                state.log.unshift(`Compétence sélectionnée: ${skill.name} (clique une case cible)`);
                            }
                            render();
                            return;
                        }

                        if (isSelfTargetingSkill(skill)) {
                            const sid = String((skill as any).skillId ?? '');

                            if (sid === 'mana_groupe') {
                                cur.actionPoints -= apCost;
                                cur.actor.actionPoints = cur.actionPoints;

                                const manaCost = Math.max(0, Math.floor((skill as any).manaCost ?? 0));
                                if (cur.actor.currentMana < manaCost) {
                                    cur.actionPoints += apCost;
                                    cur.actor.actionPoints = cur.actionPoints;
                                    state.log.unshift(`Pas assez de mana pour utiliser ${skill.name}.`);
                                    render();
                                    return;
                                }

                                cur.actor.currentMana -= manaCost;

                                const perAllyLines: string[] = [];
                                for (const u of state.units) {
                                    if (u.team !== 'allies' || u.pv <= 0) continue;
                                    const a: any = u.actor as any;
                                    if (!a) continue;
                                    const before = Math.max(0, Math.floor(Number(a.currentMana ?? 0)));
                                    const max = Math.max(0, Math.floor(Number(a.effectiveMaxMana ?? a.maxMana ?? 0)));
                                    const gained = Math.min(20, Math.max(0, max - before));
                                    a.currentMana = Math.min(max, before + 20);
                                    if (gained > 0) perAllyLines.push(`${u.name} +${gained} mana.`);
                                }

                                playSkillAudio(skill);
                                state.log.unshift(`${cur.actor.name} utilise ${skill.name} et régénère 20 mana pour tout le groupe.`);
                                for (const l of perAllyLines.slice(0, 4)) state.log.unshift(l);
                                syncFromActors();
                                render();
                                return;
                            }

                            cur.actionPoints -= apCost;
                            cur.actor.actionPoints = cur.actionPoints;

                            const beforePvSelf = Math.max(0, Math.floor(Number(cur.actor.pv ?? 0)));

                            const res = applyPlayerSkillTurn({ caster: cur.actor, target: cur.actor, skill, turn: 1 });
                            if (!res.ok) {
                                cur.actionPoints += apCost;
                                cur.actor.actionPoints = cur.actionPoints;
                                state.log.unshift(res.message);
                                render();
                                return;
                            }

                            const afterPvSelf = Math.max(0, Math.floor(Number(cur.actor.pv ?? 0)));
                            const deltaPvSelf = afterPvSelf - beforePvSelf;

                            playSkillAudio(skill);
                            state.log.unshift(res.message);
                            if (res.extraHistory?.length) {
                                for (const l of res.extraHistory.slice(0, 4)) state.log.unshift(l);
                            }
                            syncFromActors();
                            render();

                            if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
                                flashUnitAtPos(cur.pos, 'damage');
                                if (res.damageFlashOnTarget.reduced) flashUnitAtPos(cur.pos, 'reduced');
                                spawnFloatAtPos(cur.pos, 'damage', res.damageFlashOnTarget.actualDamage);
                            }
                            if (res.healFlashOnCaster) {
                                flashUnitAtPos(cur.pos, 'heal');
                                if (deltaPvSelf > 0) spawnFloatAtPos(cur.pos, 'heal', deltaPvSelf);
                            }

                            return;
                        }

                        selectedSkillKey = getSkillStableKey(skill);
                        state.log.unshift(`Compétence sélectionnée: ${skill.name} (portée ${getSkillRange(skill)})`);
                        render();
                    },
                    {
                        buttonClass: 'btn skill-btn',
                        buttonStyle: 'margin:0;display:inline-flex;',
                        playerPA,
                        getCooldownRemaining: (s) => {
                            const cur = state.activeUnitId ? getUnitById(state, state.activeUnitId) : undefined;
                            return (cur?.actor as any)?.getSkillCooldownRemaining?.(s) ?? 0;
                        },
                    }
                );
            } else {
                skillsRightDiv.innerHTML = '';
            }
        } else {
            // Clear bars if not active.
            const a = document.getElementById('tacticalSkillsLeft');
            const b = document.getElementById('tacticalSkillsRight');
            if (a) a.innerHTML = '';
            if (b) b.innerHTML = '';
        }

        // Mount Pixi overlay once the tactical DOM exists.
        try {
            mountPixiCanvas('tacticalPixiLayer');
        } catch (e) {
            console.error('[pixi] tactical mount failed', e);
        }

        const grid = document.getElementById('tacticalGrid');
        if (grid) {
            if (USE_ISO_VIEW && grid.classList.contains('iso')) {
                // Hover highlighting for the SVG grid overlay (always visible without occluding neighbors).
                grid.addEventListener('mousemove', (evt) => {
                    const t = (evt.target as HTMLElement | null)?.closest('.tile') as HTMLElement | null;
                    if (!t) return;
                    const x = Number(t.dataset.x);
                    const y = Number(t.dataset.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                    const key = `${x},${y}`;
                    const ds = (grid as any).dataset as any;
                    if (ds.isoHoverKey === key) return;
                    ds.isoHoverKey = key;
                    scheduleIsoLayout();
                });
                grid.addEventListener('mouseleave', () => {
                    const ds = (grid as any).dataset as any;

        // UX: when a skill is selected, right click anywhere cancels it.
        // Also, clicking outside the grid/skill buttons cancels it.
        {
            const wrap = document.querySelector('.tactical-wrap.tactical-combat') as HTMLElement | null;
            if (wrap) {
                wrap.addEventListener('contextmenu', (ev) => {
                    if (!selectedSkillKey) return;
                    ev.preventDefault();
                    deselectSkill();
                    render();
                });

                wrap.addEventListener('click', (ev) => {
                    if (!selectedSkillKey) return;
                    const t = ev.target as HTMLElement | null;
                    if (!t) return;
                    // Let grid clicks be handled by tactical input (it may cast or deselect on out-of-range).
                    if (t.closest('.tile') || t.closest('#tacticalGrid')) return;
                    // Clicking skill buttons should not cancel the selection.
                    if (t.closest('.skill-btn') || t.closest('#tacticalSkillsLeft') || t.closest('#tacticalSkillsRight')) return;

                    // Defer to end of the click so we don't interfere with other click handlers
                    // (ex: flee/back buttons that navigate away).
                    window.setTimeout(() => {
                        const stillInCombat = Boolean(document.querySelector('.tactical-wrap.tactical-combat'));
                        if (!stillInCombat) return;
                        if (!selectedSkillKey) return;
                        deselectSkill();
                        render();
                    }, 0);
                });
            }
        }
                    if (!ds.isoHoverKey) return;
                    ds.isoHoverKey = '';
                    scheduleIsoLayout();
                });
            }
            if (active && active.team === 'allies') {
                bindMovePreview(grid, { state, activeUnit: active, reachableSet, selectedSkillKey });
            }

            bindTacticalGridInput(grid, {
                getState: () => state,
                render,
                syncFromActors,
                getSelectedSkillKey: () => selectedSkillKey,
                setSelectedSkillKey: (key: string | null) => {
                    selectedSkillKey = key;
                },
                playSkillAudio,
                getSkillIconSrc,
                animator,
                onPostMove: (unitId: UnitId, dest: Pos) => {
                    const pw: PostWinState | undefined = (state as any).__postWin as any;
                    if (!pw || !pw.active) return;

                    // Demi-tour (comme Fuir)
                    if (dest.x === pw.retreatPos.x && dest.y === pw.retreatPos.y) {
                        state.log.unshift('Demi-tour: vous prenez la fuite.');
                        render();
                        // Give the UI a moment to show the log, then flee
                        setTimeout(() => leaveSkirmish(onFlee), 120);
                        return;
                    }

                    if (!pw.pointsVisible || pw.chosenKind) return;

                    const touched = (kind: Exclude<PostWinRewardKind, 'retreat'>) => {
                        pw.chosenKind = kind;
                        pw.pointsVisible = false;
                        pw.spawnInTurns = isDonjon ? 3 : null;
                        state.log.unshift('Les autres récompenses disparaissent…');
                        if (isDonjon) state.log.unshift('Monstres dans 3 tours…');
                    };

                    // Herbe (gauche)
                    if (dest.x === pw.herbPos.x && dest.y === pw.herbPos.y) {
                        const msg = applyHerbReward();
                        touched('herb');
                        syncFromActors();
                        try { showTemporaryMessage(msg, 4000); } catch (e) { /* noop */ }
                        render();
                        return;
                    }

                    // Bonus (haut)
                    if (dest.x === pw.buffPos.x && dest.y === pw.buffPos.y) {
                        const buffs: PostWinBuffKind[] = ['atk10', 'manaRegen4', 'maxMana10', 'dmgTakenMinus10'];
                        const chosen = buffs[Math.floor(Math.random() * buffs.length)]!;
                        pw.chosenBuff = chosen;
                        const msg = applyBuffReward(chosen);
                        touched('buff');
                        syncFromActors();
                        try { showTemporaryMessage(msg, 4000); } catch (e) { /* noop */ }
                        render();
                        return;
                    }

                    // Trésor (droite)
                    if (dest.x === pw.treasurePos.x && dest.y === pw.treasurePos.y) {
                        const opts: PostWinTreasureKind[] = ['wood1', 'goldX2', 'herb1'];
                        const chosen = opts[Math.floor(Math.random() * opts.length)]!;
                        pw.chosenTreasure = chosen;
                        const msg = applyTreasureReward(chosen, pw.baseXp, pw.baseGold);
                        touched('treasure');
                        syncFromActors();
                        try { showTemporaryMessage(msg, 4000); } catch (e) { /* noop */ }
                        render();
                        return;
                    }
                },
            });
        }

        // IA ennemie
        enemyAuto.runIfNeeded();

        // Play any pending unit effect flashes (DoT/HoT) that were recorded at startUnitTurn
        const lastEffect: any = (state as any).__lastUnitEffect;
        if (lastEffect && lastEffect.unitId) {
            console.debug('[lastUnitEffect] marker', lastEffect);
            const u = getUnitById(state, lastEffect.unitId);
            console.debug('[lastUnitEffect] resolved unit', u ? { id: u.id, pos: u.pos } : null);
            if (u) {
                if (lastEffect.kind === 'damage') flashUnitAtPos(u.pos, 'damage');
                else if (lastEffect.kind === 'heal') flashUnitAtPos(u.pos, 'heal');

                const amt = Math.max(0, Math.floor(Number(lastEffect.amount ?? 0)));
                if (amt > 0 && (lastEffect.kind === 'damage' || lastEffect.kind === 'heal')) {
                    spawnFloatAtPos(u.pos, lastEffect.kind, amt);
                }
            }
            (state as any).__lastUnitEffect = undefined;
        }
    };

    renderRef = render;
    render();

    // Listen for temporary-sprite changes so the UI updates immediately when set/cleared
    const onTempSpriteChanged = () => { renderRef?.(); };
    window.addEventListener('tempSpriteChanged', onTempSpriteChanged);

    // Play start-of-combat sound for the tactical plateau
    const am = (window as any).game?.audioManager;
    if (am) am.play('cestparti_olaf');
}
