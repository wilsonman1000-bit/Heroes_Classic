import { applyPlayerSkillTurn } from '../battleTurn.web.js';
import type { Skill } from '../skill.js';
import {
    findShortestPath,
    getUnitAt,
    getUnitById,
    inBounds,
    listReachableTiles,
    tryMoveUnit,
    type Pos,
    type TacticalState,
    type TacticalUnit,
    type UnitId,
} from '../tacticalBoard.js';
import { getDirectionalDistance, getRangedAimModeForActor, getSkillRange, isEnemyTargetingSkill, isWithinSkillRangeDirectional } from './targeting.js';
import {
    PASSIVE_CHARGE_DAMAGE_BOOST_NODE_ID,
    PASSIVE_CHARGE_STUN_TRAVERSED_NODE_ID,
    hasLearnedTalentPassiveNode,
} from '../talents/talentPassives.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function pickOffensiveSkillForEnemy(actor: any): Skill | null {
    const skills = (actor?.skills ?? []) as Skill[];
    const offensive = skills.filter((s) => s && isEnemyTargetingSkill(s));
    if (!offensive.length) return null;

    const byId = (id: string) => offensive.find((s) => String((s as any).skillId ?? '') === id);
    return byId('tir_gobelin') ?? byId('basic_attack') ?? offensive[0] ?? null;
}

function getSkillId(skill: Skill): string {
    return String((skill as any).skillId ?? skill.key ?? skill.name ?? '');
}

function getSkillApCost(skill: Skill): number {
    return Math.max(0, Math.floor(Number((skill as any).actionPoints ?? 0)));
}

function getSkillManaCost(skill: Skill): number {
    return Math.max(0, Math.floor(Number((skill as any).manaCost ?? 0)));
}

function pickBestOffensiveSkillForTarget(params: {
    actor: any;
    unit: TacticalUnit;
    target: TacticalUnit;
}): Skill | null {
    const { actor, unit, target } = params;
    const skills = (actor?.skills ?? []) as Skill[];
    const offensive = skills.filter((s) => s && isEnemyTargetingSkill(s));
    if (!offensive.length) return null;

    const candidates = offensive.filter((s) => canUseSkillOnTarget({ actor, unit, target, skill: s }));
    if (!candidates.length) return null;

    const score = (s: Skill): number => {
        const id = getSkillId(s);
        // Prefer gobelin ranged shot when available.
        if (id === 'tir_gobelin') return 1000;
        // Prefer basic attack as a safe fallback.
        if (id === 'basic_attack') return 900;

        const dmg = Number((s as any).damage ?? NaN);
        const dot = Number((s as any).damagePerTurn ?? NaN);
        const mana = getSkillManaCost(s);
        const ap = getSkillApCost(s);
        let base = 100;
        if (Number.isFinite(dmg)) base += Math.max(0, Math.floor(dmg * 100));
        else if (Number.isFinite(dot)) base += Math.max(0, Math.floor(dot * 60));
        // Slight preference for cheaper skills when options are similar.
        base -= mana * 2;
        base -= ap;
        return base;
    };

    candidates.sort((a, b) => score(b) - score(a));
    return candidates[0] ?? null;
}

function pickSelfDefenseSkill(actor: any): Skill | null {
    const skills = (actor?.skills ?? []) as Skill[];
    const defenses = skills.filter((s) => String((s as any)?.type ?? '') === 'defense');
    if (!defenses.length) return null;
    const byId = (id: string) => defenses.find((s) => getSkillId(s) === id);
    return byId('block') ?? defenses[0] ?? null;
}

function pickSelfManaGainSkill(actor: any): Skill | null {
    const skills = (actor?.skills ?? []) as Skill[];
    const manaSkills = skills.filter((s) => String((s as any)?.type ?? '') === 'mana');
    if (!manaSkills.length) return null;
    const byId = (id: string) => manaSkills.find((s) => getSkillId(s) === id);
    return byId('mana_gain') ?? manaSkills[0] ?? null;
}

