import { Player } from './player.js';
import {
    BuffSkill,
    Damageskill,
    DebuffSkill,
    DefenseSkill,
    DoTSkill,
    Healskill,
    HoTSkill,
    LifeDrainSkill,
    ManaSkill,
    ManaRegenBuffSkill,
    ManaRegenDebuffSkill,
    Skill,
    VulnerabilitySkill,
} from './skill.js';
import { Consumable, type ConsumableEffect, Equipment, type EquipmentSlot, Item } from './item.js';

const SAVE_STORAGE_KEY = 'rpg.save.v1';
const SAVE_VERSION = 1 as const;

type ActiveEffectSaveV1 = {
    type: 'buff' | 'debuff' | 'dot' | 'hot' | 'defense' | 'mana_regen' | 'vulnerability' | 'pa_loss' | 'pa_gain' | 'ap_max' | 'root';
    amount: number;
    remainingTurns: number;
    remainingHits?: number;
};

type SkillSaveV1 =
    | {
          type: 'damage';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
          damage: number;
          lifeDrain?: true;
      }
    | {
          type: 'heal';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
          heal: number;
      }
    | {
          type: 'buff';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
          buffAmount: number;
          duration: number;
      }
    | {
          type: 'debuff';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
          debuffAmount: number;
          duration: number;
      }
    | {
          type: 'vulnerability';
          key: string;
          description: string;
          name: string;
          manaCost: number;
          actionPoints?: number;
          vulnerabilityAmount: number;
          duration: number;
          hits: number;
      }
    | {
          type: 'dot';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
          damagePerTurn: number;
          duration: number;
      }
    | {
          type: 'hot';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
          healPerTurn: number;
          duration: number;
      }
    | {
          type: 'defense';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
          defenseAmount: number;
          duration: number;
      }
        | {
                    type: 'mana_regen_buff';
                    key: string;
                    description: string;
                    name: string;
                    manaCost: number;
                    actionPoints?: number;
                    manaRegenAmount: number;
                    duration: number;
            }
        | {
                    type: 'mana_regen_debuff';
                    key: string;
                    description: string;
                    name: string;
                    manaCost: number;
                    actionPoints?: number;
                    manaRegenPenalty: number;
                    duration: number;
            }
    | {
          type: 'mana';
          key: string;
          description: string;
          name: string;
          manaCost: number;
                    actionPoints?: number;
      };

type ItemSaveV1 =
    | {
          type: 'consumable';
          id: string;
          name: string;
          description: string;
          effect: ConsumableEffect;
          amount: number;
                    quantity?: number;
          fabricationScore?: number;
          fabricationQuality?: number;
      }
    | {
          type: 'equipment';
          id: string;
          name: string;
          description: string;
          slot: EquipmentSlot;
          attackBonus: number;
          defenseBonus: number;
          hpBonus: number;
          manaBonus: number;
            critBonus?: number;
                    quantity?: number;
          fabricationScore?: number;
          fabricationQuality?: number;
      }
    | {
          type: 'item';
          id: string;
          name: string;
          description: string;
          usable: boolean;
                    quantity?: number;
          fabricationScore?: number;
          fabricationQuality?: number;
      };

type MarketSlotSaveV1 = {
    item: ItemSaveV1;
    price: number;
    listedDay: number;
    basePrice: number;
};

type MarketHistoryEntrySaveV1 = {
    day: number;
    item: ItemSaveV1;
    price: number;
};

type MarketSaveV1 = {
    slots: Array<MarketSlotSaveV1 | null>; // fixed length (3)
    pendingGold: number;
    history: MarketHistoryEntrySaveV1[];
    unsold?: Array<MarketSlotSaveV1>; // items not sold, waiting to be retrieved
};

