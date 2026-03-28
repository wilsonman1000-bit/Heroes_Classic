import { applyPlayerSkillTurn } from '../battleTurn.web.js';
import type { Skill } from '../skill.js';
import { getSkillRange, isAllyHealSkill, isEnemyTargetingSkill, isSelfTargetingSkill, isWithinSkillRangeDirectional } from './targeting.js';
import { advanceTurn, getUnitAt, getUnitById, inBounds, startUnitTurn, type Pos, type TacticalState, type UnitId } from '../tacticalBoard.js';
import {
    PASSIVE_CHARGE_DAMAGE_BOOST_NODE_ID,
    PASSIVE_CHARGE_STUN_TRAVERSED_NODE_ID,
    hasLearnedTalentPassiveNode,
} from '../talents/talentPassives.js';

export type TacticalGridInputDeps = {
    getState: () => TacticalState;
    render: () => void;
    syncFromActors: () => void;

    getSelectedSkillKey: () => string | null;
    setSelectedSkillKey: (key: string | null) => void;

    playSkillAudio: (skill: Skill) => void;
    getSkillIconSrc: (skill: Skill) => string;

    // Called after a successful normal move (not a skill). Useful for post-combat destination triggers.
    onPostMove?: (unitId: UnitId, dest: Pos) => void;

    animator: {
        isAnimatingMove: () => boolean;
        animateMoveTo: (unitId: UnitId, dest: Pos) => Promise<boolean>;
        animateMoveFree: (unitId: UnitId, dest: Pos) => Promise<boolean>;
        animateProjectile: (from: Pos, to: Pos, imgSrc: string) => Promise<void>;
        animateImpact: (at: Pos, imgSrc: string) => Promise<void>;
        animateSpellAt: (
            at: Pos,
            imgSrc: string,
            options?: { duration?: number; scale?: number; zIndex?: number; offsetX?: number; offsetY?: number }
        ) => Promise<void>;
        preloadSpellGif: (src: string) => Promise<void>;
    };
};

