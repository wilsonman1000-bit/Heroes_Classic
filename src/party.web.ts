import { hero } from './index.web.js';
import { createSkill, type SkillId } from './skillLibrary.js';
import type { Skill } from './skill.js';
import type { Player, SpecializationCategory } from './player.js';
import { PASSIVE_DEFS, type PassiveId } from './passives.js';
import { ensureTitles } from './titles.js';

export type PartyIndex = 0 | 1 | 2;

type PartyMemberProgress = {
    characterClass: SpecializationCategory;
    learnedSkillIds: SkillId[];
    specializationPoints: Record<SpecializationCategory, number>;
    passiveSkills: PassiveId[];
    skillPoints: number;
    characteristicPoints: number;
    characteristics: any;
    lastSharedLevel: number;
};

type PartyMemberDef = {
    name: string;
    cls: SpecializationCategory;
};

const PARTY_DEFS: PartyMemberDef[] = [
    { name: 'Guerrier', cls: 'guerrier' },
    { name: 'Mage', cls: 'mage' },
    { name: 'Voleur', cls: 'voleur' },
];

// Persos en mémoire (runtime).
// IMPORTANT: lazy init pour éviter les soucis de dépendances circulaires (index.web <-> accueil <-> tacticalCombat <-> party).
let party: Player[] | null = null;

let selectedPartyIndex: PartyIndex = 0;

export function setSelectedPartyIndex(idx: PartyIndex): void {
    selectedPartyIndex = idx;
}

export function getSelectedPartyIndex(): PartyIndex {
    return selectedPartyIndex;
}

function uniqueById(ids: SkillId[]): SkillId[] {
    const out: SkillId[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
        const k = String(id);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(id);
    }
    return out;
}

