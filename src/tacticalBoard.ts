import { Player } from './player.js';
import { createEnemy, type EnemyId } from './enemies.js';

export type Team = 'allies' | 'enemies';
export type Pos = { x: number; y: number };
export type UnitId = string;

export type TacticalUnit = {
    id: UnitId;
    name: string;
    team: Team;
    pos: Pos;
    // Vitesse / initiative (plus haut = joue plus tôt)
    speed: number;
    pv: number;
    maxPv: number;
    actionPointsMax: number;
    actionPoints: number;
    attack: number;
    // Optionnel: conserve le Player d'origine si tu veux brancher les skills plus tard
    actor?: Player;
};

export type TacticalState = {
    width: number;
    height: number;
    units: TacticalUnit[];
    // Ordre des tours (ids) calculé au démarrage selon la vitesse
    turnOrder: UnitId[];
    turnIndex: number;
    activeUnitId: UnitId | null;
    // Mode de tours
    turnMode?: 'speed' | 'pick-alternate';
    // En mode pick-alternate: quelle équipe agit maintenant
    sideToAct?: Team;
    // En mode pick-alternate: rotation simple des ennemis
    enemyTurnCursor?: number;
    // En mode pick-alternate: alliés déjà joués dans le cycle courant
    alliesActedIds?: UnitId[];
    // En mode pick-alternate: ennemis déjà joués dans le cycle courant
    enemiesActedIds?: UnitId[];
    log: string[];
};

export function getBaseSpeedForActor(actor: Player, team: Team, enemyIndex?: number): number {
    if (team === 'allies') {
        const cls = String((actor as any).characterClass ?? '').toLowerCase();
        const base = cls === 'voleur' ? 3 : cls === 'mage' ? 2 : 1; // guerrier
        const bonus = Math.max(0, Math.floor(Number((actor as any).characteristics?.vitesse ?? 0)));
        return base + bonus;
    }

    // Ennemis (gobelins): gobelin 1 => 3, gobelin 2 => 2, gobelin 3 => 1
    const idx = Math.max(1, Math.floor((enemyIndex ?? 1)));
    const base = idx === 1 ? 3 : idx === 2 ? 2 : 1;
    // Optionnel: appliquer une vitesse/initiative propre à l'ennemi.
    // La valeur par défaut des personnages est vitesse=1; on la considère comme « neutre » pour ne pas changer le comportement historique.
    const raw = Math.max(0, Math.floor(Number((actor as any)?.characteristics?.vitesse ?? 1)));
    const bonus = Math.max(0, raw - 1);
    return base + bonus;
}

function computeTurnOrder(units: TacticalUnit[]): UnitId[] {
    // Ordre: vitesse desc.
    // Tie-break stable: alliés avant ennemis, puis id (déterministe).
    return units
        .slice()
        .sort((a, b) => {
            const sa = Math.max(0, Math.floor(a.speed ?? 0));
            const sb = Math.max(0, Math.floor(b.speed ?? 0));
            if (sb !== sa) return sb - sa;

            const ta = a.team === 'allies' ? 0 : 1;
            const tb = b.team === 'allies' ? 0 : 1;
            if (ta !== tb) return ta - tb;

            return String(a.id).localeCompare(String(b.id));
        })
        .map((u) => u.id);
}

export function posKey(pos: Pos): string {
    return `${pos.x},${pos.y}`;
}

export function inBounds(state: TacticalState, pos: Pos): boolean {
    return pos.x >= 0 && pos.y >= 0 && pos.x < state.width && pos.y < state.height;
}

export function getUnitById(state: TacticalState, id: UnitId): TacticalUnit | undefined {
    return state.units.find((u) => u.id === id);
}

export function getUnitAt(state: TacticalState, pos: Pos): TacticalUnit | undefined {
    return state.units.find((u) => u.pv > 0 && u.pos.x === pos.x && u.pos.y === pos.y);
}

export function isOccupied(state: TacticalState, pos: Pos): boolean {
    return Boolean(getUnitAt(state, pos));
}

export function manhattan(a: Pos, b: Pos): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export type TacticalEnemySetup = {
    enemyId?: EnemyId;
    enemyLevel?: number;
    enemyCount?: number;
};

