import {
    findShortestPath,
    getUnitAt,
    getUnitById,
    type Pos,
    type TacticalState,
    type UnitId,
} from '../tacticalBoard.js';
import { createSpellAnimator } from './spellAnimations.web.js';
import {
    getIdleSpriteSrc,
    getMoveDir,
    getWalkAnimMinDurationMs,
    getWalkCycle,
    startWalkSpriteAnimation,
    type MoveDir,
} from '../characterSprites.web.js';

export function createTacticalAnimator(deps: {
    getState: () => TacticalState;
    render: () => void;
}): {
    animateImpact: (at: Pos, imgSrc: string) => Promise<void>;
    animateProjectile: (from: Pos, to: Pos, imgSrc: string) => Promise<void>;
    animateSpellAt: (
        at: Pos,
        imgSrc: string,
        options?: { duration?: number; scale?: number; zIndex?: number; offsetX?: number; offsetY?: number }
    ) => Promise<void>;
    animateSpellOnUnit: (
        unitId: UnitId,
        imgSrc: string,
        options?: { duration?: number; scale?: number; zIndex?: number; offsetX?: number; offsetY?: number }
    ) => Promise<void>;
    preloadSpellGif: (src: string) => Promise<void>;
    animateMoveTo: (unitId: UnitId, dest: Pos) => Promise<boolean>;
    animateMoveFree: (unitId: UnitId, dest: Pos) => Promise<boolean>;
    isAnimatingMove: () => boolean;
} {
    const { getState, render } = deps;  
    const spellAnimator = createSpellAnimator({ getState, render });

    let isAnimatingMove = false;

    // Base step duration. We further scale it dynamically based on pixel distance per step.
    const MOVE_STEP_MS = 220;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    type PixiMoveDetail = {
        unitId: string;
        x: number;
        y: number;
        tileW: number;
        tileH: number;
        characterClass: string;
        dir: MoveDir;
        frameIndex: number;
        phase: 'tick' | 'end';
    };

    const emitPixiMove = (detail: PixiMoveDetail): void => {
        try {
            window.dispatchEvent(new CustomEvent<PixiMoveDetail>('tacticalPixiMove', { detail }));
        } catch {
            // noop
        }
    };

    const startPixiMoveEmitter = (args: {
        unitId: UnitId;
        gridEl: HTMLElement;
        tileW: number;
        tileH: number;
        characterClass: string;
    }): (() => void) => {
        const { unitId, gridEl, tileW, tileH, characterClass } = args;

        // Only useful when Pixi units mode is enabled.
        if (!gridEl.classList.contains('pixi-units')) return () => {};

        let raf = 0;
        let stopped = false;
        let seg:
            | {
                    aLeft: number;
                    aTop: number;
                    bLeft: number;
                    bTop: number;
                    ms: number;
                    dir: MoveDir;
                    startedAt: number;
                    frameMs: number;
                    cycleLen: number;
              }
            | null = null;

        const computeCycleInfo = (dir: MoveDir): { frameMs: number; cycleLen: number } => {
            const walk = getWalkCycle(characterClass, dir);
            if (!walk) return { frameMs: 1000000, cycleLen: 1 };
            return { frameMs: Math.max(60, Math.floor(walk.frameMs)), cycleLen: Math.max(1, walk.cycle.length) };
        };

        const tick = (now: number) => {
            if (stopped) return;
            if (!seg) {
                raf = requestAnimationFrame(tick);
                return;
            }
            const elapsed = Math.max(0, now - seg.startedAt);
            const t = seg.ms > 0 ? Math.min(1, elapsed / seg.ms) : 1;
            const left = seg.aLeft + (seg.bLeft - seg.aLeft) * t;
            const top = seg.aTop + (seg.bTop - seg.aTop) * t;
            const cx = left + tileW / 2;
            const cy = top + tileH / 2;
            if (Number.isFinite(cx) && Number.isFinite(cy)) {
                const frameIndex = seg.cycleLen > 1 ? Math.floor(elapsed / seg.frameMs) % seg.cycleLen : 0;
                emitPixiMove({
                    unitId: String(unitId),
                    x: cx,
                    y: cy,
                    tileW,
                    tileH,
                    characterClass,
                    dir: seg.dir,
                    frameIndex,
                    phase: 'tick',
                });
            }
            raf = requestAnimationFrame(tick);
        };

        raf = requestAnimationFrame(tick);

        const setSegment = (s: { aLeft: number; aTop: number; bLeft: number; bTop: number; ms: number; dir: MoveDir }) => {
            const info = computeCycleInfo(s.dir);
            seg = {
                ...s,
                startedAt: performance.now(),
                frameMs: info.frameMs,
                cycleLen: info.cycleLen,
            };
        };

        const stop = () => {
            if (stopped) return;
            stopped = true;
            try {
                if (raf) cancelAnimationFrame(raf);
            } catch {
                // noop
            }
            emitPixiMove({
                unitId: String(unitId),
                x: 0,
                y: 0,
                tileW,
                tileH,
                characterClass,
                dir: 'none',
                frameIndex: 0,
                phase: 'end',
            });
        };

        // Expose setters via closure property (kept minimal to avoid changing public API).
        (stop as any).setSegment = setSegment;
        return stop;
    };

    const animateImpact = async (at: Pos, imgSrc: string): Promise<void> => {
        const gridEl = document.getElementById('tacticalGrid') as HTMLElement | null;
        const boardPanel = document.querySelector('.tactical-board-panel') as HTMLElement | null;
        if (!gridEl || !boardPanel) return;

        const tile = gridEl.querySelector(`.tile[data-x="${at.x}"][data-y="${at.y}"]`) as HTMLElement | null;
        if (!tile) return;

        const tileRect = tile.getBoundingClientRect();
        const panelRect = boardPanel.getBoundingClientRect();
        const cx = tileRect.left + tileRect.width / 2 - panelRect.left;
        const cy = tileRect.top + tileRect.height / 2 - panelRect.top;

        const img = document.createElement('img');
        img.className = 'tactical-impact';
        img.src = imgSrc;
        img.alt = '';
        img.style.left = `${cx}px`;
        img.style.top = `${cy}px`;

        boardPanel.appendChild(img);

        const anim = img.animate(
            [
                { transform: 'translate(-50%, -50%) scale(0.65)', opacity: 0.95 },
                { transform: 'translate(-50%, -50%) scale(1.25)', opacity: 0.55, offset: 0.45 },
                { transform: 'translate(-50%, -50%) scale(1.65)', opacity: 0 },
            ],
            { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }
        );

        try {
            await anim.finished;
        } catch {
            // ignored
        } finally {
            img.remove();
        }
    };

    const animateProjectile = async (from: Pos, to: Pos, imgSrc: string): Promise<void> => {
        const gridEl = document.getElementById('tacticalGrid') as HTMLElement | null;
        const boardPanel = document.querySelector('.tactical-board-panel') as HTMLElement | null;
        if (!gridEl || !boardPanel) return;

        const fromTile = gridEl.querySelector(`.tile[data-x="${from.x}"][data-y="${from.y}"]`) as HTMLElement | null;
        const toTile = gridEl.querySelector(`.tile[data-x="${to.x}"][data-y="${to.y}"]`) as HTMLElement | null;
        if (!fromTile || !toTile) return;

        const fromRect = fromTile.getBoundingClientRect();
        const toRect = toTile.getBoundingClientRect();
        const panelRect = boardPanel.getBoundingClientRect();

        const startX = fromRect.left + fromRect.width / 2 - panelRect.left;
        const startY = fromRect.top + fromRect.height / 2 - panelRect.top;
        const endX = toRect.left + toRect.width / 2 - panelRect.left;
        const endY = toRect.top + toRect.height / 2 - panelRect.top;

        const dx = endX - startX;
        const dy = endY - startY;

        const img = document.createElement('img');
        img.className = 'tactical-projectile';
        img.src = imgSrc;
        img.alt = '';
        img.style.left = `${startX}px`;
        img.style.top = `${startY}px`;

        boardPanel.appendChild(img);

        // Translate from start to end while spinning a bit.
        const anim = img.animate(
            [
                { transform: 'translate(-50%, -50%) scale(0.95) rotate(0deg)', opacity: 1 },
                {
                    transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.08) rotate(720deg)`,
                    opacity: 1,
                },
            ],
            { duration: 420, easing: 'cubic-bezier(0.2, 0.85, 0.2, 1)', fill: 'forwards' }
        );

        try {
            await anim.finished;
        } catch {
            // ignored
        } finally {
            img.remove();
        }

        // Petit impact/explosion au point d'arrivée
        await animateImpact(to, imgSrc);
    };

    const animateMoveTo = async (unitId: UnitId, dest: Pos): Promise<boolean> => {
        if (isAnimatingMove) return false;

        const state = getState();
        const unit = getUnitById(state, unitId);
        if (!unit || unit.pv <= 0) return false;
        if (getUnitAt(state, dest)) return false;

        const freeMove = Boolean((state as any)?.__postWin?.active);

        // Déplacement = coût en PA (1 case = 1 PA).
        // Coût réel = longueur du plus court chemin (évite les soucis avec obstacles).
        const path = findShortestPath(state, unitId, dest);
        if (!path) {
            state.log.unshift('Chemin bloqué.');
            render();
            return false;
        }

        const pathLen = Math.max(0, Math.floor(path.length));
        if (pathLen <= 0) return false;

        // Sur le plateau de récompenses (post-win), le déplacement ne coûte pas de PA.
        const apCost = freeMove ? 0 : pathLen;
        if (!freeMove && apCost > unit.actionPoints) {
            state.log.unshift(`Pas assez de PA pour se déplacer (coût: ${apCost}).`);
            render();
            return false;
        }

        const steps = path.length ? path : [dest];

        const firstStep = steps[0] ?? dest;
        const dir = getMoveDir(unit.pos, firstStep);
        const characterClass = String((unit.actor as any)?.characterClass ?? '').toLowerCase();

        const gridEl = document.getElementById('tacticalGrid') as HTMLElement | null;
        if (!gridEl) {
            // Fallback: pas de DOM => déplacement instant
            unit.pos = { x: dest.x, y: dest.y };
            unit.actionPoints = Math.max(0, unit.actionPoints - apCost);
            if (unit.actor) unit.actor.actionPoints = unit.actionPoints;
            render();
            return true;
        }

        const from = unit.pos;
        const fromTile = gridEl.querySelector(`.tile[data-x="${from.x}"][data-y="${from.y}"]`) as HTMLElement | null;
        if (!fromTile) {
            unit.pos = { x: dest.x, y: dest.y };
            unit.actionPoints = Math.max(0, unit.actionPoints - apCost);
            if (unit.actor) unit.actor.actionPoints = unit.actionPoints;
            render();
            return true;
        }

        const pixiUnitsMode = gridEl.classList.contains('pixi-units');

        const unitEl = pixiUnitsMode
            ? null
            : (fromTile.querySelector('.unit-badge, .unit-sprite-wrap, .unit-sprite')?.closest('div') as HTMLElement | null);
        const fromRect = fromTile.getBoundingClientRect();
        const gridRect = gridEl.getBoundingClientRect();

        const tilePosPx = (p: Pos): { left: number; top: number } | null => {
            const t = gridEl.querySelector(`.tile[data-x="${p.x}"][data-y="${p.y}"]`) as HTMLElement | null;
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { left: r.left - gridRect.left, top: r.top - gridRect.top };
        };

        const startPx = tilePosPx(from);
        if (!startPx) {
            unit.pos = { x: dest.x, y: dest.y };
            unit.actionPoints = Math.max(0, unit.actionPoints - apCost);
            if (unit.actor) unit.actor.actionPoints = unit.actionPoints;
            render();
            return true;
        }

        const pxPerMs = 0.32; // ~70px / 220ms baseline

        const stopPixiEmitter: any = startPixiMoveEmitter({
            unitId,
            gridEl,
            tileW: fromRect.width,
            tileH: fromRect.height,
            characterClass,
        });

        const setIdle = () => {
            // DOM-only helper; in Pixi units mode we don't animate a DOM ghost.
            const idle = getIdleSpriteSrc(characterClass);
            if (!idle) return;
        };

        let activeDir = 'none' as ReturnType<typeof getMoveDir>;
        let activeAnim: { stop: () => void } | null = null;

        try {
            isAnimatingMove = true;

            // Animate segment-by-segment so direction-based sprite animation can change mid-path.
            // This ensures any up-right step triggers the warrior walk frames, even if the path turns.
            const points: Pos[] = [from, ...steps];

            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1]!;
                const b = points[i]!;

                const aPx = tilePosPx(a);
                const bPx = tilePosPx(b);
                if (!aPx || !bPx) continue;

                const segDx = bPx.left - aPx.left;
                const segDy = bPx.top - aPx.top;
                const segDistPx = Math.max(1, Math.hypot(segDx, segDy));
                let segMs = Math.max(80, Math.floor(segDistPx / pxPerMs));

                const segDir = getMoveDir(a, b);
                const segMinWalkMs = getWalkAnimMinDurationMs(characterClass, segDir);
                if (segMinWalkMs > 0) segMs = Math.max(segMs, segMinWalkMs);

                // Keep a single animator running while direction stays the same.
                // This is required so the 3-frame loop (walk1 -> walk2 -> static) is visible.
                if (segDir !== activeDir) {
                    activeAnim?.stop();
                    activeAnim = null;
                    activeDir = segDir;

                    if (!pixiUnitsMode && segMinWalkMs > 0) {
                        // DOM-only movement animation (pre-Pixi mode)
                        // ghost is created only in non-pixiUnitsMode below.
                    } else {
                        setIdle();
                    }
                }

                try {
                    if (typeof stopPixiEmitter?.setSegment === 'function') {
                        stopPixiEmitter.setSegment({
                            aLeft: aPx.left,
                            aTop: aPx.top,
                            bLeft: bPx.left,
                            bTop: bPx.top,
                            ms: segMs,
                            dir: segDir,
                        });
                    }
                } catch {
                    // noop
                }

                if (pixiUnitsMode) {
                    await sleep(segMs);
                } else {
                    // Legacy DOM ghost path (kept for non-pixi units mode)
                    const ghost = document.createElement('div');
                    ghost.className = 'tactical-move-ghost';
                    ghost.style.width = `${fromRect.width}px`;
                    ghost.style.height = `${fromRect.height}px`;
                    ghost.style.transform = `translate(${aPx.left}px, ${aPx.top}px)`;
                    if (unitEl) {
                        const clone = unitEl.cloneNode(true) as HTMLElement;
                        clone.style.width = '100%';
                        clone.style.height = '100%';
                        ghost.appendChild(clone);
                        unitEl.style.opacity = '0';
                    }
                    gridEl.appendChild(ghost);

                    const segMinWalk = getWalkAnimMinDurationMs(characterClass, segDir);
                    if (segMinWalk > 0) {
                        activeAnim?.stop();
                        activeAnim = startWalkSpriteAnimation({ container: ghost, characterClass, dir: segDir });
                    }

                    await sleep(0);
                    const anim = ghost.animate(
                        [{ transform: `translate(${aPx.left}px, ${aPx.top}px)` }, { transform: `translate(${bPx.left}px, ${bPx.top}px)` }],
                        { duration: segMs, easing: 'linear', fill: 'forwards' }
                    );
                    // @ts-ignore: finished existe sur Animation en navigateur
                    await (anim.finished ?? new Promise<void>((resolve) => anim.addEventListener('finish', () => resolve())));
                    ghost.remove();
                }

            }
            setIdle();

            unit.pos = { x: dest.x, y: dest.y };
            unit.actionPoints = Math.max(0, unit.actionPoints - apCost);
            if (unit.actor) unit.actor.actionPoints = unit.actionPoints;
            render();
            return true;
        } finally {
            activeAnim?.stop();
            setIdle();
            stopPixiEmitter();
            if (unitEl) unitEl.style.opacity = '';
            isAnimatingMove = false;
        }
    };

    const animateMoveFree = async (unitId: UnitId, dest: Pos): Promise<boolean> => {
        if (isAnimatingMove) return false;

        const state = getState();
        const unit = getUnitById(state, unitId);
        if (!unit || unit.pv <= 0) return false;
        if (getUnitAt(state, dest)) return false;

        const gridEl = document.getElementById('tacticalGrid') as HTMLElement | null;
        if (!gridEl) {
            unit.pos = { x: dest.x, y: dest.y };
            render();
            return true;
        }

        const from = unit.pos;
        const fromTile = gridEl.querySelector(`.tile[data-x="${from.x}"][data-y="${from.y}"]`) as HTMLElement | null;
        const toTile = gridEl.querySelector(`.tile[data-x="${dest.x}"][data-y="${dest.y}"]`) as HTMLElement | null;
        if (!fromTile || !toTile) {
            unit.pos = { x: dest.x, y: dest.y };
            render();
            return true;
        }

        const unitEl = fromTile.querySelector('.unit-badge, .unit-sprite-wrap, .unit-sprite')?.closest('div') as HTMLElement | null;
        const fromRect = fromTile.getBoundingClientRect();
        const gridRect = gridEl.getBoundingClientRect();

        const pixiUnitsMode = gridEl.classList.contains('pixi-units');

        const tilePosPx = (p: Pos): { left: number; top: number } | null => {
            const t = gridEl.querySelector(`.tile[data-x="${p.x}"][data-y="${p.y}"]`) as HTMLElement | null;
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { left: r.left - gridRect.left, top: r.top - gridRect.top };
        };

        const startPx = tilePosPx(from);
        const endPx = tilePosPx(dest);
        if (!startPx || !endPx) {
            unit.pos = { x: dest.x, y: dest.y };
            render();
            return true;
        }

        // Pixi-only movement: no DOM ghost.
        // Legacy path still uses a DOM ghost in non-pixiUnitsMode.

        const dir = getMoveDir(from, dest);
        const characterClass = String((unit.actor as any)?.characterClass ?? '').toLowerCase();

        // Keep consistent speed across different board scales by basing duration on pixel distance.
        const dxPx = endPx.left - startPx.left;
        const dyPx = endPx.top - startPx.top;
        const distPx = Math.max(1, Math.hypot(dxPx, dyPx));
        const pxPerMs = 0.32; // ~70px / 220ms baseline
        let durationMs = Math.max(120, Math.floor(distPx / pxPerMs));

        const minWalkMs = getWalkAnimMinDurationMs(characterClass, dir);
        if (minWalkMs > 0) durationMs = Math.max(durationMs, minWalkMs);

        const walkAnim = pixiUnitsMode ? { stop: () => void 0 } : { stop: () => void 0 };

        isAnimatingMove = true;
        if (!pixiUnitsMode) {
            const ghost = document.createElement('div');
            ghost.className = 'tactical-move-ghost';
            ghost.style.width = `${fromRect.width}px`;
            ghost.style.height = `${fromRect.height}px`;
            ghost.style.transform = `translate(${startPx.left}px, ${startPx.top}px)`;
            if (unitEl) {
                const clone = unitEl.cloneNode(true) as HTMLElement;
                clone.style.width = '100%';
                clone.style.height = '100%';
                ghost.appendChild(clone);
                unitEl.style.opacity = '0';
            }
            gridEl.appendChild(ghost);
            try {
                const wa = startWalkSpriteAnimation({ container: ghost, characterClass, dir });
                (walkAnim as any).stop = wa.stop;
            } catch {
                // noop
            }
            // store for cleanup
            (walkAnim as any).__ghost = ghost;
        }

        const stopPixiEmitter: any = startPixiMoveEmitter({
            unitId,
            gridEl,
            tileW: fromRect.width,
            tileH: fromRect.height,
            characterClass,
        });

        try {
            if (typeof stopPixiEmitter?.setSegment === 'function') {
                stopPixiEmitter.setSegment({
                    aLeft: startPx.left,
                    aTop: startPx.top,
                    bLeft: endPx.left,
                    bTop: endPx.top,
                    ms: durationMs,
                    dir,
                });
            }
        } catch {
            // noop
        }

        try {
            if (pixiUnitsMode) {
                await sleep(durationMs);
            } else {
                const ghost = (walkAnim as any).__ghost as HTMLElement | undefined;
                if (ghost) {
                    await sleep(0);
                    const anim = ghost.animate(
                        [{ transform: `translate(${startPx.left}px, ${startPx.top}px)` }, { transform: `translate(${endPx.left}px, ${endPx.top}px)` }],
                        { duration: durationMs, easing: 'linear', fill: 'forwards' }
                    );
                    // @ts-ignore: finished existe sur Animation en navigateur
                    await (anim.finished ?? new Promise<void>((resolve) => anim.addEventListener('finish', () => resolve())));
                }
            }

            unit.pos = { x: dest.x, y: dest.y };
            render();
            return true;
        } finally {
            walkAnim.stop();
            stopPixiEmitter();
            const ghost = (walkAnim as any).__ghost as HTMLElement | undefined;
            if (ghost) ghost.remove();
            if (unitEl) unitEl.style.opacity = '';
            isAnimatingMove = false;
        }
    };

    return {
        animateImpact,
        animateProjectile,
        animateSpellAt: spellAnimator.playSpellAt,
        animateSpellOnUnit: spellAnimator.playSpellOnUnit,
        preloadSpellGif: spellAnimator.preloadGif,
        animateMoveTo,
        animateMoveFree,
        isAnimatingMove: () => isAnimatingMove,
    };
}
