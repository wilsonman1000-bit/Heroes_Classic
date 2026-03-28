import { Choice } from "./choice.js"
import type { Player } from "./player.js";


export class Skill extends Choice {

    public name: string;
    public type: 'damage' | 'heal' | 'buff' | 'debuff' | 'dot' | 'hot' | 'defense' | 'mana' | 'movement';
    public manaCost: number;
    public actionPoints: number;
    // Cooldown en tours (0 = pas de cooldown)
    public cooldownTurns: number = 0;

    constructor(key: string, description: string, name: string, type: 'damage' | 'heal' | 'buff' | 'debuff' | 'dot' | 'hot' | 'defense' | 'mana' | 'movement', manaCost: number = 0, actionPoints: number = 1) {
        super(key, description);
        this.name = name;
        this.type = type;
        this.manaCost = manaCost;
        this.actionPoints = actionPoints;
    }

    askChoice(): void {
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' - ' + ' dégats');
    }
}

export class Damageskill extends Skill {

    public damage: number;

    constructor(key: string, description: string, name: string, damage: number, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'damage', manaCost, actionPoints);
        this.damage = damage;
    }

    askChoice(player?: Player): void {
        const dmg = player ? Math.round(this.damage * player.effectiveAttack) : this.damage;
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' - ' + dmg + ' dégats' + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }


}
export class Healskill extends Skill {

    public heal: number;