export function createQuickSkirmishFromParty(alliesParty: Player[], enemySetup: TacticalEnemySetup = {}): TacticalState {
    const alliesActors = (alliesParty ?? []).slice(0, 3).map((p, idx) => {
        const a = p.clone();
        a.name = p.name || `Allié ${idx + 1}`;
        // skills/stats sont supposés déjà configurés côté web (party)
        return a;
    });

    // Ennemis: utilise le système central `createEnemy()` (src/enemies.ts)
    const enemyId: EnemyId = (enemySetup.enemyId ?? 'gobelin') as EnemyId;
    const enemyLevel = Math.max(1, Math.floor(enemySetup.enemyLevel ?? 1));
    const enemyCount = Math.max(1, Math.floor(enemySetup.enemyCount ?? 3));

    const enemies: Player[] = [];
    for (let i = 0; i < enemyCount; ++i) {
        // If the encounter is 'gobelin', ensure exactly one archer gobelin is present.
        const idToCreate = enemyId === 'gobelin' && i === 0
            ? ('gobelin_archer' as const)
            : (enemyId === 'chef_gobelin' && i === 1
                ? ('sergent_gobelin' as const)
                : enemyId);
        const e = createEnemy(idToCreate, enemyLevel);
        // Nom court et lisible sur le plateau
        e.name = `${e.name.split(' niveau ')[0]} ${i + 1}`;
        enemies.push(e);
    }

    const mkUnit = (id: string, actor: Player, team: Team, pos: Pos, enemyIndex?: number): TacticalUnit => {
        // IMPORTANT: ne pas écrire actor.maxPv/actor.maxMana avec les valeurs effectives.
        // Sinon les bonus d'équipement (ex: +10 mana) deviennent permanents et se cumulent entre combats.
        const effectiveMaxPv = Math.max(1, Math.floor(actor.effectiveMaxPv ?? actor.maxPv ?? 1));
        const effectiveMaxMana = Math.max(0, Math.floor(actor.effectiveMaxMana ?? actor.maxMana ?? 0));

        actor.pv = Math.min(Math.max(0, Math.floor(actor.pv ?? 0)), effectiveMaxPv);
        (actor as any).currentMana = Math.min(Math.max(0, Math.floor((actor as any).currentMana ?? 0)), effectiveMaxMana);

        const maxPv = effectiveMaxPv;
        const pv = Math.min(maxPv, Math.max(1, Math.floor(actor.pv)));
        const attack = Math.max(1, Math.floor(actor.effectiveAttack ?? actor.baseAttack ?? 5));

        // Nouveau: plus de points de déplacement. Tout se fait aux points d'action.
        // 1 case déplacée = 1 PA.
        const cls = String((actor as any).characterClass ?? '').toLowerCase();
        const apMax = team === 'allies'
            ? (cls === 'voleur' ? 4 : 3) // guerrier & mage: 3, voleur: 4
            : Math.max(1, Math.floor(actor.actionPointsMax ?? 2));

        actor.actionPointsMax = apMax;
        actor.actionPoints = apMax;

        const speed = getBaseSpeedForActor(actor, team, enemyIndex);
        return {
            id,
            name: actor.name,
            team,
            pos,
            speed,
            pv,
            maxPv,
            actionPointsMax: apMax,
            actionPoints: apMax,
            attack,
            actor,
        };
    };


    // Positions de départ demandées:
    // - héros tout en bas
    // - ennemis en formation dédiée : archer en (4,0), guerrier 1 en (4,1), autres en y=1, x=5,6,7,8...
    // On aligne les 3 unités alliées sur une rangée, centrées.
    const allyPositions: Pos[] = [
        { x: 3, y: 8 },
        { x: 4, y: 8 },
        { x: 5, y: 8 },
    ];

    const enemyPositionForIndex = (i: number): Pos => {
        if (i === 0) return { x: 4, y: 0 }; // archer
        if (i === 1) return { x: 4, y: 1 }; // guerrier gobelin 1
        // suivants : x = 5,6,7,8,... (clamp à 8 pour rester dans un plateau 9x9)
        const x = Math.min(5 + (i - 2), 8);
        return { x, y: 1 };
    };

    const units: TacticalUnit[] = [
        // Alliés: rangée du bas
        mkUnit('ally-1', alliesActors[0] ?? new Player('Allié 1', 100, 100, 10, [], 50, true), 'allies', allyPositions[0] ?? { x: 3, y: 8 }),
        mkUnit('ally-2', alliesActors[1] ?? new Player('Allié 2', 100, 100, 10, [], 50, true), 'allies', allyPositions[1] ?? { x: 4, y: 8 }),
        mkUnit('ally-3', alliesActors[2] ?? new Player('Allié 3', 100, 100, 10, [], 50, true), 'allies', allyPositions[2] ?? { x: 5, y: 8 }),

        // Ennemis: formation spécifique
        ...enemies.map((e, i) => mkUnit(`enemy-${i + 1}`, e, 'enemies', enemyPositionForIndex(i), i + 1)),
    ];

    // Ordre de tour: par vitesse (initiative)
    const turnOrder = computeTurnOrder(units);

    return {
        width: 9,
        height: 9,
        units,
        turnOrder,
        // -1 so the first `advanceTurn()` selects turnOrder[0]
        turnIndex: -1,
        activeUnitId: null,
        // Canonical tactical mode: turn order determined by speed/initiative.
        turnMode: 'speed',
        log: [`Escarmouche plateau: 3 alliés vs ${enemyCount} ${enemyId}(s) (niv ${enemyLevel})`, "Ordre des tours: vitesse (initiative)."],
    };
}

