import type { Player } from './player.js';

export type ConsumableEffect = 'heal' | 'mana' | 'gold' | 'buff';

export class Item {
    public id: string;
    public name: string;
    public description: string;
    public fabricationScore?: number;
    public fabricationQuality?: number;
    public quantity: number;
    public stackable: boolean;

    constructor(id: string, name: string, description: string, opts?: { quantity?: number; stackable?: boolean }) {
        this.id = id;
        this.name = name;
        this.description = description;

        const q = Math.floor(Number(opts?.quantity ?? 1));
        this.quantity = Number.isFinite(q) ? Math.max(1, q) : 1;
        this.stackable = Boolean(opts?.stackable ?? false);
    }

    // Use the item on target (usually a Player). Returns a message describing the result.
    use(target: Player): string {
        return `${this.name} ne fait rien pour l'instant.`;
    }
} 

// Objet spécial: utilisable dans le plateau de récompenses (post-victoire)
export class Campfire extends Item {
    constructor(
        id: string = 'feu_de_camp',
        name: string = 'Feu de camp',
        description: string =
            "Utilisable après une victoire, avant de choisir une récompense : restaure les PV et le mana du groupe et fait disparaître les récompenses."
    ) {
        super(id, name, description, { quantity: 1, stackable: false });
    }

    use(target: Player): string {
        // L'effet réel (repos de tout le groupe) est géré côté plateau de récompenses.
        // Ici on renvoie juste un message si jamais utilisé ailleurs.
        return `${this.name} ne peut être utilisé qu'après une victoire, sur le plateau de récompenses.`;
    }
}

export class Consumable extends Item {
    public effect: ConsumableEffect;
    public amount: number;
    public usable: boolean = true;

    constructor(id: string, name: string, description: string, effect: ConsumableEffect, amount: number, quantity?: number) {
        super(id, name, description, quantity === undefined ? { stackable: true } : { quantity, stackable: true });
        this.effect = effect;
        this.amount = amount;
        this.usable = true;
    }

    use(target: Player): string {
        if (this.effect === 'heal') {
            const healAmount = Math.max(0, Math.floor(Number(this.amount ?? 0)));
            const before = target.pv;
            const maxPv = Math.max(1, Math.floor(Number((target as any).effectiveMaxPv ?? target.maxPv ?? 1)));
            target.pv = Math.min(maxPv, target.pv + healAmount);
            return `${target.name} récupère ${target.pv - before} PV grâce à ${this.name}.`;
        }
        if (this.effect === 'mana') {
            const manaAmount = Math.max(0, Math.floor(Number(this.amount ?? 0)));
            const before = target.currentMana;
            const maxMana = Math.max(0, Math.floor(Number((target as any).effectiveMaxMana ?? target.maxMana ?? 0)));
            target.currentMana = Math.min(maxMana, target.currentMana + manaAmount);
            return `${target.name} récupère ${target.currentMana - before} mana grâce à ${this.name}.`;
        }
        if (this.effect === 'gold') {
            target.gold = target.gold + this.amount;
            return `${target.name} gagne ${this.amount} or grâce à ${this.name}.`;
        }
        if (this.effect === 'buff') {
            // simple temporary buff: +amount% attack for 3 turns
            target.activeEffects.push({ type: 'buff', amount: this.amount, remainingTurns: 3 });
            return `${target.name} reçoit un buff de ${Math.round(this.amount * 100)}% pendant 3 tours grâce à ${this.name}.`;
        }
        return `${this.name} n'a aucun effet connu.`;
    }
} 

// Items équipables (armes, armures) qui donnent des bonus
export type EquipmentSlot = 'weapon' | 'armor' | 'ring';

export const EQUIPMENT_SLOTS: EquipmentSlot[] = ['weapon', 'armor', 'ring'];

export class Equipment extends Item {
    public slot: EquipmentSlot;
    public attackBonus: number = 0;
    public defenseBonus: number = 0;
    public hpBonus: number = 0;
    public manaBonus: number = 0;
    public critBonus: number = 0;

    constructor(
        id: string,
        name: string,
        description: string,
        slot: EquipmentSlot,
        attackBonus: number = 0,
        defenseBonus: number = 0,
        hpBonus: number = 0,
        manaBonus: number = 0,
        critBonus: number = 0
    ) {
        super(id, name, description);
        this.slot = slot;
        this.attackBonus = attackBonus;
        this.defenseBonus = defenseBonus;
        this.hpBonus = hpBonus;
        this.manaBonus = manaBonus;
        this.critBonus = critBonus;
    }

    // Equipables are not 'used' via the normal use() path; Player.equipItem handles them
    use(target: Player): string {
        return `${this.name} doit être équipé pour profiter de ses bonus.`;
    }
}