type HeroSaveV1 = {
    // Global game day (structural time system)
    day?: number;
    // Hour within the day (0-23)
    hour?: number;

    // Party-shared values (0..100)
    honneur?: number;
    liberte?: number;
    humanite?: number;

    // Party-shared titles
    titles?: string[];

	// World map: encounters defeated on a given day (mapId -> token -> day)
	worldEncounterDefeats?: Record<string, Record<string, number>>;
    name: string;
    pv: number;
    maxPv: number;
    baseAttack: number;
    maxMana: number;
    currentMana: number;
    manaRegenPerTurn: number;
    level: number;
    currentXP: number;
    gold: number;
    wood: number;
    herb: number;
    cuir: number;
    fer: number;
    skillPoints: number;
    // Compétences apprises (ids stables) – utilisé par le système de party/plateau.
    learnedSkillIds?: string[];
    specializationPoints?: Partial<{
        guerrier: number;
        mage: number;
        voleur: number;
    }>;
    // Passifs appris (ids)
    passiveSkills?: string[];
    // Progression par personnage (guerrier/mage/voleur) pour le jeu plateau.
    partyProgress?: Array<{
        characterClass: 'guerrier' | 'mage' | 'voleur';
        learnedSkillIds: string[];
        specializationPoints?: Partial<{
            guerrier: number;
            mage: number;
            voleur: number;
        }>;
        passiveSkills?: string[];
        skillPoints: number;
        characteristicPoints?: number;
        characteristics?: Partial<{
            force: number;
            sante: number;
            energie: number;
            // Backwards-compatible: anciennes sauvegardes
            puissance?: number;
            magie: number;
            vitesse: number;
            connaissance: number;
            critique: number;
            defense: number;
        }>;
        lastSharedLevel?: number;
    }>;
    characteristicPoints?: number;
    characteristics?: Partial<{
        force: number;
        sante: number;
        energie: number;
        // Backwards-compatible: anciennes sauvegardes
        puissance?: number;
        magie: number;
        vitesse: number;
        connaissance: number;
        critique: number;
        defense: number;
    }>;
    activeEffects: ActiveEffectSaveV1[];
    quests?: Record<
        string,
        {
            status: 'active' | 'completed' | 'claimed';
            stepIndex: number;
            objectives: Record<string, number>;
        }
    >;
    // Solved puzzles / énigmes (id => true)
    enigmes?: Record<string, boolean>;
    skills: SkillSaveV1[];
    inventory: ItemSaveV1[];
    equipment: Partial<Record<EquipmentSlot, ItemSaveV1 & { type: 'equipment' }>>;

    // Marché (vente joueur): 3 slots, argent à collecter, historique
    marketDay?: number;
    market?: MarketSaveV1;
};

function clampInt(n: unknown, min = 0): number {
    const v = Math.floor(Number(n ?? 0));
    if (!Number.isFinite(v)) return min;
    return Math.max(min, v);
}

function serializeMarket(market: unknown): MarketSaveV1 | undefined {
    if (!market || typeof market !== 'object') return undefined;
    const m = market as any;
    const rawSlots = Array.isArray(m.slots) ? (m.slots as any[]) : [];
    const slots: Array<MarketSlotSaveV1 | null> = [0, 1, 2].map((i) => {
        const s = rawSlots[i];
        if (!s || typeof s !== 'object') return null;
        const item = s.item as Item | undefined;
        if (!item) return null;
        return {
            item: serializeItem(item),
            price: clampInt(s.price, 0),
            listedDay: clampInt(s.listedDay, 1),
            basePrice: clampInt(s.basePrice, 1),
        };
    });

    const rawHistory = Array.isArray(m.history) ? (m.history as any[]) : [];
    const history: MarketHistoryEntrySaveV1[] = rawHistory
        .filter(Boolean)
        .slice(-200)
        .map((h) => {
            const item = h?.item as Item | undefined;
            if (!item) return null;
            return {
                day: clampInt(h?.day, 1),
                item: serializeItem(item),
                price: clampInt(h?.price, 0),
            };
        })
        .filter(Boolean) as MarketHistoryEntrySaveV1[];

    const rawUnsold = Array.isArray(m.unsold) ? (m.unsold as any[]) : [];
    const unsold: MarketSlotSaveV1[] = rawUnsold
        .filter(Boolean)
        .slice(-50)
        .map((s) => {
            const item = s?.item as Item | undefined;
            if (!item) return null;
            return {
                item: serializeItem(item),
                price: clampInt(s?.price, 0),
                listedDay: clampInt(s?.listedDay, 1),
                basePrice: clampInt(s?.basePrice, 1),
            };
        })
        .filter(Boolean) as MarketSlotSaveV1[];

    return {
        slots,
        pendingGold: clampInt(m.pendingGold, 0),
        history,
        ...(unsold.length ? { unsold } : {}),
    };
}