// Compat: conserve l'ancien nom exporté (utilisé ailleurs)
export function createQuickSkirmishFromHero(hero: Player): TacticalState {
    return createQuickSkirmishFromParty([hero, hero, hero]);
}

export function getAliveUnits(state: TacticalState): TacticalUnit[] {
    return state.units.filter((u) => u.pv > 0);
}

export function getTeamAliveCount(state: TacticalState, team: Team): number {
    return state.units.filter((u) => u.team === team && u.pv > 0).length;
}

export function listReachableTiles(state: TacticalState, unitId: UnitId): Pos[] {
    const unit = getUnitById(state, unitId);
    if (!unit || unit.pv <= 0) return [];

    // Immobilisé: ne peut pas se déplacer (mais peut agir)
    if (unit.actor) {
        const fx = Array.isArray((unit.actor as any).activeEffects) ? ((unit.actor as any).activeEffects as any[]) : [];
        const rooted = fx.some((e) => String(e?.type ?? '') === 'root' && Number(e?.remainingTurns ?? 0) !== 0);
        if (rooted) return [];
    }

    const start = unit.pos;
    // Déplacement = coût en PA (1 case = 1 PA)
    const maxSteps = Math.max(0, Math.floor(unit.actionPoints));

    // BFS sur grille 4 directions
    const q: Array<{ pos: Pos; dist: number }> = [{ pos: start, dist: 0 }];
    const seen = new Set<string>([posKey(start)]);
    const out: Pos[] = [];

    while (q.length) {
        const cur = q.shift();
        if (!cur) break;

        if (cur.dist > 0) out.push(cur.pos);
        if (cur.dist >= maxSteps) continue;

        const nbs: Pos[] = [
            { x: cur.pos.x + 1, y: cur.pos.y },
            { x: cur.pos.x - 1, y: cur.pos.y },
            { x: cur.pos.x, y: cur.pos.y + 1 },
            { x: cur.pos.x, y: cur.pos.y - 1 },
        ];

        for (const nb of nbs) {
            if (!inBounds(state, nb)) continue;
            const k = posKey(nb);
            if (seen.has(k)) continue;
            // On peut traverser uniquement les cases libres
            if (isOccupied(state, nb)) continue;
            seen.add(k);
            q.push({ pos: nb, dist: cur.dist + 1 });
        }
    }

    return out;
}

export function tryMoveUnit(state: TacticalState, unitId: UnitId, dest: Pos): { ok: true } | { ok: false; message: string } {
    const unit = getUnitById(state, unitId);
    if (!unit || unit.pv <= 0) return { ok: false, message: 'Unité invalide.' };

    if (unit.actor) {
        const fx = Array.isArray((unit.actor as any).activeEffects) ? ((unit.actor as any).activeEffects as any[]) : [];
        const rooted = fx.some((e) => String(e?.type ?? '') === 'root' && Number(e?.remainingTurns ?? 0) !== 0);
        if (rooted) return { ok: false, message: 'Immobilisé: ne peut pas se déplacer.' };
    }
    if (!inBounds(state, dest)) return { ok: false, message: 'Hors plateau.' };
    if (isOccupied(state, dest)) return { ok: false, message: 'Case occupée.' };

    // Coût réel = longueur du plus court chemin (4 directions)
    const path = findShortestPath(state, unitId, dest);
    if (!path) return { ok: false, message: 'Chemin bloqué.' };

    const cost = Math.max(0, Math.floor(path.length));
    if (cost <= 0) return { ok: false, message: 'Déplacement invalide.' };
    if (cost > unit.actionPoints) return { ok: false, message: 'Pas assez de PA pour se déplacer.' };

    unit.pos = { x: dest.x, y: dest.y };
    unit.actionPoints = Math.max(0, unit.actionPoints - cost);
    if (unit.actor) unit.actor.actionPoints = unit.actionPoints;
    return { ok: true };
}

