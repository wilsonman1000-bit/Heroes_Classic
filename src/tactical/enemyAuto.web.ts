import { aiAct } from './ai.web.js';
import { advanceTurn, getTeamAliveCount, getUnitById, type TacticalState, type UnitId, type Pos } from '../tacticalBoard.js';

export function createEnemyAutoRunner(deps: {
    getState: () => TacticalState;
    render: () => void;
    moveAnimated: (unitId: UnitId, dest: Pos) => Promise<boolean>;
    moveAnimatedFree?: (unitId: UnitId, dest: Pos) => Promise<boolean>;
}): {
    runIfNeeded: () => void;
    reset: () => void;
} {
    const { getState, render, moveAnimated, moveAnimatedFree } = deps;

    let autoRunning = false;
    let runToken = 0;

    const ENEMY_THINK_DELAY_MS = 500;
    const ENEMY_BETWEEN_ACTIONS_MS = 1000;
    const ENEMY_END_TURN_DELAY_MS = 750;

    const stop = () => {
        autoRunning = false;
        runToken++;
    };

    const runIfNeeded = () => {
        if (autoRunning) return;

        const state = getState();

        // New turn mode: only run AI when it's enemies' phase.
        if ((state as any).turnMode === 'pick-alternate') {
            const sideToAct = ((state as any).sideToAct ?? 'allies') as any;
            if (sideToAct !== 'enemies') return;
        }

        // Anti soft-lock: si l'unité active est KO (ex: DoT au début de tour), on saute.
        {
            let safety = 0;
            while (safety < 16) {
                safety++;
                if (!state.activeUnitId) break;
                const cur = getUnitById(state, state.activeUnitId);
                if (!cur || cur.pv > 0) break;
                const msgs = advanceTurn(state);
                for (const m of msgs.slice(0, 2)) state.log.unshift(m);
            }
        }

        const alliesAlive = getTeamAliveCount(state, 'allies');
        const enemiesAlive = getTeamAliveCount(state, 'enemies');
        if (alliesAlive === 0 || enemiesAlive === 0) return;

        if (!state.activeUnitId) return;
        const a = getUnitById(state, state.activeUnitId);
        if (!a || a.pv <= 0) return;
        if (a.team !== 'enemies') return;

        autoRunning = true;
        const token = ++runToken;

        let safety = 0;
        const step = () => {
            if (token !== runToken) return;

            const s = getState();

            // Stop conditions
            if (getTeamAliveCount(s, 'allies') === 0 || getTeamAliveCount(s, 'enemies') === 0) {
                stop();
                render();
                return;
            }

            if (!s.activeUnitId) {
                stop();
                render();
                return;
            }
            const cur = getUnitById(s, s.activeUnitId);
            if (!cur) {
                stop();
                render();
                return;
            }
            if (cur.pv <= 0) {
                const msgs = advanceTurn(s);
                for (const m of msgs.slice(0, 2)) s.log.unshift(m);
                render();
                setTimeout(step, 120);
                return;
            }
            if (cur.team === 'allies') {
                stop();
                render();
                return;
            }

            safety++;
            if (safety > 256) {
                stop();
                s.log.unshift('IA: sécurité déclenchée (boucle interrompue).');
                render();
                return;
            }

            // Tour ennemi: temps de lecture (gobelin surligné), puis action, puis attente, puis fin de tour.
            render();
            setTimeout(async () => {
                if (token !== runToken) return;

                const s2 = getState();
                if (!s2.activeUnitId) {
                    stop();
                    render();
                    return;
                }
                const cur2 = getUnitById(s2, s2.activeUnitId);
                if (!cur2) {
                    stop();
                    render();
                    return;
                }
                if (cur2.pv <= 0) {
                    const msgs = advanceTurn(s2);
                    for (const m of msgs.slice(0, 2)) s2.log.unshift(m);
                    render();
                    setTimeout(step, 120);
                    return;
                }
                if (cur2.team === 'allies') {
                    stop();
                    render();
                    return;
                }

                try {
                    const aiHooks = moveAnimatedFree
                        ? {
                              moveAnimated,
                              moveAnimatedFree,
                              onAfterAction: render,
                              betweenActionsMs: ENEMY_BETWEEN_ACTIONS_MS,
                          }
                        : {
                              moveAnimated,
                              onAfterAction: render,
                              betweenActionsMs: ENEMY_BETWEEN_ACTIONS_MS,
                          };
                    await aiAct(s2, aiHooks);
                } catch (e) {
                    console.error('[enemyAuto] aiAct error', e);
                    s2.log.unshift('IA: une erreur est survenue, le tour continue.');
                } finally {
                    render();
                }

                // Attente post-action avant de finir le tour.
                setTimeout(() => {
                    if (token !== runToken) return;

                    const s3 = getState();
                    if (!s3.activeUnitId) {
                        stop();
                        render();
                        return;
                    }
                    const still = getUnitById(s3, s3.activeUnitId);
                    if (!still) {
                        stop();
                        render();
                        return;
                    }
                    if (still.pv <= 0) {
                        const msgs = advanceTurn(s3);
                        for (const m of msgs.slice(0, 2)) s3.log.unshift(m);
                        render();
                        setTimeout(step, 120);
                        return;
                    }
                    if (still.team === 'allies') {
                        stop();
                        render();
                        return;
                    }

                    const msgs = advanceTurn(s3);
                    for (const m of msgs.slice(0, 2)) s3.log.unshift(m);
                    render();

                    // In pick-alternate, we normally stop once control returns to allies.
                    // But if allies have no remaining units to act, advanceTurn can chain enemies;
                    // in that case we must continue or the game can soft-lock on an enemy turn.
                    if ((s3 as any).turnMode === 'pick-alternate') {
                        const sideToAct = (((s3 as any).sideToAct ?? 'allies') as any);
                        if (sideToAct !== 'enemies') {
                            stop();
                            return;
                        }
                    }

                    setTimeout(step, 0);
                }, ENEMY_END_TURN_DELAY_MS);
            }, ENEMY_THINK_DELAY_MS);
        };

        // Démarre après un paint.
        setTimeout(step, ENEMY_THINK_DELAY_MS);
    };

    return {
        runIfNeeded,
        reset: stop,
    };
}