function deserializeMarket(data: unknown): {
    slots: Array<{ item: Item; price: number; listedDay: number; basePrice: number } | null>;
    pendingGold: number;
    history: Array<{ day: number; item: Item; price: number }>;
    unsold: Array<{ item: Item; price: number; listedDay: number; basePrice: number }>;
} | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const m = data as any;
    const rawSlots = Array.isArray(m.slots) ? (m.slots as any[]) : [];
    const slots = [0, 1, 2].map((i) => {
        const s = rawSlots[i];
        if (!s || typeof s !== 'object') return null;
        if (!s.item) return null;
        return {
            item: deserializeItem(s.item as ItemSaveV1),
            price: clampInt(s.price, 0),
            listedDay: clampInt(s.listedDay, 1),
            basePrice: clampInt(s.basePrice, 1),
        };
    });

    const rawHistory = Array.isArray(m.history) ? (m.history as any[]) : [];
    const history = rawHistory
        .filter(Boolean)
        .slice(-200)
        .map((h) => {
            if (!h?.item) return null;
            return {
                day: clampInt(h.day, 1),
                item: deserializeItem(h.item as ItemSaveV1),
                price: clampInt(h.price, 0),
            };
        })
        .filter(Boolean) as Array<{ day: number; item: Item; price: number }>;

    const rawUnsold = Array.isArray(m.unsold) ? (m.unsold as any[]) : [];
    const unsold = rawUnsold
        .filter(Boolean)
        .slice(-50)
        .map((s) => {
            if (!s?.item) return null;
            return {
                item: deserializeItem(s.item as ItemSaveV1),
                price: clampInt(s.price, 0),
                listedDay: clampInt(s.listedDay, 1),
                basePrice: clampInt(s.basePrice, 1),
            };
        })
        .filter(Boolean) as Array<{ item: Item; price: number; listedDay: number; basePrice: number }>;

    return {
        slots,
        pendingGold: clampInt(m.pendingGold, 0),
        history,
        unsold,
    };
}

type SaveDataV1 = {
    version: typeof SAVE_VERSION;
    createdAt: string;
    hero: HeroSaveV1;
};

function safeJsonParse(text: string): unknown {
    return JSON.parse(text) as unknown;
}