// Chemin le plus court (4 directions) entre la position de l'unité et la destination.
// Retourne une liste de positions à parcourir (sans inclure la case de départ), ou null si aucun chemin.
export function findShortestPath(state: TacticalState, unitId: UnitId, dest: Pos): Pos[] | null {
    const unit = getUnitById(state, unitId);
    if (!unit || unit.pv <= 0) return null;
    if (!inBounds(state, dest)) return null;
    if (isOccupied(state, dest)) return null;

    const start = unit.pos;
    const startK = posKey(start);
    const destK = posKey(dest);
    if (startK === destK) return [];

    const q: Pos[] = [start];
    const prev = new Map<string, string>();
    const seen = new Set<string>([startK]);

    while (q.length) {
        const cur = q.shift()!;
        const curK = posKey(cur);
        if (curK === destK) break;

        const nbs: Pos[] = [
            { x: cur.x + 1, y: cur.y },
            { x: cur.x - 1, y: cur.y },
            { x: cur.x, y: cur.y + 1 },
            { x: cur.x, y: cur.y - 1 },
        ];

        for (const nb of nbs) {
            if (!inBounds(state, nb)) continue;
            const k = posKey(nb);
            if (seen.has(k)) continue;
            if (isOccupied(state, nb)) continue;
            seen.add(k);
            prev.set(k, curK);
            q.push(nb);
        }
    }

    if (!seen.has(destK)) return null;

    const outRev: Pos[] = [];
    let curK: string | undefined = destK;
    while (curK && curK !== startK) {
        const [xStr, yStr] = curK.split(',');
        outRev.push({ x: Number(xStr), y: Number(yStr) });
        curK = prev.get(curK);
    }

    outRev.reverse();
    return outRev;
}

export function areAdjacent(a: Pos, b: Pos): boolean {
    return manhattan(a, b) === 1;
}

export function tryMeleeAttack(state: TacticalState, attackerId: UnitId, targetId: UnitId): { ok: true; damage: number } | { ok: false; message: string } {
    const attacker = getUnitById(state, attackerId);
    const target = getUnitById(state, targetId);
    if (!attacker || attacker.pv <= 0) return { ok: false, message: 'Attaquant invalide.' };
    if (!target || target.pv <= 0) return { ok: false, message: 'Cible invalide.' };
    if (attacker.team === target.team) return { ok: false, message: 'Cible alliée.' };
    if (!areAdjacent(attacker.pos, target.pos)) return { ok: false, message: 'Pas à portée (corps à corps).' };

    const atk = attacker.actor ? Math.floor(attacker.actor.effectiveAttack ?? attacker.actor.baseAttack ?? attacker.attack) : attacker.attack;
    const damage = Math.max(1, Math.floor(atk));
    target.pv = Math.max(0, target.pv - damage);
    return { ok: true, damage };
}

function resetUnitTurnResources(unit: TacticalUnit): void {
    unit.actionPoints = unit.actionPointsMax;
    if (unit.actor) {
        unit.actor.actionPointsMax = unit.actionPointsMax;
        unit.actor.actionPoints = unit.actionPointsMax;
        unit.actor.tickSkillCooldowns?.();
    }
}

