export type SkillType = 'damage' | 'heal' | 'buff' | 'debuff' | 'dot' | 'hot' | 'defense' | 'mana';

export type PassiveId =
    | 'vigueur'
    | 'concentration'
    | 'entrainement'
    | 'maitrise_destruction'
    | 'flux_de_mana'
    | 'assassin_poison_crit'
    | 'assassin_combo'
    | 'blocage_voleur'
    | 'blocage_guerrier'
    | 'blocage_mage';

export type PassiveBonuses = {
    maxPvFlat?: number;
    maxManaFlat?: number;
    attackFlat?: number;
    // Multiplie la valeur finale (ex: dégâts, soins, DoT/HoT)
    skillTypeMultiplier?: Partial<Record<SkillType, number>>;
    // Bonus de régénération de mana appliqué à la regen "par tour" existante
    manaRegenPerTurnFlat?: number;
};

export type PassiveDef = {
    id: PassiveId;
    name: string;
    description: string;
    unlockLevel: number;
    costSkillPoints: number;
    // Catégorie du passif (sert à augmenter les points de catégorie quand on le prend)
    category?: 'guerrier' | 'mage' | 'voleur';
    // Pré-requis de points dans la même catégorie (optionnel)
    requiredCategoryPoints?: number;
    bonuses: PassiveBonuses;
    // Groupe d'exclusivité : si un passif de ce groupe est appris, les autres du même groupe sont bloqués.
    exclusiveGroup?: string;
};

export const BLOCK_STYLE_PASSIVES: readonly PassiveId[] = ['blocage_voleur', 'blocage_guerrier', 'blocage_mage'] as const;

export const PASSIVE_DEFS: Record<PassiveId, PassiveDef> = {
    vigueur: {
        id: 'vigueur',
        name: 'Vigueur',
        description: '+20 PV max.',
        unlockLevel: 2,
        costSkillPoints: 1,
        category: 'guerrier',
        bonuses: { maxPvFlat: 20 },
    },
    concentration: {
        id: 'concentration',
        name: 'Concentration',
        description: '+20 mana max.',
        unlockLevel: 3,
        costSkillPoints: 1,
        category: 'mage',
        bonuses: { maxManaFlat: 20 },
    },
    entrainement: {
        id: 'entrainement',
        name: "Entraînement",
        description: '+3 attaque.',
        unlockLevel: 4,
        costSkillPoints: 1,
        category: 'guerrier',
        bonuses: { attackFlat: 3 },
    },
    maitrise_destruction: {
        id: 'maitrise_destruction',
        name: 'Maîtrise (dégâts)',
        description: '+10% dégâts des compétences offensives (damage + dot).',
        unlockLevel: 5,
        costSkillPoints: 1,
        category: 'mage',
        requiredCategoryPoints: 2,
        bonuses: { skillTypeMultiplier: { damage: 1.1, dot: 1.1 } },
    },
    flux_de_mana: {
        id: 'flux_de_mana',
        name: 'Flux de mana',
        description: '+5 mana régénéré par tour.',
        unlockLevel: 6,
        costSkillPoints: 1,
        category: 'mage',
        requiredCategoryPoints: 2,
        bonuses: { manaRegenPerTurnFlat: 5 },
    },

    assassin_poison_crit: {
        id: 'assassin_poison_crit',
        name: 'Lames empoisonnées',
        description: 'Chaque coup critique applique Poison (même effet que la compétence Poison).',
        // Principalement appris via l’arbre de talents (Assassin T1).
        unlockLevel: 10,
        costSkillPoints: 1,
        category: 'voleur',
        bonuses: {},
    },

    assassin_combo: {
        id: 'assassin_combo',
        name: 'Combo',
        description: "Chaque attaque sur un ennemi augmente de +10% votre chance de coup critique contre cet ennemi jusqu'à la fin de votre tour.",
        // Principalement appris via l’arbre de talents (Assassin T1).
        unlockLevel: 10,
        costSkillPoints: 1,
        category: 'voleur',
        bonuses: {},
    },

    blocage_voleur: {
        id: 'blocage_voleur',
        name: 'Blocage de voleur',
        description: 'Blocage réduit à 33% au lieu de 50%, coûte 1 PA et 10 mana.',
        unlockLevel: 2,
        costSkillPoints: 1,
        category: 'voleur',
        bonuses: {},
        exclusiveGroup: 'blocage_style',
    },
    blocage_guerrier: {
        id: 'blocage_guerrier',
        name: 'Blocage de guerrier',
        description: 'Quand Blocage est actif, renvoie les dégâts reçus à l’attaquant.',
        unlockLevel: 2,
        costSkillPoints: 1,
        category: 'guerrier',
        bonuses: {},
        exclusiveGroup: 'blocage_style',
    },
    blocage_mage: {
        id: 'blocage_mage',
        name: 'Blocage de mage',
        description: 'Blocage coûte -10 mana (vous gagnez 10 mana en le lançant).',
        unlockLevel: 2,
        costSkillPoints: 1,
        category: 'mage',
        bonuses: {},
        exclusiveGroup: 'blocage_style',
    },
};

export function mergePassiveBonuses(learned: PassiveId[]): Required<PassiveBonuses> {
    const merged: Required<PassiveBonuses> = {
        maxPvFlat: 0,
        maxManaFlat: 0,
        attackFlat: 0,
        skillTypeMultiplier: {},
        manaRegenPerTurnFlat: 0,
    };

    for (const id of learned) {
        const def = PASSIVE_DEFS[id];
        if (!def) continue;
        const b = def.bonuses;
        merged.maxPvFlat += b.maxPvFlat ?? 0;
        merged.maxManaFlat += b.maxManaFlat ?? 0;
        merged.attackFlat += b.attackFlat ?? 0;
        merged.manaRegenPerTurnFlat += b.manaRegenPerTurnFlat ?? 0;

        if (b.skillTypeMultiplier) {
            for (const [k, v] of Object.entries(b.skillTypeMultiplier) as Array<[SkillType, number]>) {
                merged.skillTypeMultiplier[k] = (merged.skillTypeMultiplier[k] ?? 1) * v;
            }
        }
    }

    return merged;
}