function serializeSkill(skill: Skill): SkillSaveV1 {
    if (skill instanceof LifeDrainSkill) {
        return {
            type: 'damage',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            damage: skill.damage,
            lifeDrain: true,
        };
    }
    if (skill instanceof Damageskill) {
        return {
            type: 'damage',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            damage: skill.damage,
        };
    }
    if (skill instanceof Healskill) {
        return {
            type: 'heal',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            heal: skill.heal,
        };
    }
    if (skill instanceof BuffSkill) {
        return {
            type: 'buff',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            buffAmount: skill.buffAmount,
            duration: skill.duration,
        };
    }
    if (skill instanceof VulnerabilitySkill) {
        return {
            type: 'vulnerability',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            vulnerabilityAmount: skill.vulnerabilityAmount,
            duration: skill.duration,
            hits: skill.hits,
        };
    }
    if (skill instanceof DebuffSkill) {
        return {
            type: 'debuff',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            debuffAmount: skill.debuffAmount,
            duration: skill.duration,
        };
    }
    if (skill instanceof DoTSkill) {
        return {
            type: 'dot',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            damagePerTurn: skill.damagePerTurn,
            duration: skill.duration,
        };
    }
    if (skill instanceof HoTSkill) {
        return {
            type: 'hot',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            healPerTurn: skill.healPerTurn,
            duration: skill.duration,
        };
    }
    if (skill instanceof DefenseSkill) {
        return {
            type: 'defense',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            defenseAmount: skill.defenseAmount,
            duration: skill.duration,
        };
    }
    if (skill instanceof ManaRegenBuffSkill) {
        return {
            type: 'mana_regen_buff',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            manaRegenAmount: skill.manaRegenAmount,
            duration: skill.duration,
        };
    }
    if (skill instanceof ManaRegenDebuffSkill) {
        return {
            type: 'mana_regen_debuff',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
            manaRegenPenalty: skill.manaRegenPenalty,
            duration: skill.duration,
        };
    }
    if (skill instanceof ManaSkill) {
        return {
            type: 'mana',
            key: skill.key,
            description: skill.description,
            name: skill.name,
            manaCost: skill.manaCost,
            actionPoints: skill.actionPoints,
        };
    }

    // fallback safe: treat as mana-like
    return {
        type: 'mana',
        key: skill.key,
        description: skill.description,
        name: skill.name,
        manaCost: skill.manaCost,
        actionPoints: (skill as any).actionPoints,
    };
}

function deserializeSkill(data: SkillSaveV1): Skill {
    switch (data.type) {
        case 'damage':
            return data.lifeDrain
                ? new LifeDrainSkill(data.key, data.description, data.name, data.damage, data.manaCost, data.actionPoints ?? 1)
                : new Damageskill(data.key, data.description, data.name, data.damage, data.manaCost, data.actionPoints ?? 1);
        case 'heal':
            return new Healskill(data.key, data.description, data.name, data.heal, data.manaCost, data.actionPoints ?? 1);
        case 'buff':
            return new BuffSkill(data.key, data.description, data.name, data.buffAmount, data.duration, data.manaCost, data.actionPoints ?? 1);
        case 'debuff':
            return new DebuffSkill(data.key, data.description, data.name, data.debuffAmount, data.duration, data.manaCost, data.actionPoints ?? 1);
        case 'vulnerability':
            return new VulnerabilitySkill(
                data.key,
                data.description,
                data.name,
                data.vulnerabilityAmount,
                data.duration,
                data.hits,
                data.manaCost,
                data.actionPoints ?? 1
            );
        case 'dot':
            return new DoTSkill(data.key, data.description, data.name, data.damagePerTurn, data.duration, data.manaCost, data.actionPoints ?? 1);
        case 'hot':
            return new HoTSkill(data.key, data.description, data.name, data.healPerTurn, data.duration, data.manaCost, data.actionPoints ?? 1);
        case 'defense':
            return new DefenseSkill(data.key, data.description, data.name, data.defenseAmount, data.duration, data.manaCost, data.actionPoints ?? 1);
        case 'mana_regen_buff':
            return new ManaRegenBuffSkill(
                data.key,
                data.description,
                data.name,
                data.manaRegenAmount,
                data.duration,
                data.manaCost,
                data.actionPoints ?? 1
            );
        case 'mana_regen_debuff':
            return new ManaRegenDebuffSkill(
                data.key,
                data.description,
                data.name,
                data.manaRegenPenalty,
                data.duration,
                data.manaCost,
                data.actionPoints ?? 1
            );
        case 'mana':
            // Backward-compat: older saves stored special skills as "mana".
            if (data.name === 'Buff de regen mana') {
                return new ManaRegenBuffSkill(data.key, data.description, data.name, 10, 3, data.manaCost, data.actionPoints ?? 2);
            }
            return new ManaSkill(data.key, data.description, data.name, data.manaCost, data.actionPoints ?? 1);
    }
}