function canUseSelfSkill(params: { actor: any; unit: TacticalUnit; skill: Skill }): boolean {
    const { actor, unit, skill } = params;
    if (!actor || !skill) return false;
    const cd = actor.getSkillCooldownRemaining?.(skill) ?? 0;
    if (cd > 0) return false;
    const apCost = getSkillApCost(skill);
    if (unit.actionPoints < apCost) return false;
    const manaCost = getSkillManaCost(skill);
    if (Math.floor(Number(actor.currentMana ?? 0)) < manaCost) return false;
    return true;
}

function applySelfSkillOnce(state: TacticalState, params: { unit: TacticalUnit; skill: Skill }): boolean {
    const { unit, skill } = params;
    const actor = unit.actor;
    if (!actor) return false;

    const apCost = getSkillApCost(skill);
    unit.actionPoints -= apCost;
    actor.actionPoints = unit.actionPoints;

    const res = applyPlayerSkillTurn({ caster: actor, target: actor, skill, turn: 1 });
    if (!res.ok) {
        unit.actionPoints += apCost;
        actor.actionPoints = unit.actionPoints;
        return false;
    }

    state.log.unshift(res.message);
    if (res.extraHistory?.length) {
        for (const l of res.extraHistory.slice(0, 2)) state.log.unshift(l);
    }
    unit.pv = Math.max(0, Math.floor(actor.pv));
    unit.maxPv = Math.max(1, Math.floor(actor.maxPv ?? unit.maxPv ?? 1));
    return true;
}

function canUseSkillOnTarget(params: {
    actor: any;
    unit: TacticalUnit;
    target: TacticalUnit;
    skill: Skill;
}): boolean {
    const { actor, unit, target, skill } = params;
    if (!actor) return false;
    if (!target?.actor) return false;
    if (!skill) return false;
    if (!isEnemyTargetingSkill(skill)) return false;

    const cd = actor.getSkillCooldownRemaining?.(skill) ?? 0;
    if (cd > 0) return false;

    const range = getSkillRange(skill);
    if (unit.actionPoints < (skill.actionPoints ?? 0)) return false;

    const manaCost = getSkillManaCost(skill);
    if (Math.floor(Number(actor.currentMana ?? 0)) < manaCost) return false;

    if (!isWithinSkillRangeDirectional(actor, skill, unit.pos, target.pos)) return false;
    const d = getDirectionalDistance(
        String((skill as any).skillId ?? '') === 'basic_attack' || range <= 1 ? 'manhattan' : getRangedAimModeForActor(actor),
        unit.pos,
        target.pos
    );
    return d <= range;
}

function isRooted(actor: any): boolean {
    const fx = Array.isArray(actor?.activeEffects) ? (actor.activeEffects as any[]) : [];
    return fx.some((e) => String(e?.type ?? '') === 'root' && Number(e?.remainingTurns ?? 0) !== 0);
}

