export type TalentPassiveNodeDef = {
    id: string;
    name: string;
    description: string;
    // If set, only one passive per group can be learned.
    exclusiveGroup?: string;
    // If set, learning this talent node grants a real passive from PASSIVE_DEFS.
    grantsPassiveId?: string;
};

// Guerrier / Spécialisations
// Tier/étage numbering in the talent tree starts at 1.
export const PASSIVE_CHARGE_DAMAGE_BOOST_NODE_ID = 'passive.guerrier.barbare.t1.p0';
export const PASSIVE_CHARGE_STUN_TRAVERSED_NODE_ID = 'passive.guerrier.gladiateur.t1.p0';

// Core passives (ring): top middle node for Guerrier.
export const PASSIVE_WARRIOR_BLOCK_CORE_NODE_ID = 'passive.guerrier.core.p1';

// Voleur / Assassin
export const PASSIVE_ASSASSIN_POISON_ON_CRIT_NODE_ID = 'passive.voleur.assassin.t1.p0';
export const PASSIVE_ASSASSIN_COMBO_NODE_ID = 'passive.voleur.assassin.t1.p1';

export const TALENT_PASSIVE_NODE_DEFS: Record<string, TalentPassiveNodeDef> = {
    [PASSIVE_WARRIOR_BLOCK_CORE_NODE_ID]: {
        id: PASSIVE_WARRIOR_BLOCK_CORE_NODE_ID,
        name: 'Blocage de guerrier',
        description: "Quand Blocage est actif, renvoie les dégâts reçus à l’attaquant.",
        grantsPassiveId: 'blocage_guerrier',
    },
    [PASSIVE_CHARGE_DAMAGE_BOOST_NODE_ID]: {
        id: PASSIVE_CHARGE_DAMAGE_BOOST_NODE_ID,
        name: 'Charge brutale',
        description: "Modifie Charge: après le déplacement, +50% dégâts jusqu'à la fin du tour.",
    },
    [PASSIVE_CHARGE_STUN_TRAVERSED_NODE_ID]: {
        id: PASSIVE_CHARGE_STUN_TRAVERSED_NODE_ID,
        name: 'Charge écrasante',
        description: "Modifie Charge: l'ennemi traversé est étourdi (1 tour) au début de son prochain tour.",
    },

    [PASSIVE_ASSASSIN_POISON_ON_CRIT_NODE_ID]: {
        id: PASSIVE_ASSASSIN_POISON_ON_CRIT_NODE_ID,
        name: 'Lames empoisonnées',
        description: 'Sur un coup critique, applique Poison à la cible (même effet que la compétence Poison).',
        grantsPassiveId: 'assassin_poison_crit',
    },

    [PASSIVE_ASSASSIN_COMBO_NODE_ID]: {
        id: PASSIVE_ASSASSIN_COMBO_NODE_ID,
        name: 'Combo',
        description: "Chaque attaque sur un ennemi augmente de +10% votre chance de coup critique contre cet ennemi jusqu'à la fin de votre tour.",
        grantsPassiveId: 'assassin_combo',
    },
};

export function hasLearnedTalentPassiveNode(actor: any, nodeId: string): boolean {
    const ids = ((actor as any)?.talentTreeState?.learnedPassiveNodeIds ?? []) as unknown;
    return Array.isArray(ids) && ids.includes(nodeId);
}

export function getTalentPassiveNodeDef(nodeId: string): TalentPassiveNodeDef | null {
    return TALENT_PASSIVE_NODE_DEFS[nodeId] ?? null;
}

export function getLearnedTalentPassiveNodeIds(actor: any): string[] {
    const ids = ((actor as any)?.talentTreeState?.learnedPassiveNodeIds ?? []) as unknown;
    return Array.isArray(ids) ? (ids as string[]) : [];
}