function serializeItem(item: Item): ItemSaveV1 {
    if (item instanceof Consumable) {
        return {
            type: 'consumable',
            id: item.id,
            name: item.name,
            description: item.description,
            effect: item.effect,
            amount: item.amount,
            quantity: (item as any).quantity ?? 1,
            fabricationScore: (item as any).fabricationScore ?? undefined,
            fabricationQuality: (item as any).fabricationQuality ?? undefined,
        };
    }
    if (item instanceof Equipment) {
        return {
            type: 'equipment',
            id: item.id,
            name: item.name,
            description: item.description,
            slot: item.slot,
            attackBonus: item.attackBonus,
            defenseBonus: item.defenseBonus,
            hpBonus: item.hpBonus,
            manaBonus: item.manaBonus,
            critBonus: (item as any).critBonus ?? 0,
            quantity: (item as any).quantity ?? 1,
            fabricationScore: (item as any).fabricationScore ?? undefined,
            fabricationQuality: (item as any).fabricationQuality ?? undefined,
        };
    }
    return {
        type: 'item',
        id: item.id,
        name: item.name,
        description: item.description,
        usable: item instanceof Consumable,
        quantity: (item as any).quantity ?? 1,
        fabricationScore: (item as any).fabricationScore ?? undefined,
        fabricationQuality: (item as any).fabricationQuality ?? undefined,
    };
}

function deserializeItem(data: ItemSaveV1): Item {
    const q = Math.max(1, Math.floor(Number((data as any).quantity ?? 1)));
    switch (data.type) {
        case 'consumable':
        const c = new Consumable(data.id, data.name, data.description, data.effect, data.amount, q);
        (c as any).fabricationScore = (data as any).fabricationScore ?? undefined;
        (c as any).fabricationQuality = (data as any).fabricationQuality ?? undefined;
        return c;
    case 'equipment':
            let id = data.id;
            let name = data.name;
            let description = data.description;
            // Backward-compat: old bronze sword id was sword_fer.
            if (String(id) === 'sword_fer') {
                id = 'sword_bronze' as any;
                if (String(name) === 'Épée de fer') name = 'Épée de bronze' as any;
                if (String(description) === 'Épée en fer (+2 attaque)') description = 'Épée en bronze (+2 attaque)' as any;
            }

            const critBonus = Math.max(0, Math.floor(Number((data as any).critBonus ?? 0)));
            const e = new Equipment(
                id,
                name,
                description,
                data.slot,
                data.attackBonus,
                data.defenseBonus,
                data.hpBonus,
                data.manaBonus,
                critBonus
            );
            (e as any).fabricationScore = (data as any).fabricationScore ?? undefined;
            (e as any).fabricationQuality = (data as any).fabricationQuality ?? undefined;
            (e as any).quantity = 1;
            return e;
        case 'item':
            const base = new Item(data.id, data.name, data.description, { quantity: q, stackable: q > 1 || data.id === 'bombe_fumigene_item' || data.id === 'potion_small' });
            (base as any).fabricationScore = (data as any).fabricationScore ?? undefined;
            (base as any).fabricationQuality = (data as any).fabricationQuality ?? undefined;
            return base;
    }
}