function ensureParty(): Player[] {
    if (party) return party;
    party = PARTY_DEFS.map((d, idx) => {
        // Le guerrier (idx 0) est le "hero" canonique (inventaire/achats/sauvegarde).
        // Les autres sont des clones, mais avec inventaire/équipement propres.
        const p = idx === 0 ? (hero as Player) : hero.clone();

        if (idx !== 0) {
            // Empêche de dupliquer l'inventaire du héros sur les persos secondaires.
            p.inventory = [];
            // Équipement indépendant par perso (vide au départ)
            p.equipment = { weapon: undefined, armor: undefined, ring: undefined } as any;
        }

        // Ne pas forcer le nom du héros (conserve le nom choisi par le joueur)
        if (idx !== 0) p.name = d.name;

        (p as any).characterClass = d.cls;

        // Nouveau modèle d'attributs (fondamental):
        // PV max = santé * 10
        // Mana max = magie * 10
        // Mana regen / tour = énergie
        // Attaque = force
        // Vitesse = initiative (ordre des tours)
        // PA restent séparés (non liés aux caractéristiques)
        // Valeurs de départ demandées:
        // - Guerrier: 10 force, 10 santé, 2 vitesse, 40 magie, 40 énergie
        // - Voleur: 10 force, 8 santé, 2 vitesse, 40 magie, 40 énergie
        // - Mage: 10 force, 6 santé, 2 vitesse, 40 magie, 40 énergie
        const cls = String((p as any).characterClass ?? '').toLowerCase();
        const base = {
            force: 10,
            sante: cls === 'guerrier' ? 10 : cls === 'voleur' ? 8 : 6,
            vitesse: 2,
            magie: 10,
            energie: 40,
            critique: 0,
            defense: 0,
        };
        (p as any).characteristics = { ...(p as any).characteristics, ...base };
        p.syncDerivedStatsFromCharacteristics({ fillResources: true });
        // Progression indépendante par personnage (initialisée plus bas)
        (p as any).learnedSkillIds = (p as any).learnedSkillIds ?? ([] as SkillId[]);
        return p;
    });

    // Migration 1 fois: répartit ce qui existe déjà sur hero vers les persos.
    // - skills appris: dispatch par catégorie (guerrier/mage/voleur)
    // - specializationPoints: dispatch par catégorie
    // - skillPoints existants: mis sur le guerrier (idx 0) pour éviter de tripler artificiellement
    {
        const heroSpec = ((hero as any).specializationPoints ?? { guerrier: 0, mage: 0, voleur: 0 }) as Record<SpecializationCategory, number>;
        const heroSkills = (hero.skills ?? []) as Skill[];
        const heroPassives = ((hero.passiveSkills ?? []) as PassiveId[]) ?? [];

        const byCatMember: Record<SpecializationCategory, Player> = {
            guerrier: party[0]!,
            mage: party[1]!,
            voleur: party[2]!,
        };

        // Points de spé par catégorie
        for (const cat of ['guerrier', 'mage', 'voleur'] as SpecializationCategory[]) {
            const m = byCatMember[cat];
            (m as any).specializationPoints = { guerrier: 0, mage: 0, voleur: 0 };
            (m as any).specializationPoints[cat] = Math.max(0, Math.floor(heroSpec[cat] ?? 0));
        }

        // Skills appris: dispatch par catégorie
        for (const s of heroSkills) {
            const cat = (s as any).category as SpecializationCategory | undefined;
            const id = (s as any).skillId as SkillId | undefined;
            if (!cat || !id) continue;
            const m = byCatMember[cat];
            const list = ((m as any).learnedSkillIds ?? []) as SkillId[];
            if (!list.includes(id)) list.push(id);
            (m as any).learnedSkillIds = list;
        }

        // Passifs: dispatch par catégorie si possible (sinon sur guerrier)
        for (const pid of heroPassives) {
            const def = PASSIVE_DEFS[pid];
            const cat = (def as any)?.category as SpecializationCategory | undefined;
            const target = cat ? byCatMember[cat] : party[0]!;
            const list = (target.passiveSkills ?? []) as PassiveId[];
            if (!list.includes(pid)) list.push(pid);
            target.passiveSkills = list;
        }

        // Points de compétence: chaque perso a son pool indépendant.
        // Par défaut on duplique le pool actuel du héros sur chacun (logique “3 persos = 3 progressions”).
        for (const m of party) {
            m.skillPoints = Math.max(0, Math.floor(hero.skillPoints ?? 0));
        }

        // Les persos suivent le niveau du héros, mais chaque perso aura son propre pool de points
        for (const m of party) {
            (m as any).__lastSharedLevel = Math.max(1, Math.floor(hero.level ?? 1));
            m.level = Math.max(1, Math.floor(hero.level ?? 1));
        }
    }

    // Si une sauvegarde a déjà des progressions par perso (stockées sur le héros), on les applique.
    // (Reste rétro-compatible: si absent, on garde la migration ci-dessus.)
    {
        const saved = (hero as any).__partyProgress as PartyMemberProgress[] | undefined;
        if (Array.isArray(saved) && saved.length) {
            for (let i = 0; i < party.length; i++) {
                const m = party[i]!;
                const sp = saved[i];
                if (!sp) continue;

                (m as any).characterClass = sp.characterClass ?? (m as any).characterClass;
                (m as any).learnedSkillIds = (sp.learnedSkillIds ?? []).filter(Boolean);
                (m as any).specializationPoints = sp.specializationPoints ?? (m as any).specializationPoints;
                m.passiveSkills = (sp.passiveSkills ?? []).filter(Boolean) as PassiveId[];
                m.skillPoints = Math.max(0, Math.floor(sp.skillPoints ?? m.skillPoints ?? 0));
                (m as any).characteristicPoints = Math.max(0, Math.floor(sp.characteristicPoints ?? (m as any).characteristicPoints ?? 0));
                if (sp.characteristics) (m as any).characteristics = { ...(m as any).characteristics, ...sp.characteristics };
                (m as any).__lastSharedLevel = Math.max(1, Math.floor(sp.lastSharedLevel ?? (m as any).__lastSharedLevel ?? hero.level ?? 1));
            }
        }
    }

    return party;
}

function computePartySkillIdsFromMemberLearned(member: Player, cls: SpecializationCategory): SkillId[] {
    const ids: SkillId[] = [];


    // Compétences de base par classe.
    // Important: on garde toujours `basic_attack` pour que le plateau ait une attaque par défaut.
    const classBaseSkills = (() => {
        if (cls === 'mage') return ['missile_magique', 'couteau_magique', 'mana_gain', 'eclair', 'teleportation'] as SkillId[];
        if (cls === 'voleur') return ['basic_attack', 'shuriken', 'mana_gain', 'mouvement_de_fou'] as SkillId[];
        // guerrier
        return ['basic_attack', 'block', 'charge', 'lancer_ennemi'] as SkillId[];
    })();
    for (const sid of classBaseSkills) ids.push(sid);

    // Les compétences apprises sont stockées sur le membre (indépendant).
    const learned = (((member as any).learnedSkillIds ?? []) as SkillId[]).filter(Boolean);
    for (const skillId of learned) ids.push(skillId);

    return uniqueById(ids);
}