async function tryUseCharge(state: TacticalState, params: {
    unit: TacticalUnit;
    target: TacticalUnit;
    hooks: {
        moveAnimated?: (unitId: UnitId, dest: Pos) => Promise<boolean>;
        moveAnimatedFree?: (unitId: UnitId, dest: Pos) => Promise<boolean>;
    };
}): Promise<boolean> {
    const { unit, target, hooks } = params;
    const actor = unit.actor;
    if (!actor) return false;
    if (isRooted(actor)) return false;

    const skills = (actor?.skills ?? []) as Skill[];
    const charge = skills.find((s) => getSkillId(s) === 'charge');
    if (!charge) return false;
    if (String((charge as any).type ?? '') !== 'movement') return false;

    const cd = actor.getSkillCooldownRemaining?.(charge) ?? 0;
    if (cd > 0) return false;

    const apCost = getSkillApCost(charge);
    const manaCost = getSkillManaCost(charge);
    if (unit.actionPoints < apCost) return false;
    if (Math.floor(Number(actor.currentMana ?? 0)) < manaCost) return false;

    const range = Math.max(1, Math.floor(Number(getSkillRange(charge) ?? 0)));
    // Generate candidate orthogonal destinations within range.
    const dirs: Pos[] = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
    ];

    const offensiveForFollowUp = pickBestOffensiveSkillForTarget({ actor, unit: { ...unit, actionPoints: Math.max(0, unit.actionPoints - apCost) }, target });

    const hasChargeDamageBoost = hasLearnedTalentPassiveNode(actor, PASSIVE_CHARGE_DAMAGE_BOOST_NODE_ID);
    const hasChargeStunTraversed = hasLearnedTalentPassiveNode(actor, PASSIVE_CHARGE_STUN_TRAVERSED_NODE_ID);

    let best: { dest: Pos; dist: number; canAttackAfter: boolean; traversed: TacticalUnit | null } | null = null;

    for (const d of dirs) {
        for (let step = 1; step <= range; step++) {
            const dest: Pos = { x: unit.pos.x + d.x * step, y: unit.pos.y + d.y * step };
            if (!inBounds(state, dest)) break;
            if (getUnitAt(state, dest)) continue;

            let traversed: TacticalUnit | null = null;
            let blocked = false;

            // Inspect intermediate tiles only.
            for (let i = 1; i <= step - 1; i++) {
                const p: Pos = { x: unit.pos.x + d.x * i, y: unit.pos.y + d.y * i };
                const u = getUnitAt(state, p);
                if (!u || u.pv <= 0) continue;
                if (u.team === unit.team) {
                    blocked = true;
                    break;
                }
                // Opponent on the path: allow at most one traversal.
                if (traversed) {
                    blocked = true;
                    break;
                }
                traversed = u;
            }
            if (blocked) continue;

            // If we would need to pass through a unit, we require free-move animation (or we skip).
            if (traversed && !hooks.moveAnimatedFree) continue;

            const dist = Math.abs(dest.x - target.pos.x) + Math.abs(dest.y - target.pos.y);
            let canAttackAfter = false;
            if (offensiveForFollowUp) {
                const fakeUnit: TacticalUnit = { ...unit, pos: dest, actionPoints: Math.max(0, unit.actionPoints - apCost) };
                canAttackAfter = canUseSkillOnTarget({ actor, unit: fakeUnit, target, skill: offensiveForFollowUp });
            }

            const cand = { dest, dist, canAttackAfter, traversed };
            if (!best) {
                best = cand;
                continue;
            }
            if (cand.canAttackAfter !== best.canAttackAfter) {
                if (cand.canAttackAfter) best = cand;
                continue;
            }
            if (cand.dist !== best.dist) {
                if (cand.dist < best.dist) best = cand;
                continue;
            }
            // Prefer traversal only if it provides value (stun passive).
            if (hasChargeStunTraversed && !!cand.traversed !== !!best.traversed) {
                if (cand.traversed) best = cand;
                continue;
            }
        }
    }

    if (!best) return false;

    // Spend resources.
    unit.actionPoints = Math.max(0, unit.actionPoints - apCost);
    actor.actionPoints = unit.actionPoints;
    actor.currentMana = Math.max(0, Math.floor(Number(actor.currentMana ?? 0)) - manaCost);
    actor.startSkillCooldown?.(charge);

    // Move.
    const doMove = async (): Promise<boolean> => {
        if (hooks.moveAnimatedFree) return hooks.moveAnimatedFree(unit.id as UnitId, best!.dest);
        if (hooks.moveAnimated) return hooks.moveAnimated(unit.id as UnitId, best!.dest);
        unit.pos = { x: best!.dest.x, y: best!.dest.y };
        return true;
    };

    const moved = await doMove();
    if (!moved) {
        // Refund if animation failed.
        unit.actionPoints += apCost;
        actor.actionPoints = unit.actionPoints;
        actor.currentMana = Math.floor(Number(actor.currentMana ?? 0)) + manaCost;
        return false;
    }

    // Apply charge effects only if unlocked via talent passives.
    if (best.traversed?.actor && hasChargeStunTraversed) {
        const before = Math.max(0, Math.floor(Number((best.traversed.actor as any).stunTurns ?? 0)));
        (best.traversed.actor as any).stunTurns = before + 1;
        state.log.unshift(`${best.traversed.name} sera étourdi au prochain tour.`);
    }

    if (hasChargeDamageBoost) {
        (actor as any).activeEffects = Array.isArray((actor as any).activeEffects) ? (actor as any).activeEffects : [];
        (actor as any).activeEffects.push({ type: 'buff', amount: 0.5, remainingTurns: 1, sourceSkill: 'charge', sourceSkillId: 'charge' } as any);
        state.log.unshift(`${unit.name} utilise Charge : +50% dégâts jusqu'à la fin du tour.`);
    } else {
        state.log.unshift(`${unit.name} utilise Charge.`);
    }
    return true;
}