function buildSaveData(hero: Player): SaveDataV1 {
    const equipment: Partial<Record<EquipmentSlot, ItemSaveV1 & { type: 'equipment' }>> = {};
    (Object.keys(hero.equipment) as EquipmentSlot[]).forEach((slot) => {
        const eq = hero.equipment[slot];
        if (!eq) return;
        const serialized = serializeItem(eq);
        if (serialized.type === 'equipment') equipment[slot] = serialized;
    });

    const market = serializeMarket((hero as any).market);

    const titles = Array.isArray((hero as any).titles) ? (((hero as any).titles ?? []) as any[]).map((t) => String(t ?? '').trim()).filter(Boolean) : [];

    return {
        version: SAVE_VERSION,
        createdAt: new Date().toISOString(),
        hero: {
            name: hero.name,
            pv: hero.pv,
            maxPv: hero.maxPv,
            baseAttack: hero.baseAttack,
            maxMana: hero.maxMana,
            currentMana: hero.currentMana,
            manaRegenPerTurn: hero.manaRegenPerTurn,
            level: hero.level,
            currentXP: hero.currentXP,
            gold: hero.gold,
            wood: (hero as any).wood ?? 0,
            herb: (hero as any).herb ?? 0,
            cuir: (hero as any).cuir ?? 0,
            fer: (hero as any).fer ?? 0,
            skillPoints: hero.skillPoints,
            learnedSkillIds: ((hero as any).learnedSkillIds ?? []) as string[],
            specializationPoints: (hero as any).specializationPoints ?? undefined,
            passiveSkills: ((hero as any).passiveSkills ?? []) as string[],
            partyProgress: (hero as any).__partyProgress ?? undefined,
            characteristicPoints: (hero as any).characteristicPoints ?? 0,
            characteristics: (hero as any).characteristics ?? undefined,
            activeEffects: (hero.activeEffects || []).map((e) => ({
                type: e.type,
                amount: Number((e as any).amount ?? 0),
                remainingTurns: e.remainingTurns,
                remainingHits: (e as any).remainingHits,
            })),
            quests: (hero as any).quests ?? hero.quests ?? {},
            // Persist solved puzzles (énigmes)
            enigmes: (hero as any).enigmes ?? {},
            skills: (hero.skills || []).map(serializeSkill),
            inventory: (hero.inventory || []).map(serializeItem),
            equipment,

			// Global game day (structural time system)
			day: clampInt((hero as any).day ?? (hero as any).marketDay ?? 1, 1),
            hour: Math.max(0, Math.min(23, Math.floor(Number((hero as any).hour ?? 0)))),

            // Party-shared values
            honneur: Math.max(0, Math.min(100, clampInt((hero as any).honneur ?? 0, 0))),
            liberte: Math.max(0, Math.min(100, clampInt((hero as any).liberte ?? 0, 0))),
            humanite: Math.max(0, Math.min(100, clampInt((hero as any).humanite ?? 0, 0))),

            // Party-shared titles
            ...(titles.length ? { titles } : {}),

            // World map: encounters defeated today should remain hidden after reload
            worldEncounterDefeats: (hero as any).__worldEncounterDefeats ?? undefined,

            marketDay: clampInt((hero as any).marketDay ?? 1, 1),
            ...(market ? { market } : {}),
        },
    };
}