export function startUnitTurn(state: TacticalState, unitId: UnitId): string[] {
    const unit = getUnitById(state, unitId);
    if (!unit || unit.pv <= 0) return [];

    resetUnitTurnResources(unit);

    const msgs: string[] = [];
    if (unit.actor) {
        // Début du tour: DoT/HoT + autres ticks
        const beforeActorPv = Math.max(0, Math.floor(unit.actor.pv));
        msgs.push(...(unit.actor.updateEffects?.() ?? []));
        const afterActorPv = Math.max(0, Math.floor(unit.actor.pv));

        // Adventure wound system: 20% of damage taken reduces max HP for the adventure duration.
        const dmgFromTicks = Math.max(0, beforeActorPv - afterActorPv);
        if ((state as any).__adventureMode && unit.team === 'allies' && dmgFromTicks > 0) {
            const wound = Math.max(0, Math.floor(dmgFromTicks * 0.2));
            if (wound > 0) {
                const prev = Math.max(0, Math.floor(Number((unit.actor as any).__adventureMaxHpPenalty ?? 0)));
                (unit.actor as any).__adventureMaxHpPenalty = prev + wound;
                unit.actor.maxPv = Math.max(1, Math.floor(Number(unit.actor.maxPv ?? 1) - wound));
                unit.actor.pv = Math.min(Math.max(0, Math.floor(Number(unit.actor.pv ?? 0))), unit.actor.maxPv);
            }
        }
        if (afterActorPv < beforeActorPv) {
            // marque l'effet récent pour le front-end (affichage de flash)
            (state as any).__lastUnitEffect = { unitId, kind: 'damage', amount: beforeActorPv - afterActorPv };
        } else if (afterActorPv > beforeActorPv) {
            (state as any).__lastUnitEffect = { unitId, kind: 'heal', amount: afterActorPv - beforeActorPv };
        }

        // Début du tour: régén mana/tour
        const before = unit.actor.currentMana;
        unit.actor.regenerateMana?.();
        if (unit.actor.currentMana !== before) {
            msgs.push(`${unit.actor.name} régénère du mana (Mana ${before} → ${unit.actor.currentMana})`);
        }

        // Étourdissement: au moment de jouer, le personnage passe automatiquement son tour.
        // (On consomme 1 charge d'étourdissement au début du tour.)
        const stunTurns = Math.max(0, Math.floor(Number((unit.actor as any).stunTurns ?? 0)));
        if (stunTurns > 0) {
            (unit.actor as any).stunTurns = stunTurns - 1;
            unit.actionPoints = 0;
            unit.actor.actionPoints = 0;
            // Marqueur consommé par les systèmes de tour/UI pour auto-avancer.
            (state as any).__autoPassActiveUnit = unitId;
            msgs.push(`${unit.actor.name} est étourdi et passe son tour.`);
        }

        // Sync stats visibles
        unit.pv = Math.max(0, Math.floor(unit.actor.pv));
        unit.maxPv = Math.max(1, Math.floor(unit.actor.maxPv));
        unit.actionPoints = Math.max(0, Math.floor(unit.actor.actionPoints));
        unit.actionPointsMax = Math.max(1, Math.floor(unit.actor.actionPointsMax));
    }
    return msgs;
}

export function endUnitTurn(state: TacticalState, unitId: UnitId): string[] {
    const unit = getUnitById(state, unitId);
    if (!unit || unit.pv <= 0) return [];
    if (!unit.actor) return [];

    const msgs = unit.actor.endTurnEffects?.() ?? [];
    // Sync PV au cas où des effets expirés changent la situation
    unit.pv = Math.max(0, Math.floor(unit.actor.pv));
    unit.maxPv = Math.max(1, Math.floor(unit.actor.maxPv));
    return msgs;
}

export function rotateToNextAlive(state: TacticalState): void {
    const alive = getAliveUnits(state);
    if (alive.length === 0) return;

    const order = (state.turnOrder && state.turnOrder.length ? state.turnOrder : state.units.map((u) => u.id)).slice();
    let idx = state.turnIndex;

    for (let i = 0; i < order.length; i++) {
        idx = (idx + 1) % order.length;
        const nextId = order[idx];
        const next = nextId ? getUnitById(state, nextId) : undefined;
        if (next && next.pv > 0) {
            state.turnIndex = idx;
            state.activeUnitId = next.id;
            return;
        }
    }
}

function pickNextAliveEnemyId(state: TacticalState): UnitId | null {
    const enemies = state.units.filter((u) => u.team === 'enemies');
    if (enemies.length === 0) return null;

    const acted = new Set<string>((state.enemiesActedIds ?? []).filter(Boolean));
    const start = Math.max(-1, Math.floor(Number(state.enemyTurnCursor ?? -1)));
    for (let i = 0; i < enemies.length; i++) {
        const idx = (start + 1 + i) % enemies.length;
        const u = enemies[idx];
        if (u && u.pv > 0 && !acted.has(u.id)) {
            state.enemyTurnCursor = idx;
            return u.id;
        }
    }
    return null;
}