function applySkillOnce(state: TacticalState, params: { unit: TacticalUnit; target: TacticalUnit; skill: Skill }): boolean {
    const { unit, target, skill } = params;
    const actor = unit.actor;
    const targetActor = target.actor;
    if (!actor || !targetActor) return false;

    unit.actionPoints -= skill.actionPoints;
    actor.actionPoints = unit.actionPoints;
    const res = applyPlayerSkillTurn({ caster: actor, target: targetActor, skill, turn: 1 });
    if (!res.ok) {
        unit.actionPoints += skill.actionPoints;
        actor.actionPoints = unit.actionPoints;
        return false;
    }

    state.log.unshift(res.message);
    if (res.extraHistory?.length) {
        for (const l of res.extraHistory.slice(0, 3)) state.log.unshift(l);
    }
    if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
        applyAdventureWoundIfNeeded(state, targetActor, res.damageFlashOnTarget.actualDamage);
    }

    unit.pv = Math.max(0, Math.floor(actor.pv));
    target.pv = Math.max(0, Math.floor(targetActor.pv));
    target.maxPv = Math.max(1, Math.floor(targetActor.maxPv ?? target.maxPv ?? 1));
    if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
        (state as any).__lastUnitEffect = {
            unitId: target.id,
            kind: 'damage',
            amount: Math.max(0, Math.floor(Number(res.damageFlashOnTarget.actualDamage ?? 0))),
            reduced: !!res.damageFlashOnTarget.reduced,
        };
    }
    if (target.pv <= 0) state.log.unshift(`${target.name} est KO.`);
    return true;
}

function applyAdventureWoundIfNeeded(state: TacticalState, targetActor: any, actualDamage: number) {
    if (!(state as any).__adventureMode) return;
    const dmg = Math.max(0, Math.floor(Number(actualDamage ?? 0)));
    if (dmg <= 0) return;
    const wound = Math.max(0, Math.floor(dmg * 0.2));
    if (wound <= 0) return;

    const prev = Math.max(0, Math.floor(Number(targetActor?.__adventureMaxHpPenalty ?? 0)));
    targetActor.__adventureMaxHpPenalty = prev + wound;
    targetActor.maxPv = Math.max(1, Math.floor(Number(targetActor?.maxPv ?? 1) - wound));
    targetActor.pv = Math.min(Math.max(0, Math.floor(Number(targetActor?.pv ?? 0))), targetActor.maxPv);
}

function pickNearestTarget(state: TacticalState, from: TacticalUnit, targetTeam: 'allies' | 'enemies'): TacticalUnit | undefined {
    const targets = state.units.filter((u) => u.team === targetTeam && u.pv > 0);
    let best: { t: TacticalUnit; d: number } | undefined;

    for (const t of targets) {
        const d = Math.abs(from.pos.x - t.pos.x) + Math.abs(from.pos.y - t.pos.y);
        if (!best || d < best.d) best = { t, d };
    }

    return best?.t;
}