function applySaveData(hero: Player, save: SaveDataV1) {
    hero.name = save.hero.name;
    hero.maxPv = save.hero.maxPv;
    hero.pv = save.hero.pv;
    hero.baseAttack = save.hero.baseAttack;
    hero.maxMana = save.hero.maxMana;
    hero.currentMana = save.hero.currentMana;
    // restore mana regen per turn if present in the save (backwards-compatible)
    hero.manaRegenPerTurn = (save.hero as any).manaRegenPerTurn ?? hero.manaRegenPerTurn;
    hero.level = save.hero.level;
    hero.currentXP = save.hero.currentXP;
    hero.gold = save.hero.gold;
    (hero as any).wood = (save.hero as any).wood ?? (hero as any).wood ?? 0;
    (hero as any).herb = (save.hero as any).herb ?? (hero as any).herb ?? 0;
    (hero as any).cuir = (save.hero as any).cuir ?? (hero as any).cuir ?? 0;
    (hero as any).fer = (save.hero as any).fer ?? (hero as any).fer ?? 0;
    hero.skillPoints = save.hero.skillPoints;
    (hero as any).learnedSkillIds = ((save.hero as any).learnedSkillIds ?? (hero as any).learnedSkillIds ?? []) as string[];
    (hero as any).specializationPoints = (save.hero as any).specializationPoints ?? (hero as any).specializationPoints ?? { guerrier: 0, mage: 0, voleur: 0 };
    hero.passiveSkills = (((save.hero as any).passiveSkills ?? hero.passiveSkills ?? []) as any[]).filter(Boolean) as any;
    (hero as any).__partyProgress = (save.hero as any).partyProgress ?? (hero as any).__partyProgress;
    (hero as any).characteristicPoints = (save.hero as any).characteristicPoints ?? (hero as any).characteristicPoints ?? 0;
    // IMPORTANT: on merge avec des valeurs par défaut pour garantir la présence
    // des nouveaux champs (critique/défense) et permettre la migration legacy.
    const defaultChars = {
        force: 0,
        sante: 0,
        energie: 0,
        magie: 0,
        vitesse: 1,
        connaissance: 0,
        critique: 0,
        defense: 0,
    };
    const savedChars = (save.hero as any).characteristics;
    (hero as any).characteristics = { ...defaultChars, ...(savedChars ?? {}) };

    // Migration backwards-compatible: puissance -> energie
    const ch: any = (hero as any).characteristics;
    if (ch && typeof ch === 'object') {
        if (ch.energie == null && ch.puissance != null) ch.energie = ch.puissance;
        if (ch.energie == null) ch.energie = hero.manaRegenPerTurn ?? 0;
        if (ch.critique == null) ch.critique = 0;
        if (ch.defense == null) ch.defense = 0;
        if ('puissance' in ch) delete ch.puissance;
    }

    // Migration partyProgress (plateau): puissance -> energie
    const prog: any = (hero as any).__partyProgress;
    if (Array.isArray(prog)) {
        prog.forEach((p: any) => {
            const pc = p?.characteristics;
            if (!pc || typeof pc !== 'object') return;
            p.characteristics = { ...defaultChars, ...pc };
            const pcc: any = p.characteristics;
            if (pcc.energie == null && pcc.puissance != null) pcc.energie = pcc.puissance;
            if (pcc.energie == null) pcc.energie = 0;
            if (pcc.critique == null) pcc.critique = 0;
            if (pcc.defense == null) pcc.defense = 0;
            if ('puissance' in pcc) delete pcc.puissance;
        });
    }
    hero.activeEffects = (save.hero.activeEffects || []).map((e) => ({
        type: e.type,
        amount: Number((e as any).amount ?? 0),
        remainingTurns: e.remainingTurns,
        remainingHits: (e as any).remainingHits,
    }));

    (hero as any).quests = (save.hero as any).quests ?? (hero as any).quests ?? {};
    // Restore solved puzzles (énigmes) if present
    (hero as any).enigmes = (save.hero as any).enigmes ?? (hero as any).enigmes ?? {};

    hero.skills = (save.hero.skills || []).map(deserializeSkill);
    hero.inventory = (save.hero.inventory || []).map(deserializeItem);

    hero.equipment = {};
    (Object.keys(save.hero.equipment || {}) as EquipmentSlot[]).forEach((slot) => {
        const eq = save.hero.equipment[slot];
        if (!eq) return;
        const item = deserializeItem(eq);
        if (item instanceof Equipment) hero.equipment[slot] = item;
    });

    // Nouveau modèle: re-synchronise PV/Mana/Attaque/Regen depuis les caractéristiques
    // (migre automatiquement les anciennes sauvegardes qui n'ont pas encore de caractéristiques).
    hero.syncDerivedStatsFromCharacteristics({ fillResources: false });

    // Clamp PV / Mana using effective maxima after equipment is restored
    hero.pv = Math.min(hero.pv, hero.effectiveMaxPv);
    hero.currentMana = Math.min(hero.currentMana, hero.effectiveMaxMana);

    // Marché (backwards-compatible)
    (hero as any).marketDay = clampInt((save.hero as any).marketDay ?? (hero as any).marketDay ?? 1, 1);

	// Global day (backwards-compatible, falls back to marketDay for older saves)
	(hero as any).day = clampInt((save.hero as any).day ?? (hero as any).day ?? (hero as any).marketDay ?? 1, 1);
	// Keep legacy mirror in sync
	(hero as any).marketDay = clampInt((hero as any).day ?? 1, 1);

    // Hour (backwards-compatible)
    (hero as any).hour = clampInt((save.hero as any).hour ?? (hero as any).hour ?? 0, 0);
    (hero as any).hour = Math.max(0, Math.min(23, Math.floor(Number((hero as any).hour ?? 0))));

    // Party-shared values (backwards-compatible)
    (hero as any).honneur = Math.max(0, Math.min(100, clampInt((save.hero as any).honneur ?? (hero as any).honneur ?? 0, 0)));
    (hero as any).liberte = Math.max(0, Math.min(100, clampInt((save.hero as any).liberte ?? (hero as any).liberte ?? 0, 0)));
    (hero as any).humanite = Math.max(0, Math.min(100, clampInt((save.hero as any).humanite ?? (hero as any).humanite ?? 0, 0)));

    // Party-shared titles (backwards-compatible)
    {
        const raw = (save.hero as any).titles ?? (hero as any).titles;
        const list = Array.isArray(raw) ? (raw as any[]).map((t) => String(t ?? '').trim()).filter(Boolean) : [];
        (hero as any).titles = list;
    }

    // World map: restore encounters defeated by day
    (hero as any).__worldEncounterDefeats = (save.hero as any).worldEncounterDefeats ?? (hero as any).__worldEncounterDefeats ?? {};
    const market = deserializeMarket((save.hero as any).market);
    if (market) (hero as any).market = market;
}