function advanceTurnPickAlternate(state: TacticalState): string[] {
    const msgs: string[] = [];

    const curId = state.activeUnitId;
    const curUnit = curId ? getUnitById(state, curId) : undefined;
    if (curId) msgs.push(...endUnitTurn(state, curId));

    const alliesAliveIds = state.units.filter((u) => u.team === 'allies' && u.pv > 0).map((u) => u.id);
    const enemiesAliveIds = state.units.filter((u) => u.team === 'enemies' && u.pv > 0).map((u) => u.id);

    const alliesActed = new Set<string>((state.alliesActedIds ?? []).filter(Boolean));
    const enemiesActed = new Set<string>((state.enemiesActedIds ?? []).filter(Boolean));

    if (curUnit && curId) {
        if (curUnit.team === 'allies') alliesActed.add(curId);
        if (curUnit.team === 'enemies') enemiesActed.add(curId);
    }

    const remainingAllies = alliesAliveIds.filter((id) => !alliesActed.has(id));
    const remainingEnemies = enemiesAliveIds.filter((id) => !enemiesActed.has(id));

    // Cycle terminé ? (plus personne à jouer)
    if (remainingAllies.length === 0 && remainingEnemies.length === 0) {
        state.alliesActedIds = [];
        state.enemiesActedIds = [];
        state.sideToAct = 'allies';
        state.activeUnitId = null;
        msgs.push('Choisis un personnage pour jouer.');
        return msgs;
    }

    // Détermine le prochain camp: on alterne si possible (A/E/A/E...), sinon on laisse l'autre camp finir.
    let desired: Team = state.sideToAct ?? 'allies';
    if (curUnit) desired = curUnit.team === 'allies' ? 'enemies' : 'allies';

    const hasAllies = remainingAllies.length > 0;
    const hasEnemies = remainingEnemies.length > 0;
    let nextSide: Team;
    if (desired === 'allies') {
        nextSide = hasAllies ? 'allies' : 'enemies';
    } else {
        nextSide = hasEnemies ? 'enemies' : 'allies';
    }
    state.sideToAct = nextSide;

    // Persist acted trackers
    state.alliesActedIds = Array.from(alliesActed);
    state.enemiesActedIds = Array.from(enemiesActed);

    if (nextSide === 'allies') {
        state.activeUnitId = null;
        msgs.push('Choisis un personnage pour jouer.');
        return msgs;
    }

    // Tour ennemi: sélectionne un ennemi qui n'a pas encore joué dans le cycle.
    const enemyId = pickNextAliveEnemyId(state);
    if (!enemyId) {
        // Plus d'ennemis disponibles => les alliés finissent.
        state.sideToAct = 'allies';
        state.activeUnitId = null;
        msgs.push('Choisis un personnage pour jouer.');
        return msgs;
    }

    state.activeUnitId = enemyId;
    msgs.push(...startUnitTurn(state, enemyId));

    // Si l'ennemi est étourdi, il passe immédiatement et on avance.
    if ((state as any).__autoPassActiveUnit === enemyId) {
        (state as any).__autoPassActiveUnit = null;
        msgs.push(...advanceTurnPickAlternate(state));
    }
    return msgs;
}

export function advanceTurn(state: TacticalState): string[] {
    if ((state.turnMode ?? 'speed') === 'pick-alternate') {
        return advanceTurnPickAlternate(state);
    }

    const msgs: string[] = [];
    const curId = state.activeUnitId;
    if (curId) msgs.push(...endUnitTurn(state, curId));

    // Unité suivante. Si elle meurt au début de son tour (DoT/effets), on saute automatiquement.
    let safety = 0;
    while (safety < state.units.length + 2) {
        safety++;
        rotateToNextAlive(state);
        if (!state.activeUnitId) break;
        msgs.push(...startUnitTurn(state, state.activeUnitId));

        // Étourdissement (skip): on termine immédiatement le tour et on passe au suivant.
        if ((state as any).__autoPassActiveUnit === state.activeUnitId) {
            const sid = state.activeUnitId;
            (state as any).__autoPassActiveUnit = null;
            msgs.push(...endUnitTurn(state, sid));
            continue;
        }

        const active = getUnitById(state, state.activeUnitId);
        if (!active) break;
        if (active.pv > 0) break;
        if (getAliveUnits(state).length === 0) break;
    }
    return msgs;
}