    constructor(key: string, description: string, name: string, heal: number, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'heal', manaCost, actionPoints);
        this.heal = heal;
    }

    askChoice(player?: Player): void {
        const healAmount = player ? Math.round(this.heal * player.baseAttack) : this.heal;
        console.log(this.key + ') ' + this.name + '  ' + this.description + ' + ' + healAmount + ' PV' + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class BuffSkill extends Skill {

    public buffAmount: number;
    public duration: number;

    constructor(key: string, description: string, name: string, buffAmount: number, duration: number = 3, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'buff', manaCost, actionPoints);
        this.buffAmount = buffAmount;
        this.duration = duration;
    }

    askChoice(): void {
        const durText = this.duration > 0 ? ' (' + this.duration + ' tours)' : ' (permanent)';
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' + ' + Math.round(this.buffAmount * 100) + '% attaque' + durText + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class DebuffSkill extends Skill {

    public debuffAmount: number;
    public duration: number;

    constructor(key: string, description: string, name: string, debuffAmount: number, duration: number = 3, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'debuff', manaCost, actionPoints);
        this.debuffAmount = debuffAmount;
        this.duration = duration;
    }

    askChoice(): void {
        const durText = this.duration > 0 ? ' (' + this.duration + ' tours)' : ' (permanent)';
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' - ' + Math.round(this.debuffAmount * 100) + '% attaque ennemie' + durText + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class DoTSkill extends Skill {

    public damagePerTurn: number;
    public duration: number;

    constructor(key: string, description: string, name: string, damagePerTurn: number, duration: number, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'dot', manaCost, actionPoints);
        this.damagePerTurn = damagePerTurn;
        this.duration = duration;
    }

    askChoice(player?: Player): void {
        const dmg = player ? Math.round(this.damagePerTurn * player.effectiveAttack) : this.damagePerTurn;
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' - ' + dmg + ' dégâts par tour (' + this.duration + ' tours)' + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class HoTSkill extends Skill {

    public healPerTurn: number;
    public duration: number;

    constructor(key: string, description: string, name: string, healPerTurn: number, duration: number, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'hot', manaCost, actionPoints);
        this.healPerTurn = healPerTurn;
        this.duration = duration;
    }

    askChoice(player?: Player): void {
        const heal = player ? Math.round(this.healPerTurn * player.baseAttack) : this.healPerTurn;
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' + ' + heal + ' PV par tour (' + this.duration + ' tours)' + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class DefenseSkill extends Skill {

    public defenseAmount: number;
    public duration: number;

    constructor(key: string, description: string, name: string, defenseAmount: number, duration: number = 1, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'defense', manaCost, actionPoints);
        this.defenseAmount = defenseAmount;
        this.duration = duration;
    }

    askChoice(): void {
        const durText = this.duration > 0 ? ' (' + this.duration + ' tours)' : ' (permanent)';
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' - ' + Math.round(this.defenseAmount * 100) + '% réduction des dégâts' + durText + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class ManaSkill extends Skill {

    constructor(key: string, description: string, name: string, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'mana', manaCost, actionPoints);
    }

    askChoice(): void {
        console.log(this.key + ') ' + this.name + ' - ' + this.description + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

// Buff de régénération de mana : ajoute un bonus plat de mana régénérée par tour pendant X tours
export class ManaRegenBuffSkill extends Skill {
    public manaRegenAmount: number;
    public duration: number;

    constructor(key: string, description: string, name: string, manaRegenAmount: number, duration: number = 3, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'buff', manaCost, actionPoints);
        this.manaRegenAmount = manaRegenAmount;
        this.duration = duration;
    }

    askChoice(): void {
        const durText = this.duration > 0 ? ' (' + this.duration + ' tours)' : ' (permanent)';
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' + ' + this.manaRegenAmount + ' mana/t' + durText + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

// Debuff de régénération de mana : réduit la régénération de mana par tour pendant X tours
export class ManaRegenDebuffSkill extends Skill {
    public manaRegenPenalty: number;
    public duration: number;

    constructor(key: string, description: string, name: string, manaRegenPenalty: number, duration: number = 3, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'debuff', manaCost, actionPoints);
        this.manaRegenPenalty = manaRegenPenalty;
        this.duration = duration;
    }

    askChoice(): void {
        const durText = this.duration > 0 ? ' (' + this.duration + ' tours)' : ' (permanent)';
        console.log(
            this.key +
                ') ' +
                this.name +
                ' - ' +
                this.description +
                ' - ' +
                this.manaRegenPenalty +
                ' mana/t' +
                durText +
                (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : '')
        );
    }
}

// Life-drain skill: deals damage and heals the caster by the actual damage dealt (soin = dégât)
export class LifeDrainSkill extends Damageskill {
    constructor(key: string, description: string, name: string, damage: number, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, damage, manaCost, actionPoints);
    }

    askChoice(player?: Player): void {
        const dmg = player ? Math.round(this.damage * player.effectiveAttack) : this.damage;
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' - ' + dmg + ' dégats (drain de vie)' + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

// Debuff de vulnérabilité : augmente les dégâts reçus par la cible.
// - Mode "hits" : s'applique sur les N prochaines attaques (duration = -1, hits > 0)
// - Mode "turns" : s'applique pendant X tours (duration > 0, hits = 0)
export class VulnerabilitySkill extends Skill {
    public vulnerabilityAmount: number;
    public duration: number;
    public hits: number;

    constructor(
        key: string,
        description: string,
        name: string,
        vulnerabilityAmount: number,
        duration: number,
        hits: number,
        manaCost: number = 0,
        actionPoints: number = 1
    ) {
        super(key, description, name, 'debuff', manaCost, actionPoints);
        this.vulnerabilityAmount = vulnerabilityAmount;
        this.duration = duration;
        this.hits = hits;
    }

    askChoice(): void {
        const vulnText = '+' + Math.round(this.vulnerabilityAmount * 100) + '% dégâts reçus';
        const durText = this.hits > 0 ? ` (${this.hits} attaques)` : (this.duration > 0 ? ` (${this.duration} tours)` : '');
        console.log(this.key + ') ' + this.name + ' - ' + this.description + ' - ' + vulnText + durText + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class ActionPointSkill extends Skill {
    public amount: number;
    public duration: number;

    constructor(key: string, description: string, name: string, amount: number = 1, duration: number = 1, manaCost: number = 0, actionPoints: number = 0) {
        super(key, description, name, 'buff', manaCost, actionPoints);
        this.amount = amount;
        this.duration = duration;
    }

    askChoice(player?: Player): void {
        console.log(this.key + ') ' + this.name + ' - ' + this.description + (this.manaCost > 0 ? ' - Coût: ' + this.manaCost + ' mana' : ''));
    }
}

export class MovementSkill extends Skill {
    constructor(key: string, description: string, name: string, manaCost: number = 0, actionPoints: number = 1) {
        super(key, description, name, 'movement', manaCost, actionPoints);
    }
}