function syncPartyStatsFromHeroBase(): void {
    const members = ensureParty();
    // IMPORTANT: les persos ont désormais une progression indépendante (caractéristiques, points, passifs...)
    // On ne synchronise plus les stats de combat depuis le héros. On ne garde que quelques infos partagées
    // (niveau, or/bois, équipement) pour éviter de refactor tout le système de sauvegarde/progression.

    const clamp0100 = (n: unknown): number => {
        const v = Math.floor(Number(n ?? 0));
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, Math.min(100, v));
    };

    (hero as any).honneur = clamp0100((hero as any).honneur);
    (hero as any).liberte = clamp0100((hero as any).liberte);
    (hero as any).humanite = clamp0100((hero as any).humanite);
    ensureTitles(hero as any);

    for (const member of members) {
        // Infos partagées
        member.level = hero.level;
        member.currentXP = hero.currentXP;
        member.gold = hero.gold;
        member.wood = hero.wood;
        member.herb = hero.herb;

        // Valeurs partagées du groupe
        (member as any).honneur = (hero as any).honneur;
        (member as any).liberte = (hero as any).liberte;
        (member as any).humanite = (hero as any).humanite;
        (member as any).titles = (hero as any).titles;

        // Clamp PV / Mana sur leurs maxima effectifs (sans écraser les valeurs propres du perso)
        const effHp = Math.max(1, Math.floor(member.effectiveMaxPv));
        member.pv = Math.max(0, Math.min(Math.floor(member.pv ?? 0), effHp));
        const effMana = Math.max(0, Math.floor(member.effectiveMaxMana));
        member.currentMana = Math.max(0, Math.min(Math.floor(member.currentMana ?? 0), effMana));
    }
}

function syncPartyPointsFromLevelUps(): void {
    const members = ensureParty();
    const sharedLevel = Math.max(1, Math.floor(hero.level ?? 1));
    for (const member of members) {
        // Le héros (guerrier) reçoit déjà ses points via `hero.gainXP()`.
        // Ici on ne doit pas lui redonner le delta une 2e fois.
        if (member === (hero as any)) {
            (member as any).__lastSharedLevel = sharedLevel;
            member.level = sharedLevel;
            continue;
        }
        const last = Math.max(1, Math.floor((member as any).__lastSharedLevel ?? member.level ?? sharedLevel));
        const delta = Math.max(0, sharedLevel - last);
        if (delta > 0) {
            // Chaque perso gagne ses points indépendamment à chaque niveau
            member.skillPoints = Math.max(0, Math.floor(member.skillPoints ?? 0)) + delta;
            member.characteristicPoints = Math.max(0, Math.floor((member as any).characteristicPoints ?? 0)) + delta;
            (member as any).__lastSharedLevel = sharedLevel;
        }
        member.level = sharedLevel;
    }
}

function syncPartySkillsFromProgress(): void {
    const members = ensureParty();
    for (let i = 0; i < members.length; i++) {
        const member = members[i]!;
        const cls = ((member as any).characterClass ?? PARTY_DEFS[i]?.cls ?? 'guerrier') as SpecializationCategory;
        const ids = computePartySkillIdsFromMemberLearned(member, cls);
        member.skills = ids.map((id) => {
            return createSkill(id);
        });
    }
}

function syncPartyProgressSnapshotToHero(): void {
    const members = ensureParty();
    const progress: PartyMemberProgress[] = members.map((m, idx) => {
        const cls = ((m as any).characterClass ?? PARTY_DEFS[idx]?.cls ?? 'guerrier') as SpecializationCategory;
        return {
            characterClass: cls,
            learnedSkillIds: (((m as any).learnedSkillIds ?? []) as SkillId[]).filter(Boolean),
            specializationPoints: ((m as any).specializationPoints ?? { guerrier: 0, mage: 0, voleur: 0 }) as Record<SpecializationCategory, number>,
            passiveSkills: ((m.passiveSkills ?? []) as PassiveId[]).filter(Boolean),
            skillPoints: Math.max(0, Math.floor(m.skillPoints ?? 0)),
            characteristicPoints: Math.max(0, Math.floor((m as any).characteristicPoints ?? 0)),
            characteristics: (m as any).characteristics ?? undefined,
            lastSharedLevel: Math.max(1, Math.floor((m as any).__lastSharedLevel ?? hero.level ?? 1)),
        };
    });
    (hero as any).__partyProgress = progress;
}

export function getPartyMembers(): Player[] {
    ensureParty();
    syncPartyPointsFromLevelUps();
    syncPartyStatsFromHeroBase();
    syncPartySkillsFromProgress();
    syncPartyProgressSnapshotToHero();
    return party!;
}

export function getPartyMember(idx: PartyIndex): Player {
    return getPartyMembers()[idx]!;
}

export function getPartyClassLabel(p: Player): string {
    const cls = String((p as any).characterClass ?? '').toLowerCase();
    if (cls === 'mage') return 'Mage';
    if (cls === 'voleur') return 'Voleur';
    return 'Guerrier';
}

export function listPartySkills(p: Player): Skill[] {
    return ((p.skills ?? []) as Skill[]).filter(Boolean);
}