export async function aiAct(
    state: TacticalState,
    hooks: {
        moveAnimated?: (unitId: UnitId, dest: Pos) => Promise<boolean>;
        moveAnimatedFree?: (unitId: UnitId, dest: Pos) => Promise<boolean>;
        onAfterAction?: () => void;
        betweenActionsMs?: number;
    } = {}
): Promise<void> {
    if (!state.activeUnitId) return;
    const unit = getUnitById(state, state.activeUnitId);
    if (!unit || unit.pv <= 0) return;
    if (unit.team !== 'enemies') return;

    const actor = unit.actor;
    if (!actor) {
        state.log.unshift(`${unit.name} hésite…`);
        return;
    }

    // Ennemis: essaient d'agir tant qu'il reste des PA.
    // Logique: (1) si un sort offensif est à portée => l'utiliser, (2) sinon si à portée mais sans mana => gain de mana (si dispo),
    // (3) sinon charge si utile, (4) sinon déplacement, (5) fallback défense (blocage) si applicable.
    {
        const betweenActionsMs = Math.max(0, Math.floor(Number(hooks.betweenActionsMs ?? 1000)));
        const afterActionPauseIfNeeded = async () => {
            // Render right after the action so players can see it, then pause before next action.
            try {
                hooks.onAfterAction?.();
            } catch (e) {
                console.warn('[aiAct] onAfterAction hook failed', e);
            }
            if (betweenActionsMs > 0 && unit.actionPoints > 0) await sleep(betweenActionsMs);
        };

        let safety = 0;
        while (unit.actionPoints > 0 && safety < 48) {
            safety++;

            const target = pickNearestTarget(state, unit, 'allies');
            if (!target || target.pv <= 0 || !target.actor) return;

            // 1) Offensif si possible.
            const offensive = pickBestOffensiveSkillForTarget({ actor, unit, target }) ?? pickOffensiveSkillForEnemy(actor);
            if (offensive && canUseSkillOnTarget({ actor, unit, target, skill: offensive })) {
                const did = applySkillOnce(state, { unit, target, skill: offensive });
                if (did) {
                    await afterActionPauseIfNeeded();
                    continue;
                }
            }

            // 2) Si la cible est déjà à portée, mais pas assez de mana pour une attaque:
            // priorité = gain de mana, puis blocage.
            const skills = (actor?.skills ?? []) as Skill[];
            const offensiveAll = skills.filter((s) => s && isEnemyTargetingSkill(s));
            const inRangeButNoMana = offensiveAll.some((s) => {
                const apOk = unit.actionPoints >= getSkillApCost(s);
                const cd = actor.getSkillCooldownRemaining?.(s) ?? 0;
                if (!apOk || cd > 0) return false;
                const range = getSkillRange(s);
                if (!isWithinSkillRangeDirectional(actor, s, unit.pos, target.pos)) return false;
                const d = getDirectionalDistance(
                    getSkillId(s) === 'basic_attack' || range <= 1 ? 'manhattan' : getRangedAimModeForActor(actor),
                    unit.pos,
                    target.pos
                );
                if (d > range) return false;
                const mana = getSkillManaCost(s);
                return Math.floor(Number(actor.currentMana ?? 0)) < mana;
            });

            if (inRangeButNoMana) {
                const manaGain = pickSelfManaGainSkill(actor);
                if (manaGain && canUseSelfSkill({ actor, unit, skill: manaGain })) {
                    const didMana = applySelfSkillOnce(state, { unit, skill: manaGain });
                    if (didMana) {
                        await afterActionPauseIfNeeded();
                        continue;
                    }
                }
                const block = pickSelfDefenseSkill(actor);
                if (block && canUseSelfSkill({ actor, unit, skill: block })) {
                    const didBlock = applySelfSkillOnce(state, { unit, skill: block });
                    if (didBlock) {
                        await afterActionPauseIfNeeded();
                        continue;
                    }
                }
            }

            // 3) Charge (si le skill existe) pour se rapprocher / préparer une attaque.
            const usedCharge = await tryUseCharge(state, { unit, target, hooks });
            if (usedCharge) {
                await afterActionPauseIfNeeded();
                continue;
            }

            // 4) Déplacement (avec les PA restants) vers une case qui permet d'attaquer,
            // ou à défaut la plus proche de la cible.
            const skillForPositioning = pickBestOffensiveSkillForTarget({ actor, unit, target }) ?? pickOffensiveSkillForEnemy(actor);
            const reachable = [unit.pos, ...listReachableTiles(state, unit.id)];
            let best: { pos: Pos; canAttack: boolean; remainingAp: number; dist: number; cost: number } | null = null;

            for (const p of reachable) {
                if (p.x === unit.pos.x && p.y === unit.pos.y) {
                    // cost 0
                } else if (getUnitAt(state, p)) {
                    continue;
                }

                let cost = 0;
                if (p.x !== unit.pos.x || p.y !== unit.pos.y) {
                    const path = findShortestPath(state, unit.id, p);
                    if (!path) continue;
                    cost = Math.max(0, Math.floor(path.length));
                }
                const remainingAp = Math.max(0, unit.actionPoints - cost);
                const dist = Math.abs(p.x - target.pos.x) + Math.abs(p.y - target.pos.y);

                let canAttack = false;
                if (skillForPositioning && remainingAp >= getSkillApCost(skillForPositioning)) {
                    const range = getSkillRange(skillForPositioning);
                    const cd = actor.getSkillCooldownRemaining?.(skillForPositioning) ?? 0;
                    const manaOk = Math.floor(Number(actor.currentMana ?? 0)) >= getSkillManaCost(skillForPositioning);
                    if (manaOk && cd <= 0 && isWithinSkillRangeDirectional(actor, skillForPositioning, p, target.pos)) {
                        const d = getDirectionalDistance(
                            getSkillId(skillForPositioning) === 'basic_attack' || range <= 1
                                ? 'manhattan'
                                : getRangedAimModeForActor(actor),
                            p,
                            target.pos
                        );
                        canAttack = d <= range;
                    }
                }

                const cand = { pos: p, canAttack, remainingAp, dist, cost };
                if (!best) {
                    best = cand;
                    continue;
                }

                // Prefer positions that allow attacking this turn; then maximize remaining AP (more attacks), then closer.
                if (cand.canAttack !== best.canAttack) {
                    if (cand.canAttack) best = cand;
                    continue;
                }
                if (cand.canAttack) {
                    if (cand.remainingAp !== best.remainingAp) {
                        if (cand.remainingAp > best.remainingAp) best = cand;
                        continue;
                    }
                    if (cand.dist !== best.dist) {
                        if (cand.dist < best.dist) best = cand;
                        continue;
                    }
                    if (cand.cost !== best.cost) {
                        if (cand.cost < best.cost) best = cand;
                        continue;
                    }
                } else {
                    if (cand.dist !== best.dist) {
                        if (cand.dist < best.dist) best = cand;
                        continue;
                    }
                    if (cand.cost !== best.cost) {
                        if (cand.cost < best.cost) best = cand;
                        continue;
                    }
                }
            }

            const dest = best?.pos;
            if (!dest || (dest.x === unit.pos.x && dest.y === unit.pos.y)) {
                // Can't improve position and can't act.
                return;
            }

            if (hooks.moveAnimated) {
                const ok = await hooks.moveAnimated(unit.id as UnitId, dest);
                if (ok) state.log.unshift(`${unit.name} se déplace.`);
                else return;
            } else {
                const mv = tryMoveUnit(state, unit.id, dest);
                if (mv.ok) state.log.unshift(`${unit.name} se déplace.`);
                else return;
            }

            await afterActionPauseIfNeeded();
        }
        return;
    }
}