function readSaveFromStorage(): SaveDataV1 | null {
    try {
        const raw = localStorage.getItem(SAVE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = safeJsonParse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const data = parsed as Partial<SaveDataV1>;
        if (data.version !== SAVE_VERSION) return null;
        if (!data.hero) return null;
        return data as SaveDataV1;
    } catch {
        return null;
    }
}

export function hasBrowserSave(): boolean {
    return readSaveFromStorage() !== null;
}

export function getBrowserSaveMeta(): { createdAt: string } | null {
    const data = readSaveFromStorage();
    if (!data) return null;
    return { createdAt: data.createdAt };
}

export function saveGameToBrowser(hero: Player): { ok: true } | { ok: false; error: string } {
    try {
        const data = buildSaveData(hero);
        localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(data));
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        return { ok: false, error: msg };
    }
}

export function loadGameFromBrowser(hero: Player): { ok: true } | { ok: false; error: string } {
    const data = readSaveFromStorage();
    if (!data) return { ok: false, error: 'Aucune sauvegarde trouvée.' };
    try {
        applySaveData(hero, data);
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        return { ok: false, error: msg };
    }
}

export function deleteBrowserSave(): { ok: true } | { ok: false; error: string } {
    try {
        localStorage.removeItem(SAVE_STORAGE_KEY);
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        return { ok: false, error: msg };
    }
}

export function exportSaveAsString(hero: Player): string {
    return JSON.stringify(buildSaveData(hero), null, 2);
}

export function importSaveFromString(hero: Player, text: string): { ok: true } | { ok: false; error: string } {
    try {
        const parsed = safeJsonParse(text);
        if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'JSON invalide.' };
        const data = parsed as Partial<SaveDataV1>;
        if (data.version !== SAVE_VERSION) return { ok: false, error: 'Version de sauvegarde incompatible.' };
        if (!data.hero) return { ok: false, error: 'Sauvegarde invalide (hero manquant).' };
        applySaveData(hero, data as SaveDataV1);
        // Persist imported save immediately
        localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(data));
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        return { ok: false, error: msg };
    }
}