export function bindTacticalGridInput(grid: HTMLElement, deps: TacticalGridInputDeps): void {
    // Small per-grid handler state. This handler is re-created each render (new grid element),
    // so we store pending throw state on the TacticalState object.
    const getThrowState = (): { grabbedAllyId: UnitId | null; grabbedEnemyId: UnitId | null } => {
        const s: any = deps.getState() as any;
        s.__tacticalInput = s.__tacticalInput ?? { grabbedAllyId: null, grabbedEnemyId: null };
        if (!('grabbedEnemyId' in s.__tacticalInput)) s.__tacticalInput.grabbedEnemyId = null;
        return s.__tacticalInput;
    };

    const flashUnitAt = (pos: Pos, kind: 'damage' | 'heal' | 'reduced') => {
        try {
            const tile = document.querySelector(`.tactical-grid .tile[data-x="${pos.x}"][data-y="${pos.y}"]`) as HTMLElement | null;
            if (!tile) return;
            const sprite = tile.querySelector('.unit-sprite') as HTMLElement | null;
            const hpBar = tile.querySelector('.unit-sprite-bar.hp') as HTMLElement | null;
            if (kind === 'damage') {
                if (sprite) {
                    sprite.classList.add('flash-damage');
                    setTimeout(() => sprite.classList.remove('flash-damage'), 600);
                }
                if (hpBar) {
                    hpBar.classList.add('flash-damage');
                    setTimeout(() => hpBar.classList.remove('flash-damage'), 600);
                }
            } else if (kind === 'heal') {
                if (sprite) {
                    sprite.classList.add('flash-heal');
                    setTimeout(() => sprite.classList.remove('flash-heal'), 360);
                }
                if (hpBar) {
                    hpBar.classList.add('flash-heal');
                    setTimeout(() => hpBar.classList.remove('flash-heal'), 360);
                }
            } else if (kind === 'reduced') {
                if (hpBar) {
                    hpBar.classList.add('flash-reduced');
                    setTimeout(() => hpBar.classList.remove('flash-reduced'), 360);
                }
            }
        } catch (e) {
            // ignore DOM errors
        }
    };

    const spawnFloatAt = (pos: Pos, kind: 'damage' | 'heal', amount: number) => {
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

                    const jitterX = Math.max(-10, Math.min(10, Math.random() * 18 - 9));
                    const jitterY = Math.max(-8, Math.min(8, Math.random() * 14 - 7));
                    el.style.left = `${kind === 'damage' ? 78 : 30}%`;
                    el.style.top = `${kind === 'damage' ? 12 : 18}%`;
                    el.style.marginLeft = `${Math.round(jitterX)}px`;
                    el.style.marginTop = `${Math.round(jitterY)}px`;

                    tile.appendChild(el);
                    setTimeout(() => {
                        try { el.remove(); } catch { /* noop */ }
                    }, 2400);
                } catch {
                    // ignore DOM errors
                }
            }, delay);
        };

        attempt(0);
    };


    grid.addEventListener('click', (evt) => {
        const state = deps.getState();

        const isRooted = (actor: any): boolean => {
            const fx = Array.isArray(actor?.activeEffects) ? (actor.activeEffects as any[]) : [];
            return fx.some((ef) => String(ef?.type ?? '') === 'root' && Number(ef?.remainingTurns ?? 0) !== 0);
        };
        const targetEl = (evt.target as HTMLElement | null)?.closest('.tile') as HTMLElement | null;
        if (!targetEl) return;

        const x = Number(targetEl.dataset.x);
        const y = Number(targetEl.dataset.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        const clickedPos: Pos = { x, y };
        const clickedUnit = getUnitAt(state, clickedPos);

        // Phase de placement (début du tout premier combat plateau):
        // - Guerrier (ally-1) sélectionné automatiquement
        // - le joueur place successivement ally-1 puis ally-2 puis ally-3
        // - ensuite le combat commence, avec le tour du guerrier.
        const deploy: any = (state as any).__deployment;
        if (deploy?.active) {
            const order: string[] = Array.isArray(deploy.order) && deploy.order.length ? deploy.order : ['ally-1', 'ally-2', 'ally-3'];
            const step = Math.max(0, Math.floor(Number(deploy.step ?? 0)));
            const unitId = order[Math.min(step, order.length - 1)] ?? 'ally-1';
            const u = getUnitById(state, unitId as any);

            if (!u || u.pv <= 0) {
                // Fallback: désactive le déploiement si l'unité n'existe pas
                deploy.active = false;
                deps.render();
                return;
            }

            // Zone de placement: par défaut les 2 dernières lignes.
            const minY = Math.max(0, Math.floor(Number(deploy.minY ?? (state.height - 4))));
            if (!inBounds(state, clickedPos)) return;
            if (clickedPos.y < minY) {
                state.log.unshift('Place tes héros sur les cases du bas.');
                deps.render();
                return;
            }
            if (clickedUnit) {
                state.log.unshift('Case occupée.');
                deps.render();
                return;
            }

            u.pos = clickedPos;
            state.activeUnitId = u.id;
            state.log.unshift(`${u.name} placé.`);

            const nextStep = step + 1;
            deploy.step = nextStep;
            if (nextStep < order.length) {
                const nextId = order[nextStep]!;
                state.activeUnitId = nextId;
                const nextU = getUnitById(state, nextId as any);
                state.log.unshift(`Place ${nextU?.name ?? nextId}.`);
                deps.render();
                return;
            }

            // Placement terminé.
            deploy.active = false;

            // New canonical behavior: in speed/initiative mode, start automatically.
            if ((state as any).turnMode !== 'pick-alternate') {
                state.activeUnitId = null;
                (state as any).__placementJustFinished = false;
                state.log.unshift('Placement terminé — début du combat (ordre par vitesse).');

                const msgs = advanceTurn(state);
                for (const m of msgs.slice(0, 4)) state.log.unshift(m);
                deps.render();
                return;
            }

            // Legacy behavior (pick-alternate): player chooses which ally starts.
            (state as any).sideToAct = 'allies';
            (state as any).alliesActedIds = [];
            (state as any).enemiesActedIds = [];

            state.activeUnitId = null;
            (state as any).__placementJustFinished = true;
            state.log.unshift('Placement terminé — choisis quel héros commence son tour.');
            deps.render();
            return;
        }

        // New turn system (pick-alternate): player chooses which ally acts.
        // If it's the player's phase and no ally is currently active, clicking an ally selects it.
        const sideToAct = (state as any).sideToAct as ('allies' | 'enemies' | undefined);
        const activeId = state.activeUnitId;
        const activeExisting = activeId ? getUnitById(state, activeId) : undefined;
        if ((state as any).turnMode === 'pick-alternate' && (sideToAct ?? 'allies') === 'allies') {
            const hasActiveAlly = Boolean(activeExisting && activeExisting.team === 'allies' && activeExisting.pv > 0);
            if (!hasActiveAlly) {
                if (clickedUnit && clickedUnit.team === 'allies' && clickedUnit.pv > 0) {
                    const acted = new Set<string>(((state as any).alliesActedIds ?? []) as string[]);
                    if (acted.has(clickedUnit.id)) {
                        state.log.unshift(`${clickedUnit.name} a déjà joué ce cycle.`);
                        deps.render();
                        return;
                    }

                    // Son spécial: quand on sélectionne un voleur ou un guerrier pour jouer
                    try {
                        const cls = String((clickedUnit.actor as any)?.characterClass ?? '').toLowerCase();
                        if (cls === 'voleur') {
                            (window as any).game?.audioManager.play('jemenoccupe');
                        } else if (cls === 'guerrier') {
                            (window as any).game?.audioManager.play('aucombat');
                        } else if (cls === 'mage') {
                            (window as any).game?.audioManager.play('allonsy');
                        }
                    } catch (e) {
                        // noop
                    }

                    state.activeUnitId = clickedUnit.id;
                    // If we were in post-placement selection mode, clear it now
                    (state as any).__placementJustFinished = false;
                    const msgs = startUnitTurn(state, clickedUnit.id);
                    for (const m of msgs.slice(0, 4)) state.log.unshift(m);

                    // Étourdissement: si le personnage est étourdi, il passe immédiatement.
                    if ((state as any).__autoPassActiveUnit === clickedUnit.id) {
                        (state as any).__autoPassActiveUnit = null;
                        const passMsgs = advanceTurn(state);
                        for (const m of passMsgs.slice(0, 4)) state.log.unshift(m);
                        deps.render();
                        return;
                    }

                    state.log.unshift(`${clickedUnit.name} commence son tour.`);
                    deps.render();
                }
                return;
            }
        }

        const activeNow = activeExisting;
        if (!activeNow || activeNow.pv <= 0) return;
        if (activeNow.team !== 'allies') return;
        if (!activeNow.actor) return;

        if (deps.animator.isAnimatingMove()) return;

        // clickedPos/clickedUnit already computed above.

        const selectedSkill = (() => {
            const key = deps.getSelectedSkillKey();
            if (!key) return null;
            const skills = ((activeNow.actor as any)?.skills ?? []) as Skill[];

            const matches = (s: Skill): boolean => {
                const sid = String((s as any).skillId ?? '');
                const skey = String((s as any).key ?? '');
                const sname = String((s as any).name ?? s.name ?? '');

                if (sid === key || skey === key || sname === key) return true;

                // Aliases: in some contexts clones may lose skillId, but the UI stores canonical ids.
                if (key === 'mana_groupe' && (skey === 'MG' || sname === 'Recharge de mana de groupe')) return true;
                if (key === 'ralentissement' && (skey === 'RT' || sname === 'Ralentissement du temps')) return true;

                return false;
            };

            return skills.find(matches) ?? null;
        })();

        const selectedSkillId = selectedSkill ? String((selectedSkill as any).skillId ?? '') : '';

        const isGroupManaSkill = (skill: Skill | null | undefined): boolean => {
            if (!skill) return false;
            const id = String((skill as any).skillId ?? '');
            const key = String((skill as any).key ?? '');
            const name = String((skill as any).name ?? skill.name ?? '');
            return id === 'mana_groupe' || key === 'MG' || name === 'Recharge de mana de groupe';
        };

        const ensureManaOrLog = (cost: number): boolean => {
            const curMana = Math.max(0, Math.floor(Number((activeNow.actor as any)?.currentMana ?? 0)));
            if (curMana < cost) {
                state.log.unshift(`Pas assez de mana (coût: ${cost}).`);
                return false;
            }
            return true;
        };

        const ensureOffCooldownOrLog = (skill: Skill): boolean => {
            const cd = (activeNow.actor as any).getSkillCooldownRemaining?.(skill) ?? 0;
            if (cd > 0) {
                state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                return false;
            }
            return true;
        };

        const shouldKeepSelectedSkillAfterUse = (skill: Skill): boolean => {
            // On ne gère l'auto-désélection que pour une compétence réellement sélectionnée.
            if (!deps.getSelectedSkillKey()) return false;
            if (!activeNow.actor) return false;

            // Encore assez de ressources pour la relancer tout de suite ?
            if (activeNow.actionPoints < ((skill as any).actionPoints ?? 0)) return false;
            if (((activeNow.actor as any).currentMana ?? 0) < ((skill as any).manaCost ?? 0)) return false;
            const cd = (activeNow.actor as any).getSkillCooldownRemaining?.(skill) ?? 0;
            if (cd > 0) return false;
            return true;
        };

        const spendActionPointsOrLog = (cost: number): boolean => {
            if (activeNow.actionPoints < cost) {
                state.log.unshift(`Pas assez de PA (coût: ${cost}).`);
                return false;
            }
            activeNow.actionPoints -= cost;
            activeNow.actor!.actionPoints = activeNow.actionPoints;
            return true;
        };

        const addManaToActor = (actor: any, amount: number): number => {
            if (!actor) return 0;
            const before = Math.max(0, Math.floor(Number(actor.currentMana ?? 0)));
            const maxMana = Math.max(0, Math.floor(Number(actor.effectiveMaxMana ?? actor.maxMana ?? 0)));
            actor.currentMana = Math.min(Math.max(0, before + Math.floor(amount)), maxMana);
            return actor.currentMana - before;
        };

        const tryCastGroupMana = (skill: Skill | null | undefined): boolean => {
            if (!skill) return false;
            if (!isGroupManaSkill(skill)) return false;
            const caster = activeNow.actor;
            if (!caster) return false;

            const cd = (caster as any).getSkillCooldownRemaining?.(skill) ?? 0;
            if (cd > 0) {
                state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                deps.render();
                return true;
            }

            const paCost = Math.max(0, Math.floor(Number((skill as any).actionPoints ?? 0)));
            if (!spendActionPointsOrLog(paCost)) {
                deps.render();
                return true;
            }

            const manaCost = Math.max(0, Math.floor(Number((skill as any).manaCost ?? 0)));
            if (caster.currentMana < manaCost) {
                // Refund PA if mana is insufficient
                activeNow.actionPoints += paCost;
                caster.actionPoints = activeNow.actionPoints;
                state.log.unshift(`Pas assez de mana pour utiliser ${skill.name}.`);
                deps.render();
                return true;
            }

            caster.currentMana -= manaCost;
            caster.startSkillCooldown?.(skill);

            const amount = 20;

            // 1) Plateau: appliquer aux alliés présents dans l'état tactique
            const allies = state.units.filter((u) => u.team === 'allies' && u.actor);
            const perAllyLines: string[] = [];
            const alreadyTouched = new Set<any>();
            for (const u of allies) {
                const a: any = u.actor as any;
                alreadyTouched.add(a);
                const gained = addManaToActor(a, amount);
                if (gained > 0) perAllyLines.push(`${u.name} +${gained} mana.`);
            }

            // 2) Fallback: aussi appliquer directement à la party (cas où les 2 autres membres
            // ne sont pas présents/valides dans `state.units` pour une raison quelconque).
            // On utilise un import dynamique pour éviter les dépendances circulaires.
            void (async () => {
                try {
                    const mod: any = await import('../party.web.js');
                    const members: any[] = (mod?.getPartyMembers?.() ?? []) as any[];
                    for (const m of members) {
                        if (!m || alreadyTouched.has(m)) continue;
                        addManaToActor(m, amount);
                    }
                } catch (e) {
                    // ignore
                }
            })();

            deps.playSkillAudio(skill);
            state.log.unshift(`${caster.name} utilise ${skill.name} et régénère 20 mana pour tout le groupe.`);
            for (const l of perAllyLines.slice(0, 3)) state.log.unshift(l);
            deps.syncFromActors();
            deps.render();
            if (selectedSkill && !shouldKeepSelectedSkillAfterUse(skill)) {
                deps.setSelectedSkillKey(null);
            }
            return true;
        };

        // Group mana is not really target-based: allow casting on any click.
        if (tryCastGroupMana(selectedSkill)) return;

        // UX: if a skill is selected and the player clicks a tile out of range,
        // deselect the skill (and do NOT move).
        // This applies to movement skills too.
        if (selectedSkill) {
            try {
                const inRange = isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos);
                if (!inRange) {
                    deps.setSelectedSkillKey(null);
                    deps.render();
                    return;
                }
            } catch {
                // If range logic fails, stay safe: do not move while a skill is selected.
                deps.setSelectedSkillKey(null);
                deps.render();
                return;
            }
        }

        const getDefaultEnemyAttackSkill = (): Skill | null => {
            const skills = ((activeNow.actor as any)?.skills ?? []) as Skill[];
            const basic = skills.find((s) => String((s as any).skillId ?? '') === 'basic_attack') ?? null;
            if (basic) return basic;

            // Certains persos (ex: mage) n'ont plus forcément d'attaque de base.
            const offensive = skills.filter((s) => s && isEnemyTargetingSkill(s));
            const mm = offensive.find((s) => String((s as any).skillId ?? '') === 'missile_magique') ?? null;
            return mm ?? offensive[0] ?? null;
        };

        const isMagicKnifeSkill = (skill: Skill | null | undefined): boolean => {
            if (!skill) return false;
            const sid = String((skill as any).skillId ?? '');
            const key = String((skill as any).key ?? skill.key ?? '');
            const name = String((skill as any).name ?? skill.name ?? '');
            return sid === 'couteau_magique' || key === 'CM' || name === 'Couteau magique';
        };

        type BoardUnit = NonNullable<ReturnType<typeof getUnitAt>>;

        const findFirstUnitOnOrthogonalLine = (from: Pos, to: Pos, maxSteps: number, onlyEnemies = false): BoardUnit | null => {
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) return null;
            const stepX = dx === 0 ? 0 : Math.sign(dx);
            const stepY = dy === 0 ? 0 : Math.sign(dy);
            const steps = Math.max(1, Math.floor(Number(maxSteps ?? 0)));
            for (let i = 1; i <= steps; i++) {
                const p: Pos = { x: from.x + stepX * i, y: from.y + stepY * i };
                if (!inBounds(state, p)) return null;
                const u = getUnitAt(state, p);
                if (!u || u.pv <= 0) continue;
                if (onlyEnemies) {
                    if (u.team === 'enemies') return u as BoardUnit;
                    continue; // ignore allies
                }
                return u as BoardUnit;
            }
            return null;
        };

        const findFirstUnitOnDiagonalLine = (from: Pos, to: Pos, maxSteps: number, onlyEnemies = false): BoardUnit | null => {
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            if ((dx === 0 && dy === 0) || Math.abs(dx) !== Math.abs(dy)) return null;

            const stepX = Math.sign(dx);
            const stepY = Math.sign(dy);
            const steps = Math.max(1, Math.floor(Number(maxSteps ?? 0)));
            for (let i = 1; i <= steps; i++) {
                const p: Pos = { x: from.x + stepX * i, y: from.y + stepY * i };
                if (!inBounds(state, p)) return null;
                const u = getUnitAt(state, p);
                if (!u || u.pv <= 0) continue;
                if (onlyEnemies) {
                    if (u.team === 'enemies') return u as BoardUnit;
                    continue;
                }
                return u as BoardUnit;
            }
            return null;
        };

        // General line (Bresenham) for any direction (used by aim='square' projectiles).
        const findFirstUnitOnBresenhamLine = (from: Pos, to: Pos, maxSteps: number, onlyEnemies = false): BoardUnit | null => {
            const x0 = from.x;
            const y0 = from.y;
            const x1 = to.x;
            const y1 = to.y;
            const dx = Math.abs(x1 - x0);
            const dy = Math.abs(y1 - y0);
            const sx = x0 < x1 ? 1 : -1;
            const sy = y0 < y1 ? 1 : -1;
            let err = dx - dy;

            let x = x0;
            let y = y0;

            for (let step = 0; step < maxSteps; step++) {
                if (x === x1 && y === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) {
                    err -= dy;
                    x += sx;
                }
                if (e2 < dx) {
                    err += dx;
                    y += sy;
                }
                const p: Pos = { x, y };
                if (!inBounds(state, p)) break;
                const u = getUnitAt(state, p);
                if (!u || u.pv <= 0) continue;
                if (onlyEnemies && u.team !== 'enemies') continue;
                return u;
            }
            return null;
        };

        // Movement skills (tile targeted)
        if (selectedSkill && (selectedSkill as any).type === 'movement') {
            // Charge (guerrier): déplacement orthogonal (portée 2)
            if (selectedSkillId === 'charge') {
                if (!ensureOffCooldownOrLog(selectedSkill)) {
                    deps.render();
                    return;
                }
                if (!ensureManaOrLog(Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0))))) {
                    deps.render();
                    return;
                }
                if (isRooted(activeNow.actor)) {
                    state.log.unshift(`${activeNow.name} est immobilisé et ne peut pas utiliser ${selectedSkill.name}.`);
                    deps.render();
                    return;
                }
                if (!isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos)) {
                    state.log.unshift('Choisis une case à portée 2 (haut/bas/gauche/droite).');
                    deps.render();
                    return;
                }
                if (!inBounds(state, clickedPos)) return;
                if (clickedUnit) {
                    state.log.unshift('Destination occupée.');
                    deps.render();
                    return;
                }

                // Autorise la traversée d'UN ennemi sur la trajectoire (pas d'allié), destination doit rester libre.
                const range = Math.max(1, Math.floor(Number(getSkillRange(selectedSkill) ?? 0)));
                const dx = clickedPos.x - activeNow.pos.x;
                const dy = clickedPos.y - activeNow.pos.y;
                const dist = Math.abs(dx) + Math.abs(dy);
                const stepX = dx === 0 ? 0 : Math.sign(dx);
                const stepY = dy === 0 ? 0 : Math.sign(dy);

                let traversedEnemy: BoardUnit | null = null;
                if (dist >= 2) {
                    // On inspecte uniquement les cases intermédiaires (exclude destination)
                    for (let i = 1; i <= Math.min(dist - 1, range); i++) {
                        const p: Pos = { x: activeNow.pos.x + stepX * i, y: activeNow.pos.y + stepY * i };
                        if (!inBounds(state, p)) break;
                        const u = getUnitAt(state, p) as BoardUnit | null;
                        if (!u || u.pv <= 0) continue;
                        if (u.team === 'allies') {
                            state.log.unshift('Un allié bloque la charge.');
                            deps.render();
                            return;
                        }
                        // Ennemi sur le chemin: on autorise une seule traversée
                        if (traversedEnemy) {
                            state.log.unshift('Chemin bloqué.');
                            deps.render();
                            return;
                        }
                        traversedEnemy = u;
                    }
                }

                const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
                const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
                if (!spendActionPointsOrLog(paCost)) {
                    deps.render();
                    return;
                }
                activeNow.actor.currentMana -= manaCost;
                activeNow.actor.startSkillCooldown?.(selectedSkill);

                void (async () => {
                    const moved = await deps.animator.animateMoveFree(activeNow.id as UnitId, clickedPos);
                    if (!moved) return;

                    const hasChargeDamageBoost = hasLearnedTalentPassiveNode(activeNow.actor, PASSIVE_CHARGE_DAMAGE_BOOST_NODE_ID);
                    const hasChargeStunTraversed = hasLearnedTalentPassiveNode(activeNow.actor, PASSIVE_CHARGE_STUN_TRAVERSED_NODE_ID);

                    if (traversedEnemy?.actor && hasChargeStunTraversed) {
                        const before = Math.max(0, Math.floor(Number((traversedEnemy.actor as any).stunTurns ?? 0)));
                        (traversedEnemy.actor as any).stunTurns = Math.max(0, before) + 1;
                        flashUnitAt(traversedEnemy.pos, 'reduced');
                        state.log.unshift(`${traversedEnemy.name} sera étourdi au prochain tour.`);
                    }

                    if (hasChargeDamageBoost) {
                        (activeNow.actor as any).activeEffects = (activeNow.actor as any).activeEffects ?? [];
                        (activeNow.actor as any).activeEffects.push({ type: 'buff', amount: 0.5, remainingTurns: 1, sourceSkill: 'charge' } as any);
                        state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name} : +50% dégâts jusqu'à la fin du tour.`);
                    } else {
                        state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name}.`);
                    }
                    deps.onPostMove?.(activeNow.id as UnitId, clickedPos);
                    deps.setSelectedSkillKey(null);
                    deps.render();
                })();
                return;
            }

            // Téléportation (mage)
            if (selectedSkillId === 'teleportation') {
                if (!ensureOffCooldownOrLog(selectedSkill)) {
                    deps.render();
                    return;
                }
                if (!ensureManaOrLog(Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0))))) {
                    deps.render();
                    return;
                }
                if (isRooted(activeNow.actor)) {
                    state.log.unshift(`${activeNow.name} est immobilisé et ne peut pas utiliser ${selectedSkill.name}.`);
                    deps.render();
                    return;
                }
                if (!isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos)) {
                    state.log.unshift(`Hors portée pour ${selectedSkill.name} (portée ${getSkillRange(selectedSkill)}) (haut/bas/gauche/droite).`);
                    deps.render();
                    return;
                }
                if (!inBounds(state, clickedPos)) return;
                if (clickedUnit) {
                    state.log.unshift('Destination occupée.');
                    deps.render();
                    return;
                }

                const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
                const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
                if (!spendActionPointsOrLog(paCost)) {
                    deps.render();
                    return;
                }
                activeNow.actor.currentMana -= manaCost;
                activeNow.actor.startSkillCooldown?.(selectedSkill);

                void (async () => {
                    await deps.animator.animateMoveFree(activeNow.id as UnitId, clickedPos);
                    state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name}.`);
                    // Trigger post-move hooks (retreat destination etc.) for skills that use animateMoveFree
                    deps.onPostMove?.(activeNow.id as UnitId, clickedPos);
                    deps.setSelectedSkillKey(null);
                    deps.render();
                })();
                return;
            }

            // Mouvement de fou (voleur): déplacement en diagonale (1 case)
            if (selectedSkillId === 'mouvement_de_fou') {
                if (!ensureOffCooldownOrLog(selectedSkill)) {
                    deps.render();
                    return;
                }
                if (!ensureManaOrLog(Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0))))) {
                    deps.render();
                    return;
                }
                if (isRooted(activeNow.actor)) {
                    state.log.unshift(`${activeNow.name} est immobilisé et ne peut pas utiliser ${selectedSkill.name}.`);
                    deps.render();
                    return;
                }
                if (!isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos)) {
                    state.log.unshift('Choisis une case en diagonale (portée 1).');
                    deps.render();
                    return;
                }
                if (!inBounds(state, clickedPos)) return;
                if (clickedUnit) {
                    state.log.unshift('Destination occupée.');
                    deps.render();
                    return;
                }

                const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
                const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
                if (!spendActionPointsOrLog(paCost)) {
                    deps.render();
                    return;
                }
                activeNow.actor.currentMana -= manaCost;
                activeNow.actor.startSkillCooldown?.(selectedSkill);

                void (async () => {
                    await deps.animator.animateMoveFree(activeNow.id as UnitId, clickedPos);
                    state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name}.`);
                    deps.onPostMove?.(activeNow.id as UnitId, clickedPos);
                    deps.setSelectedSkillKey(null);
                    deps.render();
                })();
                return;
            }

            // Lancer d'allié (guerrier)
            if (selectedSkillId === 'lancer_allie') {
                const throwState = getThrowState();
                const range = getSkillRange(selectedSkill);

                // 1) choisir un allié adjacent
                if (!throwState.grabbedAllyId) {
                    if (!clickedUnit || clickedUnit.team !== 'allies' || clickedUnit.id === activeNow.id) {
                        state.log.unshift('Choisis un allié adjacent à attraper.');
                        deps.render();
                        return;
                    }
                    const dx = Math.abs(clickedUnit.pos.x - activeNow.pos.x);
                    const dy = Math.abs(clickedUnit.pos.y - activeNow.pos.y);
                    if (dx + dy !== 1) {
                        state.log.unshift('L’allié doit être adjacent.');
                        deps.render();
                        return;
                    }
                    throwState.grabbedAllyId = clickedUnit.id;
                    state.log.unshift(`Allié attrapé: ${clickedUnit.name}. Choisis une destination (portée ${range}).`);
                    // Play selection audio for Lancer d'allié
                    try { (window as any).game?.audioManager.play('ilsvontpasaimer'); } catch (e) { /* noop */ }
                    deps.render();
                    return;
                }

                // 2) choisir une destination (case vide) ou un ennemi
                const ally = getUnitById(state, throwState.grabbedAllyId);
                if (!ally || ally.team !== 'allies' || ally.pv <= 0 || !ally.actor) {
                    throwState.grabbedAllyId = null;
                    state.log.unshift('Allié invalide.');
                    deps.render();
                    return;
                }

                if (!ensureOffCooldownOrLog(selectedSkill)) {
                    deps.render();
                    return;
                }
                if (!ensureManaOrLog(Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0))))) {
                    deps.render();
                    return;
                }
                if (!isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos)) {
                    state.log.unshift(`Hors portée (portée ${range}).`);
                    deps.render();
                    return;
                }

                // Destination: doit être une case libre (pas d'ennemi, pas d'allié)
                if (!inBounds(state, clickedPos)) {
                    state.log.unshift('Destination invalide.');
                    deps.render();
                    return;
                }
                if (clickedUnit) {
                    state.log.unshift('La destination doit être une case libre.');
                    deps.render();
                    return;
                }

                const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
                const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
                if (!spendActionPointsOrLog(paCost)) {
                    deps.render();
                    return;
                }
                activeNow.actor.currentMana -= manaCost;
                activeNow.actor.startSkillCooldown?.(selectedSkill);

                void (async () => {
                    // Play impact sound when the ally is launched (at the start of the throw)
                    try { (window as any).game?.audioManager.play('explosion'); } catch (e) { /* noop */ }
                    await deps.animator.animateMoveFree(ally.id as UnitId, clickedPos);

                    // Dégâts de zone autour de la case d'arrivée (rayon 1, 8 directions)
                    const mult = Number((selectedSkill as any)?.tactical?.damageMult ?? 2.0);
                    const cat = String(((selectedSkill as any)?.category ?? '')).toLowerCase();
                    const stat = cat === 'mage' ? (((ally.actor as any).effectivePower ?? ally.actor!.effectiveAttack)) : ally.actor!.effectiveAttack;
                    const dmg = Math.max(1, Math.floor(stat * mult));

                    let hitCount = 0;
                    const hitPositions: Pos[] = [];
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            const p: Pos = { x: ally.pos.x + dx, y: ally.pos.y + dy };
                            if (!inBounds(state, p)) continue;
                            const u = getUnitAt(state, p);
                            if (!u || u.team !== 'enemies' || !u.actor || u.pv <= 0) continue;
                            const res = u.actor.takeDamage(dmg, ally.actor);
                            if (res && res.actualDamage > 0) hitPositions.push(p);
                            if (res && res.reduced) hitPositions.push(p);
                            hitCount++;
                        }
                    }

                    // Étourdissement: orthogonaux (portée 1)
                    const stunRange = Math.max(1, Math.floor(Number((selectedSkill as any)?.tactical?.stunRange ?? 1)));
                    const orthDirs: Pos[] = [
                        { x: 1, y: 0 },
                        { x: -1, y: 0 },
                        { x: 0, y: 1 },
                        { x: 0, y: -1 },
                    ];

                    let stunnedCount = 0;
                    const stunnedPositions: Pos[] = [];
                    for (const d of orthDirs) {
                        for (let i = 1; i <= stunRange; i++) {
                            const p: Pos = { x: ally.pos.x + d.x * i, y: ally.pos.y + d.y * i };
                            if (!inBounds(state, p)) continue;
                            const u = getUnitAt(state, p);
                            if (!u || u.team !== 'enemies' || !u.actor || u.pv <= 0) continue;

                            const before = Math.max(0, Math.floor(Number((u.actor as any).stunTurns ?? 0)));
                            (u.actor as any).stunTurns = Math.max(0, before) + 1;
                            stunnedCount++;
                            stunnedPositions.push(p);
                        }
                    }

                    state.log.unshift(`${activeNow.name} lance ${ally.name} (impact: ${hitCount} ennemi(s) touché(s)${stunnedCount ? `, et étourdit ${stunnedCount} ennemi(s)` : ''}).`);
                    // Trigger post-move hooks for the thrown ally landing
                    deps.onPostMove?.(ally.id as UnitId, clickedPos);
                    deps.syncFromActors();
                    deps.render();
                    // Flash hits after rendering so animation is visible
                    for (const p of hitPositions) {
                        flashUnitAt(p, 'damage');
                    }
                    for (const p of stunnedPositions) {
                        if (!hitPositions.some((hp) => hp.x === p.x && hp.y === p.y)) flashUnitAt(p, 'reduced');
                    }

                    throwState.grabbedAllyId = null;
                    deps.setSelectedSkillKey(null);
                })();
                return;
            }

            // Lancer d'ennemi (guerrier)
            if (selectedSkillId === 'lancer_ennemi') {
                const throwState = getThrowState();
                const range = getSkillRange(selectedSkill);

                // 1) choisir un ennemi adjacent
                if (!throwState.grabbedEnemyId) {
                    if (!clickedUnit || clickedUnit.team !== 'enemies') {
                        state.log.unshift('Choisis un ennemi adjacent à attraper.');
                        deps.render();
                        return;
                    }
                    const dx = Math.abs(clickedUnit.pos.x - activeNow.pos.x);
                    const dy = Math.abs(clickedUnit.pos.y - activeNow.pos.y);
                    if (dx + dy !== 1) {
                        state.log.unshift('L’ennemi doit être adjacent.');
                        deps.render();
                        return;
                    }
                    throwState.grabbedEnemyId = clickedUnit.id;
                    state.log.unshift(`Ennemi attrapé: ${clickedUnit.name}. Choisis une destination (portée ${range}).`);
                    try { (window as any).game?.audioManager.play('ilsvontpasaimer'); } catch (e) { /* noop */ }
                    deps.render();
                    return;
                }

                // 2) choisir une destination (case vide)
                const enemy = getUnitById(state, throwState.grabbedEnemyId);
                if (!enemy || enemy.team !== 'enemies' || enemy.pv <= 0 || !enemy.actor) {
                    throwState.grabbedEnemyId = null;
                    state.log.unshift('Ennemi invalide.');
                    deps.render();
                    return;
                }

                if (!ensureOffCooldownOrLog(selectedSkill)) {
                    deps.render();
                    return;
                }
                if (!ensureManaOrLog(Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0))))) {
                    deps.render();
                    return;
                }
                if (!isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos)) {
                    state.log.unshift(`Hors portée (portée ${range}).`);
                    deps.render();
                    return;
                }

                if (!inBounds(state, clickedPos)) {
                    state.log.unshift('Destination invalide.');
                    deps.render();
                    return;
                }
                if (clickedUnit) {
                    state.log.unshift('La destination doit être une case libre.');
                    deps.render();
                    return;
                }

                const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
                const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
                if (!spendActionPointsOrLog(paCost)) {
                    deps.render();
                    return;
                }
                activeNow.actor.currentMana -= manaCost;
                activeNow.actor.startSkillCooldown?.(selectedSkill);

                void (async () => {
                    try { (window as any).game?.audioManager.play('explosion'); } catch (e) { /* noop */ }
                    await deps.animator.animateMoveFree(enemy.id as UnitId, clickedPos);

                    // Étourdit les ennemis orthogonaux adjacents (portée 1)
                    const stunRange = Math.max(1, Math.floor(Number((selectedSkill as any)?.tactical?.stunRange ?? 1)));
                    const targetTeam = activeNow.team === 'allies' ? 'enemies' : 'allies';

                    let stunnedCount = 0;
                    const stunnedPositions: Pos[] = [];

                    // Dégâts: 100% de l'attaque du lanceur (guerrier)
                    const caster = activeNow.actor!;
                    const cat = String(((selectedSkill as any)?.category ?? '')).toLowerCase();
                    const stat = cat === 'mage' ? (((caster as any).effectivePower ?? (caster.effectiveAttack ?? caster.baseAttack ?? activeNow.attack))) : (caster.effectiveAttack ?? caster.baseAttack ?? activeNow.attack);
                    const dmg = Math.max(1, Math.floor(stat * 1.0));

                    // La cible lancée subit des dégâts (150% de l'attaque du lanceur)
                    const hitPositions: Array<{ p: Pos; reduced?: boolean }> = [];
                    let hitCount = 0;
                    if (enemy && enemy.actor) {
                        const resSelf = enemy.actor.takeDamage(dmg, caster);
                        if (resSelf && resSelf.actualDamage > 0) {
                            hitPositions.push({ p: { x: enemy.pos.x, y: enemy.pos.y } });
                            hitCount++;
                        }
                        if (resSelf && resSelf.reduced) hitPositions.push({ p: { x: enemy.pos.x, y: enemy.pos.y }, reduced: true });
                    }

                    const dirs: Pos[] = [
                        { x: 1, y: 0 },
                        { x: -1, y: 0 },
                        { x: 0, y: 1 },
                        { x: 0, y: -1 },
                    ];

                    for (const d of dirs) {
                        for (let i = 1; i <= stunRange; i++) {
                            const p: Pos = { x: enemy.pos.x + d.x * i, y: enemy.pos.y + d.y * i };
                            if (!inBounds(state, p)) continue;
                            const u = getUnitAt(state, p);
                            if (!u || u.team !== targetTeam || !u.actor || u.pv <= 0) continue;

                            // Apply damage (no stun)
                            const res = u.actor.takeDamage(dmg, caster);
                            if (res && res.actualDamage > 0) {
                                hitPositions.push({ p });
                                hitCount++;
                            }
                            if (res && res.reduced) hitPositions.push({ p, reduced: true });
                        }
                    }

                    state.log.unshift(`${activeNow.name} lance ${enemy.name} et inflige ${hitCount} dégâts.`);
                    deps.onPostMove?.(enemy.id as UnitId, clickedPos);
                    deps.syncFromActors();
                    deps.render();

                    // Flash sur les unités touchées
                    for (const hp of hitPositions) {
                        flashUnitAt(hp.p, 'damage');
                        if (hp.reduced) flashUnitAt(hp.p, 'reduced');
                    }

                    throwState.grabbedEnemyId = null;
                    deps.setSelectedSkillKey(null);
                })();
                return;
            }
        }

        // Harpon chaîne (guerrier): choisis un ennemi dans la portée, puis choisis une case libre adjacente au guerrier
        if (selectedSkillId === 'harpon_chaine') {
            const throwState = getThrowState();
            const skill = selectedSkill!;
            const range = getSkillRange(skill);

            // 1) choisir une cible ennemie dans la portée
            if (!throwState.grabbedEnemyId) {
                if (!clickedUnit || clickedUnit.team !== 'enemies') {
                    state.log.unshift('Choisis un ennemi dans la portée.');
                    deps.render();
                    return;
                }
                if (!isWithinSkillRangeDirectional(activeNow.actor, skill, activeNow.pos, clickedPos)) {
                    state.log.unshift(`Hors portée (portée ${range}).`);
                    deps.render();
                    return;
                }

                throwState.grabbedEnemyId = clickedUnit.id;
                state.log.unshift(`Ennemi accroché: ${clickedUnit.name}. Choisis une case libre adjacente au guerrier.`);
                try { (window as any).game?.audioManager.play('ilsvontpasaimer'); } catch (e) { /* noop */ }
                deps.render();
                return;
            }

            // 2) choisir une case libre adjacente (8 directions) au guerrier
            const enemy = getUnitById(state, throwState.grabbedEnemyId);
            if (!enemy || enemy.team !== 'enemies' || enemy.pv <= 0 || !enemy.actor) {
                throwState.grabbedEnemyId = null;
                state.log.unshift('Ennemi invalide.');
                deps.render();
                return;
            }

            if (!ensureOffCooldownOrLog(skill)) {
                deps.render();
                return;
            }
            if (!ensureManaOrLog(Math.max(0, Math.floor(Number((skill as any).manaCost ?? 0))))) {
                deps.render();
                return;
            }

            // Destination must be adjacent (including diagonal) to the caster
            const dx = Math.abs(clickedPos.x - activeNow.pos.x);
            const dy = Math.abs(clickedPos.y - activeNow.pos.y);
            if ((dx === 0 && dy === 0) || dx > 1 || dy > 1) {
                state.log.unshift('La destination doit être une case libre adjacente au guerrier.');
                deps.render();
                return;
            }
            if (!inBounds(state, clickedPos)) {
                state.log.unshift('Destination invalide.');
                deps.render();
                return;
            }
            if (clickedUnit) {
                state.log.unshift('La destination doit être une case libre.');
                deps.render();
                return;
            }

            const paCost = Math.max(0, Math.floor(Number((skill as any).actionPoints ?? 0)));
            const manaCost = Math.max(0, Math.floor(Number((skill as any).manaCost ?? 0)));
            if (!spendActionPointsOrLog(paCost)) {
                deps.render();
                return;
            }
            activeNow.actor.currentMana -= manaCost;
            activeNow.actor.startSkillCooldown?.(skill);

            void (async () => {
                try { (window as any).game?.audioManager.play('explosion'); } catch (e) { /* noop */ }
                await deps.animator.animateMoveFree(enemy.id as UnitId, clickedPos);

                // Apply debuff: -50% attack for 2 turns
                const a: any = enemy.actor as any;
                a.activeEffects = a.activeEffects ?? [];
a.activeEffects.push({ type: 'debuff', amount: 0.5, remainingTurns: 2, sourceSkill: String(skill.name ?? 'Harpon chaîne'), sourceSkillId: 'harpon_chaine' } as any);

                    state.log.unshift(`${activeNow.name} utilise ${skill.name} sur ${enemy.name}, le ramène à côté et réduit son attaque de 50% pendant 2 tours.`);
                deps.onPostMove?.(enemy.id as UnitId, clickedPos);
                deps.syncFromActors();
                deps.render();

                // Visual feedback
                flashUnitAt(clickedPos, 'reduced');

                throwState.grabbedEnemyId = null;
                deps.setSelectedSkillKey(null);
            })();
            return;
        }

        // Rayon de feu (mage): attaque en ligne qui touche tous les ennemis dans la direction choisie
        if (selectedSkill && selectedSkillId === 'rayon_de_feu') {
            if (!ensureOffCooldownOrLog(selectedSkill)) {
                deps.render();
                return;
            }

            const range = getSkillRange(selectedSkill);
            if (!isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos)) {
                state.log.unshift(`Hors portée pour ${selectedSkill.name} (portée ${range}) (haut/bas/gauche/droite).`);
                deps.render();
                return;
            }

            const dx = clickedPos.x - activeNow.pos.x;
            const dy = clickedPos.y - activeNow.pos.y;
            if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) {
                state.log.unshift('Choisis une case en ligne droite (haut/bas/gauche/droite).');
                deps.render();
                return;
            }

            const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
            const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
            if (!ensureManaOrLog(manaCost)) {
                deps.render();
                return;
            }
            if (!spendActionPointsOrLog(paCost)) {
                deps.render();
                return;
            }

            // Spend mana + start cooldown once
            activeNow.actor.currentMana -= manaCost;
            activeNow.actor.startSkillCooldown?.(selectedSkill);

            void (async () => {
                const spellSrc = './Anim/skill_rayonfeu.gif';
                try {
                    void deps.animator.preloadSpellGif(spellSrc);
                } catch {
                    // noop
                }

                const stepX = dx === 0 ? 0 : Math.sign(dx);
                const stepY = dy === 0 ? 0 : Math.sign(dy);
                const lineTiles: Pos[] = [];
                for (let i = 1; i <= range; i++) {
                    const p: Pos = { x: activeNow.pos.x + stepX * i, y: activeNow.pos.y + stepY * i };
                    if (!inBounds(state, p)) break;
                    lineTiles.push(p);
                }

                // Simple projectile animation along the chosen direction
                await deps.animator.animateProjectile(activeNow.pos, clickedPos, deps.getSkillIconSrc(selectedSkill));

                // Play the fire-wall animation on every impacted tile of the line.
                // (Don't block combat resolution if an image fails to load.)
                try {
                    void Promise.all(
                        lineTiles.map((p, idx) =>
                            new Promise<void>((resolve) => {
                                setTimeout(() => {
                                    void deps.animator
                                        .animateSpellAt(p, spellSrc, {
                                            duration: 1600,
                                            scale: 0.95,
                                            zIndex: 650,
                                        })
                                        .finally(() => resolve());
                                }, idx * 45);
                            })
                        )
                    );
                } catch {
                    // noop
                }

                const caster = activeNow.actor!;
                const typeMult = caster.getPassiveSkillTypeMultiplier?.('damage') ?? 1;
                const baseMult = Number((selectedSkill as any).damage ?? 0);
                const cat = String(((selectedSkill as any)?.category ?? '')).toLowerCase();
                const stat = cat === 'mage' ? (((caster as any).effectivePower ?? caster.effectiveAttack)) : caster.effectiveAttack;
                const dmg = Math.max(1, Math.round(baseMult * stat * typeMult));

                let hitCount = 0;
                const hitLines: string[] = [];
                const hitPositions: Pos[] = [];

                for (let i = 1; i <= range; i++) {
                    const p: Pos = { x: activeNow.pos.x + stepX * i, y: activeNow.pos.y + stepY * i };
                    if (!inBounds(state, p)) break;
                    const u = getUnitAt(state, p);
                    if (!u || u.team !== 'enemies' || !u.actor || u.pv <= 0) continue;

                    const beforePv = u.actor.pv;
                    const res = u.actor.takeDamage(dmg, caster);
                    hitCount++;

                    // Log a few lines, avoid spamming
                    if (hitLines.length < 4) {
                        const crit = (res as any).critical ? ' (CRIT)' : '';
                        hitLines.push(`${u.name}: ${res.actualDamage} dégâts${crit} (PV ${beforePv} → ${u.actor.pv})`);
                    }
                    hitPositions.push(p);
                    if (res.reduced) hitPositions.push(p);
                }

                deps.playSkillAudio(selectedSkill);

                if (hitCount <= 0) {
                    state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name}, mais ne touche aucun ennemi.`);
                } else {
                    state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name} et touche ${hitCount} ennemi(s).`);
                    for (const l of hitLines) state.log.unshift(l);
                }

                deps.syncFromActors();
                deps.render();

                // Flash hits after rendering
                for (const p of hitPositions) {
                    flashUnitAt(p, 'damage');
                }

                if (!shouldKeepSelectedSkillAfterUse(selectedSkill)) {
                    deps.setSelectedSkillKey(null);
                }
            })();
            return;
        }

        // Bombe fumigène (voleur) : zone autour d'une case diagonale (portée 4), rayon 3
        if (selectedSkill && selectedSkillId === 'bombe_fumigene') {
            if (!ensureOffCooldownOrLog(selectedSkill)) {
                deps.render();
                return;
            }

            const range = getSkillRange(selectedSkill);
            if (!isWithinSkillRangeDirectional(activeNow.actor, selectedSkill, activeNow.pos, clickedPos)) {
                state.log.unshift(`Hors portée pour ${selectedSkill.name} (portée ${range}) (diagonales).`);
                deps.render();
                return;
            }

            if (!inBounds(state, clickedPos)) return;

            const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
            const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
            if (!ensureManaOrLog(manaCost)) {
                deps.render();
                return;
            }
            if (!spendActionPointsOrLog(paCost)) {
                deps.render();
                return;
            }

            // Spend mana + start cooldown once
            activeNow.actor.currentMana -= manaCost;
            activeNow.actor.startSkillCooldown?.(selectedSkill);

            void (async () => {
                // Small impact animation
                try {
                    await deps.animator.animateImpact(clickedPos, deps.getSkillIconSrc(selectedSkill));
                } catch {
                    /* noop */
                }

                const radius = Math.max(0, Math.floor(Number((selectedSkill as any)?.tactical?.radius ?? 0)));
                let affected = 0;
                const affectedPositions: Pos[] = [];

                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        // Euclidean radius (circle) => include if dx*dx + dy*dy <= radius*radius
                        if (dx * dx + dy * dy > radius * radius) continue;
                        const p: Pos = { x: clickedPos.x + dx, y: clickedPos.y + dy };
                        if (!inBounds(state, p)) continue;
                        const u = getUnitAt(state, p);
                        if (!u || u.team !== 'enemies' || !u.actor || u.pv <= 0) continue;

                        // Apply delayed PA loss: target will lose 1 PA at the start of its next turn
                        (u.actor as any).activeEffects = (u.actor as any).activeEffects ?? [];
                        (u.actor as any).activeEffects.push({ type: 'pa_loss', amount: 1, remainingTurns: 1, sourceSkill: 'bombe_fumigene' } as any);

                        affected++;
                        affectedPositions.push(p);
                    }
                }

                state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name} et ${affected} ennemi(s) perd(ent) 1 PA au début de leur prochain tour.`);
                deps.syncFromActors();
                deps.render();

                // Make impact visible on all affected tiles
                const icon = deps.getSkillIconSrc(selectedSkill);
                for (const p of affectedPositions) {
                    try { deps.animator.animateImpact(p, icon); } catch (e) { /* noop */ }
                }

                for (const p of affectedPositions) flashUnitAt(p, 'reduced');

                if (!shouldKeepSelectedSkillAfterUse(selectedSkill)) {
                    deps.setSelectedSkillKey(null);
                }
            })();
            return;
        }

        // Guerrier : Double crochet — étourdit les ennemis orthogonaux adjacents (portée 1)
        if (selectedSkill && String((selectedSkill as any).skillId ?? '') === 'double_crochet') {
            if (!ensureOffCooldownOrLog(selectedSkill)) { deps.render(); return; }
            const manaCost = Math.max(0, Math.floor(Number((selectedSkill as any).manaCost ?? 0)));
            if (!ensureManaOrLog(manaCost)) { deps.render(); return; }
            const paCost = Math.max(0, Math.floor(Number((selectedSkill as any).actionPoints ?? 0)));
            if (!spendActionPointsOrLog(paCost)) { deps.render(); return; }
            activeNow.actor.currentMana -= manaCost;
            activeNow.actor.startSkillCooldown?.(selectedSkill);

            const orthDirs: Pos[] = [
                { x: 1, y: 0 },
                { x: -1, y: 0 },
                { x: 0, y: 1 },
                { x: 0, y: -1 },
            ];

            let stunnedCount = 0;
            const stunnedPositions: Pos[] = [];
            for (const d of orthDirs) {
                const p: Pos = { x: activeNow.pos.x + d.x, y: activeNow.pos.y + d.y };
                if (!inBounds(state, p)) continue;
                const u = getUnitAt(state, p);
                if (!u || u.team !== 'enemies' || !u.actor || u.pv <= 0) continue;
                const before = Math.max(0, Math.floor(Number((u.actor as any).stunTurns ?? 0)));
                (u.actor as any).stunTurns = Math.max(0, before) + 1;
                stunnedCount++;
                stunnedPositions.push(p);
            }

            state.log.unshift(`${activeNow.name} utilise ${selectedSkill.name} et étourdit ${stunnedCount} ennemi(s).`);
            deps.syncFromActors();
            deps.render();
            for (const p of stunnedPositions) flashUnitAt(p, 'reduced');
            if (!shouldKeepSelectedSkillAfterUse(selectedSkill)) deps.setSelectedSkillKey(null);
            return;
        }

        // Si clique une unité ennemie: on lance une compétence (attaque de base par défaut)
        if (clickedUnit && clickedUnit.team === 'enemies') {
            const skill = selectedSkill ?? getDefaultEnemyAttackSkill();
            if (skill) {
                // Note: la compétence `mana_groupe` est gérée plus haut via `tryCastGroupMana`.

                if (!clickedUnit.actor) {
                    state.log.unshift('Cible invalide (pas de Player lié).');
                    deps.render();
                    return;
                }

                if (!isEnemyTargetingSkill(skill)) {
                    state.log.unshift(`${skill.name} ne cible pas un ennemi.`);
                    deps.render();
                    return;
                }

                // Couteau magique: projectile qui s'arrête au premier obstacle sur la ligne.
                // - Si un allié est sur la trajectoire: tir bloqué.
                // - Si un ennemi est avant la cible cliquée: il sera touché à la place.
                let effectiveTargetUnit = clickedUnit;
                let effectiveTargetPos = clickedUnit.pos;
                if (isMagicKnifeSkill(skill)) {
                    const range = getSkillRange(skill);
                    const firstEnemy = findFirstUnitOnOrthogonalLine(activeNow.pos, clickedUnit.pos, range, true);
                    if (firstEnemy) {
                        effectiveTargetUnit = firstEnemy;
                        effectiveTargetPos = firstEnemy.pos;
                        if (firstEnemy.id !== clickedUnit.id) {
                            state.log.unshift(`Le couteau magique touche ${firstEnemy.name} en premier.`);
                        }
                    }
                }

                // Projectiles (ex: Shuriken, Tir gobelin): ne peuvent pas viser derrière une unité.
                // - Si une unité du même camp est sur la trajectoire: tir bloqué.
                // - Si un ennemi est avant la cible cliquée: il sera touché à la place.
                if (!isMagicKnifeSkill(skill) && Boolean((skill as any)?.tactical?.stopAtFirstUnit)) {
                    const range = getSkillRange(skill);
                    const aim = String((skill as any)?.tactical?.aim ?? '').toLowerCase();
                    const first =
                        aim === 'orthogonal'
                            ? findFirstUnitOnOrthogonalLine(activeNow.pos, clickedUnit.pos, range, false)
                            : aim.startsWith('diagonal')
                              ? findFirstUnitOnDiagonalLine(activeNow.pos, clickedUnit.pos, range)
                                                            : aim === 'square'
                                                                ? findFirstUnitOnBresenhamLine(activeNow.pos, clickedUnit.pos, range, false)
                              : (findFirstUnitOnOrthogonalLine(activeNow.pos, clickedUnit.pos, range, false) ??
                                    findFirstUnitOnDiagonalLine(activeNow.pos, clickedUnit.pos, range));

                    if (first && first.id !== clickedUnit.id) {
                        if (first.team === activeNow.team) {
                            // Special case: 'shuriken' (voleur) ignores allied blockers and can hit enemies behind allies.
                            if (String((skill as any).skillId ?? '') === 'shuriken') {
                                const range = getSkillRange(skill);
                                const aim = String((skill as any)?.tactical?.aim ?? '').toLowerCase();
                                const enemyFirst = aim.startsWith('diagonal')
                                    ? findFirstUnitOnDiagonalLine(activeNow.pos, clickedUnit.pos, range, true)
                                    : findFirstUnitOnOrthogonalLine(activeNow.pos, clickedUnit.pos, range, true);
                                if (enemyFirst) {
                                    effectiveTargetUnit = enemyFirst;
                                    effectiveTargetPos = enemyFirst.pos;
                                    state.log.unshift(`Le tir passe l'allié et touche ${enemyFirst.name} en premier.`);
                                } else {
                                    // Aucun ennemi derrière: laisser passer (le tir ratera si rien n'est derrière)
                                }
                            } else {
                                state.log.unshift('Tir bloqué par une unité alliée.');
                                deps.render();
                                return;
                            }
                        } else {
                            effectiveTargetUnit = first;
                            effectiveTargetPos = first.pos;
                            state.log.unshift(`Le tir touche ${first.name} en premier.`);
                        }
                    }
                }

                // Portée
                const range = getSkillRange(skill);
                                if (!isWithinSkillRangeDirectional(activeNow.actor, skill, activeNow.pos, effectiveTargetPos)) {
                    const cls = String((activeNow.actor as any)?.characterClass ?? '').toLowerCase();
                                        const aim = String((skill as any)?.tactical?.aim ?? '').toLowerCase();
                    const hint =
                        String((skill as any).skillId ?? '') === 'basic_attack' || range <= 1
                            ? ''
                                                        : aim === 'square'
                                                            ? ' (carré)'
                                                            : aim === 'orthogonal'
                                                                ? ' (haut/bas/gauche/droite)'
                                                                : aim.startsWith('diagonal')
                                                                    ? ' (diagonales)'
                            : cls === 'mage'
                              ? ' (haut/bas/gauche/droite)'
                              : cls === 'voleur'
                                ? ' (diagonales)'
                                : '';
                    state.log.unshift(`Hors portée pour ${skill.name} (portée ${range})${hint}.`);
                    deps.render();
                    return;
                }

                const cd = (activeNow.actor as any).getSkillCooldownRemaining?.(skill) ?? 0;
                if (cd > 0) {
                    state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                    deps.render();
                    return;
                }

                void (async () => {
                    const caster = activeNow.actor;
                    const target = effectiveTargetUnit.actor;
                    if (!caster || !target) {
                        state.log.unshift('Cible invalide (pas de Player lié).');
                        deps.render();
                        return;
                    }

                    // Assassinat: téléporte DEVANT la cible (entre le lanceur et la cible) avant d'appliquer les dégâts
                    if (String((skill as any).skillId ?? '') === 'assassinat') {
                        if (caster.currentMana < (skill as any).manaCost) {
                            state.log.unshift(`Pas assez de mana pour utiliser ${skill.name}.`);
                            deps.render();
                            return;
                        }
                        const sdx = Math.sign(clickedUnit.pos.x - activeNow.pos.x);
                        const sdy = Math.sign(clickedUnit.pos.y - activeNow.pos.y);
                        const front: Pos = { x: clickedUnit.pos.x - sdx, y: clickedUnit.pos.y - sdy };
                        // If we're already standing in front, no teleport is needed
                        if (front.x === activeNow.pos.x && front.y === activeNow.pos.y) {
                            // noop: already in front
                        } else {
                            if (!inBounds(state, front) || getUnitAt(state, front)) {
                                state.log.unshift('Impossible de se téléporter devant la cible.');
                                deps.render();
                                return;
                            }
                            await deps.animator.animateMoveFree(activeNow.id as UnitId, front);
                            // Trigger post-move hooks when teleporting in front (assassinat)
                            deps.onPostMove?.(activeNow.id as UnitId, front);
                        }
                    }

                    if (!spendActionPointsOrLog((skill as any).actionPoints)) {
                        deps.render();
                        return;
                    }

                    // Applique le skill sur l'ennemi (on ne render qu'après l'anim)
                    const dx = Math.abs(activeNow.pos.x - effectiveTargetPos.x);
                    const dy = Math.abs(activeNow.pos.y - effectiveTargetPos.y);
                    const isDiagonal = dx > 0 && dy > 0 && dx === dy;
                    const diagonalCritBonus = isDiagonal ? Number((skill as any)?.tactical?.diagonalCritBonus ?? 0) : 0;

                    const res = applyPlayerSkillTurn({ caster, target, skill, turn: 1, critChanceBonus: diagonalCritBonus });
                    if (!res.ok) {
                        // Rembourse PA si l'action a échoué
                        activeNow.actionPoints += (skill as any).actionPoints;
                        caster.actionPoints = activeNow.actionPoints;
                        state.log.unshift(res.message);
                        deps.render();
                        return;
                    }

                    // Animation simple: boule de feu qui se déplace
                    const id = String((skill as any).skillId ?? (skill as any).key ?? skill.name);
                    if (id === 'boule_de_feu') {
                        await deps.animator.animateProjectile(activeNow.pos, effectiveTargetPos, deps.getSkillIconSrc(skill));
                    }
                    if (id === 'couteau_magique') {
                        try {
                            await deps.animator.animateProjectile(activeNow.pos, effectiveTargetPos, deps.getSkillIconSrc(skill));
                        } catch {
                            /* noop */
                        }
                    }

                    // Éclair (mage): anim sur la case ciblée + petites décharges sur toutes les cases
                    if (id === 'eclair') {
                        const mainSrc = './Anim/skill_eclair.webp';

                        try {
                            void deps.animator.preloadSpellGif(mainSrc);
                        } catch {
                            // noop
                        }

                        // Darken the board tiles for 1s.
                        // Important: the grid is re-rendered after the skill resolves, so per-tile classes get lost.
                        // Using a body class makes the effect persist across renders.
                        try {
                            const w: any = window as any;
                            if (w.__tacticalDimTilesTimer) {
                                clearTimeout(w.__tacticalDimTilesTimer);
                                w.__tacticalDimTilesTimer = null;
                            }
                            document.body.classList.add('tactical-dim-tiles');
                            w.__tacticalDimTilesTimer = setTimeout(() => {
                                try { document.body.classList.remove('tactical-dim-tiles'); } catch { /* noop */ }
                            }, 1000);
                        } catch {
                            // noop
                        }

                        // Big lightning on the targeted tile: play it twice within ~400ms.
                        try {
                            const playOnce = (delayMs: number) => {
                                setTimeout(() => {
                                    try {
                                        void deps.animator.animateSpellAt(effectiveTargetPos, mainSrc, {
                                            duration: 400,
                                            scale: 2.0,
                                            zIndex: 720,
                                            // Move it much higher relative to the targeted tile
                                            offsetY: -110,
                                        });
                                    } catch {
                                        // noop
                                    }
                                }, delayMs);
                            };

                            playOnce(0);
                            playOnce(200);
                        } catch {
                            // noop
                        }

                        // Small lightning animation removed (asset deleted per request).
                    }

                    // Son uniquement quand l'activation réussit
                    deps.playSkillAudio(skill);

                    // Spécifique Repouser: pousse la cible d'une case en arrière et lui fait perdre 1 PA
                    if (id === 'repouser') {
                        const sdx = Math.sign(clickedUnit.pos.x - activeNow.pos.x);
                        const sdy = Math.sign(clickedUnit.pos.y - activeNow.pos.y);
                        const pushDest: Pos = { x: clickedUnit.pos.x + sdx, y: clickedUnit.pos.y + sdy };
                        try {
                            await deps.animator.animateMoveFree(clickedUnit.id as UnitId, pushDest);
                        } catch (e) {
                            /* noop */
                        }

                        // Apply delayed PA loss: target will lose 1 PA at the start of its next turn
                        if (clickedUnit.actor) {
                            const before = (clickedUnit.actor as any).activeEffects ?? [];
                            (clickedUnit.actor as any).activeEffects = (clickedUnit.actor as any).activeEffects ?? [];
                            (clickedUnit.actor as any).activeEffects.push({ type: 'pa_loss', amount: 1, remainingTurns: 1, sourceSkill: 'repouser' } as any);
                        }

                        state.log.unshift(`${caster.name} utilise ${skill.name} et repousse ${clickedUnit.name} (perd 1 PA au début de son prochain tour).`);
                        deps.syncFromActors();
                        deps.render();

                        // Visual feedback: flash the destination to show push
                        flashUnitAt(pushDest, 'reduced');

                        if (selectedSkill && !shouldKeepSelectedSkillAfterUse(selectedSkill)) {
                            deps.setSelectedSkillKey(null);
                        }
                        return;
                    }

                    state.log.unshift(res.message);
                    if (res.extraHistory?.length) {
                        for (const l of res.extraHistory.slice(0, 6)) state.log.unshift(l);
                    }
                    deps.syncFromActors();
                    deps.render();

                    // Flash / effet visuel si dégâts ou soin (after render)
                    if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
                        flashUnitAt(effectiveTargetPos, 'damage');
                        if (res.damageFlashOnTarget.reduced) flashUnitAt(effectiveTargetPos, 'reduced');
                        spawnFloatAt(effectiveTargetPos, 'damage', res.damageFlashOnTarget.actualDamage);
                    }
                    if (res.healFlashOnCaster) {
                        flashUnitAt(activeNow.pos, 'heal');
                    }

                    // Si la compétence venait d'une sélection, on la conserve uniquement si elle est encore rejouable.
                    if (selectedSkill && !shouldKeepSelectedSkillAfterUse(selectedSkill)) {
                        deps.setSelectedSkillKey(null);
                    }
                })();
                return;
            }

            state.log.unshift(`Choisis une compétence pour attaquer.`);
            deps.render();
            return;
        }

        // Lancer un skill "sur soi" en cliquant sur sa propre case
        if (clickedUnit && clickedUnit.team === 'allies' && clickedUnit.id === activeNow.id) {
            const skill = selectedSkill;
            if (!skill) return;
            const baseId = String((skill as any).skillId ?? '');
            if ((skill as any).type === 'movement') {
                state.log.unshift(`${skill.name} doit cibler une case.`);
                deps.render();
                return;
            }
            // Allow group mana even if it's not tagged as self-targeting
            if (!isSelfTargetingSkill(skill) && !isAllyHealSkill(skill) && baseId !== 'mana_groupe') {
                state.log.unshift(`${skill.name} doit cibler un ennemi.`);
                deps.render();
                return;
            }

            const cd = (activeNow.actor as any).getSkillCooldownRemaining?.(skill) ?? 0;
            if (cd > 0) {
                state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                deps.render();
                return;
            }

            if (!spendActionPointsOrLog((skill as any).actionPoints)) {
                deps.render();
                return;
            }

            // Special: group mana skill (regarde l'id canonique)
            if (baseId === 'mana_groupe') {
                const caster = activeNow.actor;
                if (!caster) return;
                if (caster.currentMana < (skill as any).manaCost) {
                    state.log.unshift(`Pas assez de mana pour utiliser ${skill.name}.`);
                    deps.render();
                    return;
                }
                // Dépense mana + cooldown
                caster.currentMana -= (skill as any).manaCost;
                caster.startSkillCooldown?.(skill);

                // Appliquer à tous les alliés sur le plateau
                const allies = state.units.filter((u) => u.team === 'allies' && u.actor);
                const perAllyLines: string[] = [];
                for (const u of allies) {
                    const a: any = u.actor as any;
                    const before = Math.max(0, Math.floor(a.currentMana ?? 0));
                    // Only add currentMana (do not change maxMana)
                    const maxMana = Math.max(0, Math.floor(a.effectiveMaxMana ?? a.maxMana ?? 0));
                    a.currentMana = Math.min(maxMana, Math.max(0, before + 20));
                    const gained = a.currentMana - before;
                    if (gained > 0) perAllyLines.push(`${u.name} +${gained} mana.`);
                }

                deps.playSkillAudio(skill);
                state.log.unshift(`${caster.name} utilise ${skill.name} et régénère 20 mana pour tout le groupe.`);
                for (const l of perAllyLines.slice(0, 3)) state.log.unshift(l);
                deps.syncFromActors();
                deps.render();
                if (selectedSkill && !shouldKeepSelectedSkillAfterUse(selectedSkill)) {
                    deps.setSelectedSkillKey(null);
                }
                return;
            }

            const res = applyPlayerSkillTurn({ caster: activeNow.actor, target: activeNow.actor, skill, turn: 1 });
            if (!res.ok) {
                activeNow.actionPoints += (skill as any).actionPoints;
                activeNow.actor.actionPoints = activeNow.actionPoints;
                state.log.unshift(res.message);
                deps.render();
                return;
            }

            // Adventure wound system: 20% of damage taken reduces max HP for the adventure duration.
            if ((state as any).__adventureMode && res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
                const dmg = Math.max(0, Math.floor(Number(res.damageFlashOnTarget.actualDamage ?? 0)));
                const wound = Math.max(0, Math.floor(dmg * 0.2));
                if (wound > 0) {
                    const a: any = activeNow.actor as any;
                    a.__adventureMaxHpPenalty = Math.max(0, Math.floor(Number(a.__adventureMaxHpPenalty ?? 0))) + wound;
                    a.maxPv = Math.max(1, Math.floor(Number(a.maxPv ?? 1) - wound));
                    a.pv = Math.min(Math.max(0, Math.floor(Number(a.pv ?? 0))), a.maxPv);
                }
            }

            state.log.unshift(res.message);
            if (res.extraHistory?.length) {
                for (const l of res.extraHistory.slice(0, 4)) state.log.unshift(l);
            }
            deps.syncFromActors();
            deps.render();

            // Flash effects after render
            if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
                flashUnitAt(activeNow.pos, 'damage');
                if (res.damageFlashOnTarget.reduced) flashUnitAt(activeNow.pos, 'reduced');
                spawnFloatAt(activeNow.pos, 'damage', res.damageFlashOnTarget.actualDamage);
            }
            if (res.healFlashOnCaster) {
                flashUnitAt(activeNow.pos, 'heal');
            }

            if (!shouldKeepSelectedSkillAfterUse(skill)) {
                deps.setSelectedSkillKey(null);
            }
            return;
        }

        // Lancer un soin (heal/hot) sur un allié en cliquant sa case
        if (clickedUnit && clickedUnit.team === 'allies' && clickedUnit.actor) {
            const skill = selectedSkill;
            if (skill && isAllyHealSkill(skill)) {
                const cd = (activeNow.actor as any).getSkillCooldownRemaining?.(skill) ?? 0;
                if (cd > 0) {
                    state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                    deps.render();
                    return;
                }

                if (!spendActionPointsOrLog((skill as any).actionPoints)) {
                    deps.render();
                    return;
                }

                const res = applyPlayerSkillTurn({ caster: activeNow.actor, target: clickedUnit.actor, skill, turn: 1 });
                if (!res.ok) {
                    activeNow.actionPoints += (skill as any).actionPoints;
                    activeNow.actor.actionPoints = activeNow.actionPoints;
                    state.log.unshift(res.message);
                    deps.render();
                    return;
                }

                deps.playSkillAudio(skill);
                state.log.unshift(res.message);
                if (res.extraHistory?.length) {
                    for (const l of res.extraHistory.slice(0, 4)) state.log.unshift(l);
                }
                deps.syncFromActors();

                if (!shouldKeepSelectedSkillAfterUse(skill)) {
                    deps.setSelectedSkillKey(null);
                }
                deps.render();
                return;
            }
        }

        // Special: allow casting group mana without a specific target (e.g. clicking an empty tile)
        if (selectedSkill && String((selectedSkill as any).skillId ?? '') === 'mana_groupe') {
            const skill = selectedSkill;
            const caster = activeNow.actor;
            if (!caster) return;

            const cd = (caster as any).getSkillCooldownRemaining?.(skill) ?? 0;
            if (cd > 0) {
                state.log.unshift(`${skill.name} est en cooldown (${cd} tour(s)).`);
                deps.render();
                return;
            }

            if (!spendActionPointsOrLog((skill as any).actionPoints)) {
                deps.render();
                return;
            }

            if (caster.currentMana < (skill as any).manaCost) {
                activeNow.actionPoints += (skill as any).actionPoints;
                caster.actionPoints = activeNow.actionPoints;
                state.log.unshift(`Pas assez de mana pour utiliser ${skill.name}.`);
                deps.render();
                return;
            }

            caster.currentMana -= (skill as any).manaCost;
            caster.startSkillCooldown?.(skill);

            const allies = state.units.filter((u) => u.team === 'allies' && u.actor);
            const perAllyLines: string[] = [];
            for (const u of allies) {
                const a: any = u.actor as any;
                const before = Math.max(0, Math.floor(a.currentMana ?? 0));
                const maxMana = Math.max(0, Math.floor(a.effectiveMaxMana ?? a.maxMana ?? 0));
                a.currentMana = Math.min(maxMana, Math.max(0, before + 20));
                const gained = a.currentMana - before;
                if (gained > 0) perAllyLines.push(`${u.name} +${gained} mana.`);
            }

            deps.playSkillAudio(skill);
            state.log.unshift(`${caster.name} utilise ${skill.name} et régénère 20 mana pour tout le groupe.`);
            for (const l of perAllyLines.slice(0, 3)) state.log.unshift(l);
            deps.syncFromActors();
            deps.render();
            if (!shouldKeepSelectedSkillAfterUse(skill)) {
                deps.setSelectedSkillKey(null);
            }
            return;
        }

        // Sinon tentative de déplacement
        // IMPORTANT: never move while a skill is selected.
        if (deps.getSelectedSkillKey()) {
            return;
        }
        void (async () => {
                if (isRooted(activeNow.actor)) {
                    state.log.unshift(`${activeNow.name} est immobilisé et ne peut pas se déplacer.`);
                    deps.render();
                    return;
                }
            const moved = await deps.animator.animateMoveTo(activeNow.id as UnitId, clickedPos);
            if (moved) {
                state.log.unshift(`${activeNow.name} se déplace.`);
                deps.onPostMove?.(activeNow.id as UnitId, clickedPos);
            }
            deps.render();
        })();
    });
}
