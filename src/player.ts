import { ask } from "./choice.js";
import { Damageskill, Healskill, BuffSkill, DebuffSkill, DoTSkill, HoTSkill, DefenseSkill, ManaSkill, VulnerabilitySkill, type Skill } from "./skill.js";
import { Consumable, Equipment, type EquipmentSlot, Item } from "./item.js";
import { mergePassiveBonuses, PASSIVE_DEFS } from './passives.js';
import type { PassiveId, SkillType } from './passives.js';
import { createSkill } from './skillLibrary.js';

type ActiveEffectType =
    | 'buff'
    | 'debuff'
    | 'dot'
    | 'hot'
    | 'defense'
    | 'mana_regen'
    | 'vulnerability'
    | 'pa_loss'
    | 'pa_gain'
    | 'ap_max'
    | 'root';

type ActiveEffect = {
    type: ActiveEffectType;
    amount: number;
    remainingTurns: number;
    remainingHits?: number;
    sourceSkill?: string;
    sourceAttack?: number;
    reflectDamage?: boolean;
};

export type CharacteristicKey = 'force' | 'sante' | 'energie' | 'magie' | 'vitesse' | 'connaissance' | 'critique' | 'defense';
export type Characteristics = Record<CharacteristicKey, number>;

export type SpecializationCategory = 'guerrier' | 'mage' | 'voleur';
export type SpecializationPoints = Record<SpecializationCategory, number>;

export class Player {

    public name: string;
    public pv: number;
    public maxPv: number;
    public baseAttack: number;
    public buffMultiplier: number = 1;
    public debuffMultiplier: number = 0;
    public skills: Skill[];
    public maxMana: number;
    public currentMana: number;
    public manaRegenPerTurn: number = 40;
    public level: number = 1;
    public currentXP: number = 0;
    public isPlayer: boolean = true;
    public activeEffects: ActiveEffect[] = [];
    // Plateau/tactique: étourdissement (nombre de tours à sauter au début du tour)
    public stunTurns: number = 0;
    public gold: number = 0;
    public wood: number = 0;
    public herb: number = 0;
    public cuir: number = 0;
    public fer: number = 0;
    public skillPoints: number = 0;
    // Points investis par catégorie (guerrier / mage / voleur)
    public specializationPoints: SpecializationPoints = { guerrier: 0, mage: 0, voleur: 0 };
    public characteristicPoints: number = 0;
    public characteristics: Characteristics = {
        force: 0,
        sante: 0,
        energie: 0,
        magie: 0,
        vitesse: 1,
        connaissance: 0,
        critique: 0,
        defense: 0,
    };
    // Passifs appris (ids)
    public passiveSkills: PassiveId[] = [];
    // Points d'action
    public actionPoints: number = 2;
    public actionPointsMax: number = 2;
    // Base rewards when this player is defeated
    public xpReward: number = 0;
    public goldReward: number = 0;
    // Inventaire d'objets (consommables, équipement...)
    public inventory: Item[] = [];

    // Quêtes: état centralisé (persisté dans la sauvegarde)
    public quests: Record<string, { status: 'active' | 'completed' | 'claimed'; stepIndex: number; objectives: Record<string, number> }> = {};

    // Cooldowns des compétences (clé stable => tours restants)
    public skillCooldowns: Record<string, number> = {};

    // Équipements équipés par slot
    public equipment: Partial<Record<EquipmentSlot, Equipment>> = {};

    private static readonly HP_PER_SANTE = 10;
    private static readonly MANA_PER_MAGIE = 10;
    // Valeurs effectives tenant compte de l'équipement
    get effectiveMaxPv(): number {
        const hpBonus = Object.values(this.equipment).reduce((s, e) => s + (e?.hpBonus ?? 0), 0);
        const passive = mergePassiveBonuses(this.passiveSkills);
        return this.maxPv + hpBonus + passive.maxPvFlat;
    }

    get effectiveMaxMana(): number {
        const manaBonus = Object.values(this.equipment).reduce((s, e) => s + (e?.manaBonus ?? 0), 0);
        const passive = mergePassiveBonuses(this.passiveSkills);
        return this.maxMana + manaBonus + passive.maxManaFlat;
    }

    private migrateLegacyStatsIntoCharacteristics(): void {
        // Migration douce pour les vieilles sauvegardes / anciens persos:
        // si les caractéristiques sont à 0, on les déduit des valeurs legacy.
        // Note: maxPv/maxMana may be temporarily modified by the adventure systems
        // (wound penalty / temporary mana bonus). When migrating, infer base characteristics
        // from the *base* values (before those temporary modifiers).
        const legacyHpPenalty = Math.max(0, Math.floor(Number((this as any).__adventureMaxHpPenalty ?? 0)));
        const legacyManaBonus = Math.max(0, Math.floor(Number((this as any).__adventureMaxManaBonus ?? 0)));

        if ((this.characteristics.sante ?? 0) <= 0 && Number.isFinite(this.maxPv) && this.maxPv > 0) {
            const inferredBaseMaxPv = Math.max(1, Math.floor(Number(this.maxPv) + legacyHpPenalty));
            this.characteristics.sante = Math.max(1, Math.floor(inferredBaseMaxPv / Player.HP_PER_SANTE));
        }
        if ((this.characteristics.magie ?? 0) <= 0 && Number.isFinite(this.maxMana) && this.maxMana > 0) {
            const inferredBaseMaxMana = Math.max(0, Math.floor(Number(this.maxMana) - legacyManaBonus));
            this.characteristics.magie = Math.max(0, Math.floor(inferredBaseMaxMana / Player.MANA_PER_MAGIE));
        }
        if ((this.characteristics.force ?? 0) <= 0 && Number.isFinite(this.baseAttack) && this.baseAttack > 0) {
            this.characteristics.force = Math.max(0, Math.floor(this.baseAttack));
        }

		// Migration puissance -> energie (ancienne puissance n'existe plus)
		const anyChar: any = this.characteristics as any;
		if ((anyChar.energie ?? 0) <= 0) {
			// Si une ancienne sauvegarde avait "puissance", on la récupère comme énergie.
			const legacyPuissance = Math.max(0, Math.floor(Number(anyChar.puissance ?? 0)));
			const legacyManaRegen = Math.max(0, Math.floor(Number(this.manaRegenPerTurn ?? 0)));
			anyChar.energie = legacyPuissance > 0 ? legacyPuissance : legacyManaRegen;
		}
		// IMPORTANT: vitesse ne correspond pas aux PA max, c'est l'initiative. Les PA restent séparés.
    }

    public syncDerivedStatsFromCharacteristics(opts: { fillResources?: boolean } = {}): void {
        this.migrateLegacyStatsIntoCharacteristics();

        const sante = Math.max(0, Math.floor(Number(this.characteristics.sante ?? 0)));
        const magie = Math.max(0, Math.floor(Number(this.characteristics.magie ?? 0)));
        const force = Math.max(0, Math.floor(Number(this.characteristics.force ?? 0)));
        const energie = Math.max(0, Math.floor(Number((this.characteristics as any).energie ?? 0)));

        // Base derived resources
        const baseMaxPv = sante * Player.HP_PER_SANTE;
        const baseMaxMana = magie * Player.MANA_PER_MAGIE;

        // Adventure systems:
        // - __adventureMaxHpPenalty reduces max HP persistently until resting at the inn / campfire.
        // - __adventureMaxManaBonus temporarily increases max mana (post-win rewards), cleared when leaving the reward screen.
        const hpPenalty = Math.max(0, Math.floor(Number((this as any).__adventureMaxHpPenalty ?? 0)));
        const manaBonus = Math.max(0, Math.floor(Number((this as any).__adventureMaxManaBonus ?? 0)));

        this.maxPv = Math.max(1, Math.floor(baseMaxPv - hpPenalty));
        this.maxMana = Math.max(0, Math.floor(baseMaxMana + manaBonus));
        this.baseAttack = force;
		this.manaRegenPerTurn = energie;

		if (opts.fillResources) {
			this.pv = this.effectiveMaxPv;
			this.currentMana = this.effectiveMaxMana;
			// PA restent séparés: on ne touche pas actionPointsMax ici.
			this.actionPoints = this.actionPointsMax;
		} else {
			this.pv = Math.min(this.pv, this.effectiveMaxPv);
			this.currentMana = Math.min(this.currentMana, this.effectiveMaxMana);
			this.actionPoints = Math.min(this.actionPoints, this.actionPointsMax);
		}
    }

    constructor(
        name: string,
        pv: number,
        maxPv: number,
        baseAttack: number,
        skills: Skill[],
        maxMana: number,
        isPlayer: boolean = true,
        gold: number = 0,
        skillPoints: number = 0,
        xpReward: number = 0,
        goldReward: number = 0,
        manaRegenPerTurn?: number,
        wood?: number,
        herb?: number,
        actionPointsMax: number = 2,
        characteristicPoints: number = 0,
        characteristics?: Partial<Characteristics>,
    ) {
        this.name = name;
        this.pv = pv;
        this.maxPv = maxPv;
        this.baseAttack = baseAttack;
        this.skills = skills;
        this.maxMana = maxMana;
        this.currentMana = maxMana;
        this.manaRegenPerTurn = manaRegenPerTurn ?? 20;
        this.isPlayer = isPlayer;
        this.gold = gold;
        this.wood = wood ?? 0;
        this.herb = herb ?? 0;
        this.skillPoints = skillPoints;
        this.xpReward = xpReward;
        this.goldReward = goldReward;
        this.actionPointsMax = actionPointsMax;
        this.actionPoints = actionPointsMax;

        this.characteristicPoints = characteristicPoints ?? 0;
        if (characteristics) {
            (Object.keys(characteristics) as CharacteristicKey[]).forEach((k) => {
                const v = characteristics[k];
                if (typeof v === 'number' && Number.isFinite(v)) this.characteristics[k] = Math.max(0, Math.floor(v));
            });
        }

        // Nouveau modèle: PV/Mana/Attaque dérivent des caractéristiques.
        // Si des caractéristiques sont présentes (ou si on migre une sauvegarde), on synchronise.
        this.syncDerivedStatsFromCharacteristics({ fillResources: false });
    }

    private getSkillCooldownKey(skill: Skill): string {
        const id = (skill as any).skillId;
        return String(id ?? skill.key ?? skill.name);
    }

    public getSkillCooldownRemaining(skill: Skill): number {
        const key = this.getSkillCooldownKey(skill);
        const v = Number(this.skillCooldowns?.[key] ?? 0);
        return Math.max(0, Math.floor(v));
    }

    public isSkillOnCooldown(skill: Skill): boolean {
        return this.getSkillCooldownRemaining(skill) > 0;
    }

    public startSkillCooldown(skill: Skill): void {
        const base = Math.max(0, Math.floor(Number((skill as any).cooldownTurns ?? 0)));
        if (!base) return;
        const key = this.getSkillCooldownKey(skill);
        this.skillCooldowns[key] = base;
    }

    // À appeler au début du tour du joueur/ennemi
    public tickSkillCooldowns(): void {
        const cds = this.skillCooldowns ?? {};
        for (const [k, v] of Object.entries(cds)) {
            const n = Math.max(0, Math.floor(Number(v)));
            const next = n > 0 ? n - 1 : 0;
            if (next <= 0) delete cds[k];
            else cds[k] = next;
        }
        this.skillCooldowns = cds;
    }

    public canSpendCharacteristicPoint(key: CharacteristicKey): { ok: true } | { ok: false; message: string } {
        if (this.characteristicPoints <= 0) return { ok: false, message: `Aucun point de caractéristique disponible.` };
        if (!this.characteristics || !(key in this.characteristics)) return { ok: false, message: `Caractéristique invalide: ${key}` };
        return { ok: true };
    }

    public spendCharacteristicPoint(key: CharacteristicKey): string {
        const can = this.canSpendCharacteristicPoint(key);
        if (!can.ok) return can.message;

        this.characteristicPoints -= 1;
        this.characteristics[key] = (this.characteristics[key] ?? 0) + 1;

        // Nouveau modèle:
        // - santé -> PV max (x10)
        // - magie -> Mana max (x10)
        // - energie -> Mana regen / tour
        // - force -> Attaque
        // - vitesse -> initiative (ordre des tours)
        // - connaissance -> +1 point de compétence (inchangé)
        // - critique -> chance de coup critique (dégâts x2)
        // - defense -> réduction des dégâts reçus
        if (key === 'connaissance') {
            this.skillPoints += 1;
        }
        this.syncDerivedStatsFromCharacteristics({ fillResources: false });

        return `${this.name} dépense 1 point en ${key}.`;
    }

    get effectiveAttack(): number {
        const passive = mergePassiveBonuses(this.passiveSkills);
        const totalBuff = this.activeEffects.filter(e => e.type === 'buff' && e.remainingTurns !== 0).reduce((sum, e) => sum + e.amount, 0);
        const totalDebuff = this.activeEffects.filter(e => e.type === 'debuff' && e.remainingTurns !== 0).reduce((sum, e) => sum + e.amount, 0);
        // Equipment attack bonus sum
        const equipmentAttack = Object.values(this.equipment).reduce((s, eq) => s + (eq?.attackBonus ?? 0), 0);
        return Math.round((this.baseAttack + equipmentAttack + passive.attackFlat) * (1 + totalBuff) * (1 - totalDebuff));
    }

    public getPassiveSkillTypeMultiplier(type: SkillType): number {
        const passive = mergePassiveBonuses(this.passiveSkills);
        return passive.skillTypeMultiplier[type] ?? 1;
    }

    public getPassiveManaRegenPerTurnBonus(): number {
        const passive = mergePassiveBonuses(this.passiveSkills);
        return passive.manaRegenPerTurnFlat ?? 0;
    }

    public hasPassive(id: PassiveId): boolean {
        return this.passiveSkills.includes(id);
    }

    public canLearnPassive(id: PassiveId): { ok: true } | { ok: false; message: string } {
        const def = PASSIVE_DEFS[id];
        if (!def) return { ok: false, message: `Passif inconnu: ${id}` };
        if (this.hasPassive(id)) return { ok: false, message: `${def.name} est déjà appris.` };
        if (this.level < def.unlockLevel) return { ok: false, message: `Niveau ${def.unlockLevel} requis pour apprendre ${def.name}.` };
        if (this.skillPoints < def.costSkillPoints) return { ok: false, message: `Pas assez de points de compétence pour apprendre ${def.name}.` };

        // Pré-requis de catégorie (si défini)
        const cat = (def as any).category as SpecializationCategory | undefined;
        const req = ((def as any).requiredCategoryPoints ?? 0) as number;
        if (cat && req > 0) {
            const have = this.specializationPoints?.[cat] ?? 0;
            if (have < req) {
                return { ok: false, message: `Pré-requis: ${cat} ${req} (vous: ${have}).` };
            }
        }

        if (def.exclusiveGroup) {
            const alreadyInGroup = (this.passiveSkills || []).some((pid) => PASSIVE_DEFS[pid]?.exclusiveGroup === def.exclusiveGroup);
            if (alreadyInGroup) {
                return { ok: false, message: `Vous avez déjà appris un passif exclusif lié à ${def.name}.` };
            }
        }
        return { ok: true };
    }

    public learnPassive(id: PassiveId): string {
        const can = this.canLearnPassive(id);
        if (!can.ok) return can.message;
        const def = PASSIVE_DEFS[id];
        this.skillPoints -= def.costSkillPoints;

        // Dépenser des points dans une catégorie augmente cette catégorie
        const cat = (def as any).category as SpecializationCategory | undefined;
        if (cat) {
            const spent = def.costSkillPoints ?? 1;
            this.specializationPoints[cat] = (this.specializationPoints[cat] ?? 0) + spent;
        }
        this.passiveSkills.push(id);
        // Ajuste PV/mana actuels si les maxima changent
        this.pv = Math.min(this.pv, this.effectiveMaxPv);
        this.currentMana = Math.min(this.currentMana, this.effectiveMaxMana);
        return `${this.name} apprend le passif ${def.name}.`;
    }

    public getSpecializationPoints(category: SpecializationCategory): number {
        return this.specializationPoints?.[category] ?? 0;
    }

    // Appelé quand on apprend une compétence (coût 1 point de compétence)
    public spendSkillPointOnSpecialization(category: SpecializationCategory, amount: number = 1): void {
        const inc = Math.max(0, Math.floor(amount));
        if (!inc) return;
        this.specializationPoints[category] = (this.specializationPoints[category] ?? 0) + inc;
    }

    async playTurn(adversaire: Player) {
        // Début du tour : applique DoT/HoT (les buffs/debuffs expirent en fin de tour)
        this.updateEffects();

        // Régénération mana/tour au début du tour (pas à chaque compétence)
        this.regenerateMana();

        let selectedSkill: Skill;
        if (this.isPlayer) {
            selectedSkill = await ask('Que faire ?', this.skills, this) as Skill;
        } else {
            // AI: for now, always choose the first skill
            selectedSkill = this.skills[0]!;
            console.log(this.name + ' utilise ' + selectedSkill.name);
        }
        if (this.currentMana < selectedSkill.manaCost) {
            console.log('Pas assez de mana pour utiliser ' + selectedSkill.name + '. Mana actuel: ' + this.currentMana + '/' + this.maxMana);
            return;
        }

        const cd = this.getSkillCooldownRemaining?.(selectedSkill) ?? 0;
        if (cd > 0) {
            console.log(selectedSkill.name + ' est en cooldown (' + cd + ' tour(s) restant(s)).');
            return;
        }
        this.currentMana -= selectedSkill.manaCost;

        this.startSkillCooldown?.(selectedSkill);
        if(selectedSkill instanceof Damageskill) {
            // Play attack sound for enemy basic attacks
            const skillId = String((selectedSkill as any).skillId ?? '');
            if (!this.isPlayer && skillId === 'basic_attack') {
                window.game?.audioManager.play('attaque');
            }

            this.throwDamage(adversaire, selectedSkill.damage * this.effectiveAttack);
            // Ajout du DoT brûlure si c'est la boule de feu
            if(selectedSkill.name === 'Boule de feu') {
                const burnDot: ActiveEffect = { type: 'dot', amount: Math.round(0.5 * this.effectiveAttack), remainingTurns: 4, sourceAttack: this.effectiveAttack };
                adversaire.activeEffects.push(burnDot);
                console.log(this.name + ' applique une brûlure à ' + adversaire.name + ' : ' + burnDot.amount + ' dégâts par tour pendant ' + burnDot.remainingTurns + ' tours');
            }
        }
        else if (selectedSkill instanceof Healskill) {
            const healAmount = Math.round(selectedSkill.heal * this.baseAttack);
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et soigne ' + healAmount + ' PV');
            this.pv = Math.min(this.pv + healAmount, this.maxPv);
            console.log(this.name + ' a maintenant ' + this.pv + '/' + this.maxPv + ' PV');
        }
        else if (selectedSkill instanceof BuffSkill) {
            const dur = selectedSkill.duration;
            this.activeEffects.push({type: 'buff', amount: selectedSkill.buffAmount, remainingTurns: dur});
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et augmente son attaque de ' + Math.round(selectedSkill.buffAmount * 100) + '%' + (selectedSkill.duration > 0 ? ' pour ' + selectedSkill.duration + ' tours' : ' définitivement'));
            console.log('Nouvelle attaque effective: ' + this.effectiveAttack);
        }
        else if ((selectedSkill as any).manaRegenAmount !== undefined && (selectedSkill as any).duration !== undefined) {
            // Mana regen buff (générique handling pour les ManaRegenBuffSkill)
            const dur = (selectedSkill as any).duration;
            const amount = (selectedSkill as any).manaRegenAmount;
            this.activeEffects.push({type: 'mana_regen', amount, remainingTurns: dur});
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et gagne +' + amount + ' mana/t pour ' + dur + ' tours');
        }
        else if ((selectedSkill as any).manaRegenPenalty !== undefined && (selectedSkill as any).duration !== undefined) {
            // Mana regen debuff (générique handling pour les ManaRegenDebuffSkill)
            const dur = (selectedSkill as any).duration;
            const penalty = (selectedSkill as any).manaRegenPenalty;
            adversaire.activeEffects.push({type: 'mana_regen', amount: -penalty, remainingTurns: dur});
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et réduit la régénération de mana de ' + adversaire.name + ' de ' + penalty + ' mana/t pour ' + dur + ' tours');
        }
        else if (selectedSkill instanceof DebuffSkill) {
            const dur = selectedSkill.duration;
            adversaire.activeEffects.push({type: 'debuff', amount: selectedSkill.debuffAmount, remainingTurns: dur});
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et diminue l\'attaque de ' + adversaire.name + ' de ' + Math.round(selectedSkill.debuffAmount * 100) + '%' + (selectedSkill.duration > 0 ? ' pour ' + selectedSkill.duration + ' tours' : ' définitivement'));
            console.log('Nouvelle attaque effective de ' + adversaire.name + ': ' + adversaire.effectiveAttack);
        }
        else if (selectedSkill instanceof VulnerabilitySkill) {
            // Vulnérabilité : augmente les dégâts reçus de l'adversaire
            const dur = selectedSkill.duration;
            const hits = selectedSkill.hits;
            const vulnEffect: any = {
                type: 'vulnerability',
                amount: selectedSkill.vulnerabilityAmount,
                remainingTurns: hits > 0 ? -1 : dur,
                sourceSkill: selectedSkill.name,
            };
            if (hits > 0) vulnEffect.remainingHits = hits;
            adversaire.activeEffects.push(vulnEffect);
            const label = hits > 0 ? `sur les ${hits} prochaines attaques` : (dur > 0 ? `pendant ${dur} tours` : '');
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et rend ' + adversaire.name + ' plus vulnérable (+' + Math.round(selectedSkill.vulnerabilityAmount * 100) + '% dégâts reçus) ' + label);
        }
        else if (selectedSkill instanceof DoTSkill) {
            const damagePerTurn = Math.round(selectedSkill.damagePerTurn * this.effectiveAttack);
            adversaire.activeEffects.push({type: 'dot', amount: damagePerTurn, remainingTurns: selectedSkill.duration, sourceAttack: this.effectiveAttack});
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et inflige ' + damagePerTurn + ' dégâts par tour à ' + adversaire.name + ' pour ' + selectedSkill.duration + ' tours');
        }
        else if (selectedSkill instanceof HoTSkill) {
            const healPerTurn = Math.round(selectedSkill.healPerTurn * this.baseAttack);
            this.activeEffects.push({type: 'hot', amount: healPerTurn, remainingTurns: selectedSkill.duration});
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et soigne ' + healPerTurn + ' PV par tour pour ' + selectedSkill.duration + ' tours');
        }
        else if (selectedSkill instanceof DefenseSkill) {
            this.activeEffects.push({type: 'defense', amount: selectedSkill.defenseAmount, remainingTurns: selectedSkill.duration});
            console.log(this.name + ' utilise ' + selectedSkill.name + ' et réduit les dégâts reçus de ' + Math.round(selectedSkill.defenseAmount * 100) + '%' + (selectedSkill.duration > 0 ? ' pour ' + selectedSkill.duration + ' tours' : ' définitivement'));
        }
        else if (selectedSkill instanceof ManaSkill) {
            const id = String((selectedSkill as any).skillId ?? '');
            const key = String((selectedSkill as any).key ?? '');
            const name = String((selectedSkill as any).name ?? selectedSkill.name ?? '');
            const isGroupMana = id === 'mana_groupe' || key === 'MG' || name === 'Recharge de mana de groupe';

            if (isGroupMana && this.isPlayer) {
                // Donne +20 mana à tous les membres de la party, même s'ils n'ont pas de pool de mana
                const mod = await import('./party.web.js');
                const members = mod.getPartyMembers();
                for (const m of members) {
                    const before = Math.max(0, Math.floor(m.currentMana ?? 0));
                    // Add currentMana only; do not modify maxMana
                    const maxMana = Math.max(0, Math.floor((m as any).effectiveMaxMana ?? m.maxMana ?? 0));
                    m.currentMana = Math.min(Math.max(0, before + 20), maxMana);
                    console.log(`${m.name} récupère ${m.currentMana - before} mana (Mana ${before} → ${m.currentMana})`);
                }
                console.log(this.name + ' utilise ' + selectedSkill.name + ' et régénère 20 mana pour tout le groupe');
                if (this.isPlayer) window.game?.audioManager.play('magic');
            } else {
                // Comportement par défaut: regen sur le lanceur (compatibilité)
                const manaGain = 20;
                const before = this.currentMana;
                this.currentMana = Math.min(this.currentMana + manaGain, this.effectiveMaxMana);
                console.log(this.name + ' utilise ' + selectedSkill.name + ' et régénère ' + manaGain + ' mana (Mana ' + before + ' → ' + this.currentMana + ')');
                if (this.isPlayer) window.game?.audioManager.play('magic');
            }
        }

        // Fin du tour : fait avancer les durées de buff/debuff du porteur
        this.endTurnEffects();
    }

    /**
     * Effets au début du tour du porteur.
     * - DoT : tick au début du tour de la cible
     * - HoT : tick au début du tour du porteur
     * (Les buffs/debuffs expirent en fin de tour via endTurnEffects)
     */
    updateEffects(): string[] {
        const expiredEffects: string[] = [];
        const expiredMessages: string[] = [];
        // Traitement au début du tour du joueur concerné :
        // - DoT : se déclenche au début du tour de la cible
        // - HoT : se déclenche au début du tour du porteur (le premier tick peut être appliqué au lancement du sort)
        // - Buff/Debuff : effet immédiat, mais la durée diminue au début du tour du porteur
        // - Defense :
        //   - expireOnHit=true => consommée à la réception de dégâts (voir takeDamage)
        //   - expireOnHit=false => durée en tours, décrémentée au début du tour du porteur (ici)
        this.activeEffects = this.activeEffects.map(effect => {
            if (effect.type === 'dot') {
                // Apply DoT effect, then decrement duration
                const beforePv = this.pv;
                console.log(this.name + ' subit ' + effect.amount + ' dégâts du poison/feu');
                const res = this.takeDamage(effect.amount, undefined, { attackerAttackOverride: (effect as any).sourceAttack });
                if (res.actualDamage > 0) {
                    expiredMessages.push(`${this.name} subit ${res.actualDamage} dégâts (DoT) (PV ${beforePv} → ${this.pv})`);
                } else {
                    expiredMessages.push(`${this.name} ne subit aucun dégât (DoT).`);
                }
                if (res.expiredMessages && res.expiredMessages.length) {
                    expiredMessages.push(...res.expiredMessages);
                }
                if (effect.remainingTurns > 0) {
                    effect.remainingTurns--;
                    if (effect.remainingTurns === 0) {
                        expiredEffects.push('de dégâts sur la durée');
                        expiredMessages.push('L\'effet de dégâts sur la durée sur ' + this.name + ' prend fin.');
                    }
                }
            } else if (effect.type === 'hot') {
                // Apply HoT effect, then decrement duration
                const beforePv = this.pv;
                console.log(this.name + ' est soigné de ' + effect.amount + ' PV');
                this.pv = Math.min(this.pv + effect.amount, this.maxPv);
                const actualHeal = this.pv - beforePv;
                if (actualHeal > 0) {
                    expiredMessages.push(`${this.name} récupère ${actualHeal} PV (HoT) (PV ${beforePv} → ${this.pv})`);
                }
                if (effect.remainingTurns > 0) {
                    effect.remainingTurns--;
                    if (effect.remainingTurns === 0) {
                        expiredEffects.push('de soins sur la durée');
                        expiredMessages.push('L\'effet de soins sur la durée sur ' + this.name + ' prend fin.');
                    }
                }
            } else if (effect.type === 'defense') {
                // Turn-based defense (ex: blocage de guerrier) expires at the start of the next turn
                if (effect.remainingTurns > 0 && (effect as any).expireOnHit === false) {
                    effect.remainingTurns--;
                    if (effect.remainingTurns === 0) {
                        const msg = `Le blocage sur ${this.name} prend fin.`;
                        expiredMessages.push(msg);
                        console.log(msg);
                    }
                }
            } else if ((effect as any).type === 'pa_loss') {
                // Apply PA loss at the start of the turn
                const beforePA = this.actionPoints;
                this.actionPoints = Math.max(0, this.actionPoints - effect.amount);
                if (this.actionPoints < beforePA) {
                    expiredMessages.push(`${this.name} perd ${beforePA - this.actionPoints} PA à cause de ${effect.sourceSkill ?? 'un effet'}.`);
                    console.log(`${this.name} perd ${beforePA - this.actionPoints} PA à cause de ${effect.sourceSkill ?? 'un effet'}.`);
                }
                if (effect.remainingTurns > 0) {
                    effect.remainingTurns--;
                    if (effect.remainingTurns === 0) {
                        expiredMessages.push(`L'effet ${effect.sourceSkill ?? 'pa_loss'} sur ${this.name} prend fin.`);
                    }
                }
            } else if (effect.type === 'pa_gain') {
                // Apply PA gain at the start of the turn
                const beforePA = this.actionPoints;
                this.actionPoints = Math.min(this.actionPointsMax, this.actionPoints + effect.amount);
                if (this.actionPoints > beforePA) {
                    expiredMessages.push(`${this.name} gagne ${this.actionPoints - beforePA} PA à cause de ${effect.sourceSkill ?? 'un effet'}.`);
                    console.log(`${this.name} gagne ${this.actionPoints - beforePA} PA à cause de ${effect.sourceSkill ?? 'un effet'}.`);
                }
                if (effect.remainingTurns > 0) {
                    effect.remainingTurns--;
                    if (effect.remainingTurns === 0) {
                        expiredMessages.push(`L'effet ${effect.sourceSkill ?? 'pa_gain'} sur ${this.name} prend fin.`);
                    }
                }
            } else if ((effect as any).type === 'ap_max_delayed') {
                // Delayed AP max increase at the start of the turn (used by group AP gain skills).
                const inc = Math.max(0, Math.floor(Number((effect as any).amount ?? 0)));
                if (inc > 0) {
                    this.actionPointsMax = Math.max(1, Math.floor(Number(this.actionPointsMax ?? 1)) + inc);
                    this.actionPoints = Math.min(this.actionPoints, this.actionPointsMax);

                    // Schedule removal at end of THIS turn.
                    this.activeEffects.push({
                        type: 'ap_max',
                        amount: inc,
                        remainingTurns: 1,
                        sourceSkill: (effect as any).sourceSkill,
                        sourceSkillId: (effect as any).sourceSkillId,
                    } as any);
                }
                if (effect.remainingTurns > 0) {
                    effect.remainingTurns--;
                    if (effect.remainingTurns === 0) {
                        expiredMessages.push(`L'effet ${(effect as any).sourceSkill ?? 'ap_max_delayed'} sur ${this.name} prend fin.`);
                    }
                }
            }
            return effect;
        }).filter(effect => effect.remainingTurns !== 0);
        expiredEffects.forEach(type => {
            console.log('L\'effet ' + type + ' sur ' + this.name + ' prend fin.');
        });
        return expiredMessages;
    }

    /**
     * Effets en fin de tour du porteur.
     * - Buff/Debuff : la durée diminue après que le porteur ait joué
     */
    endTurnEffects(): string[] {
        const expiredMessages: string[] = [];

        this.activeEffects = this.activeEffects
            .map((effect) => {
                const isTurnBasedVulnerability = effect.type === 'vulnerability' && (effect.remainingHits === undefined || effect.remainingHits <= 0);
                if (
                    effect.remainingTurns > 0 &&
                    (effect.type === 'buff' ||
                        effect.type === 'debuff' ||
                        effect.type === 'mana_regen' ||
                        isTurnBasedVulnerability ||
                        effect.type === 'ap_max' ||
                        effect.type === 'root')
                ) {
                    effect.remainingTurns--;
                    if (effect.remainingTurns === 0) {
                        let typeLabel = '';
                        if (effect.type === 'buff') typeLabel = 'de buff';
                        else if (effect.type === 'debuff') typeLabel = 'de debuff';
                        else if (effect.type === 'mana_regen') typeLabel = 'de régénération de mana';
                        else if (effect.type === 'vulnerability') typeLabel = 'de vulnérabilité';
                        else if (effect.type === 'ap_max') typeLabel = 'd\'augmentation des PA maximum';
                        else if (effect.type === 'root') typeLabel = 'd\'immobilisation';

                        const msg = `L'effet ${typeLabel} sur ${this.name} prend fin.`;
                        expiredMessages.push(msg);
                        console.log(msg);

                        // Special handling: if ap_max expired, reduce actionPointsMax accordingly
                        if (effect.type === 'ap_max') {
                            const dec = Math.max(0, Math.floor(Number(effect.amount ?? 0)));
                            this.actionPointsMax = Math.max(1, Math.floor(Number(this.actionPointsMax ?? 1)) - dec);
                            // Ensure current actionPoints do not exceed the new max
                            this.actionPoints = Math.min(this.actionPoints, this.actionPointsMax);
                        }
                    }
                }
                return effect;
            })
            .filter((e) => e.remainingTurns !== 0);

        // Assassin (passif): Combo
        // Reset à la fin du tour du porteur (bonus critique par cible uniquement pendant ce tour).
        try {
            (this as any).__assassinComboCritByTarget = undefined;
        } catch {
            // noop
        }

        return expiredMessages;
    }

    throwDamage(adversaire: Player, damage: number) {
        const res = adversaire.takeDamage(damage, this);
        console.log(this.name + ' fait ' + res.actualDamage + ' dégâts à ' + adversaire.name);
        if (res.expiredMessages && res.expiredMessages.length) {
            res.expiredMessages.forEach(m => console.log(m));
        }
        return res;
    }

    takeDamage(
        damage: number,
        attacker?: Player,
        opts?: { ignoreReflect?: boolean; attackerAttackOverride?: number; critChanceBonus?: number },
    ): { actualDamage: number; expiredMessages: string[]; reduced: boolean; critical?: boolean } {
        const vulnerabilityIncrease = this.activeEffects
            .filter((e) => e.type === 'vulnerability' && e.remainingTurns !== 0 && (e.remainingHits === undefined || e.remainingHits > 0))
            .reduce((sum, e) => sum + e.amount, 0);
        let incoming = Math.round(damage * (1 + vulnerabilityIncrease));

        // Coup critique: chance = (critique / force) * 100
        // - critique = force => 100%
        // - 1 critique et 10 force => 10%
        // Dégâts x2 sur un crit.
        let critical = false;
        if (attacker) {
            const atkForce = Math.max(0, Math.floor(Number(attacker.characteristics?.force ?? attacker.baseAttack ?? 0)));
            const equipmentCrit = Object.values(attacker.equipment).reduce(
                (s, eq) => s + Math.max(0, Math.floor(Number((eq as any)?.critBonus ?? 0))),
                0
            );
            const atkCrit = Math.max(0, Math.floor(Number((attacker.characteristics as any)?.critique ?? 0))) + equipmentCrit;
            let bonus = Math.max(0, Number(opts?.critChanceBonus ?? 0));

            // Assassin (passif): Combo
            // Chaque attaque augmente le bonus de crit CONTRE CETTE CIBLE jusqu'à la fin du tour de l'assaillant.
            try {
                if (typeof (attacker as any)?.hasPassive === 'function' && (attacker as any).hasPassive('assassin_combo')) {
                    let map = (attacker as any).__assassinComboCritByTarget as WeakMap<Player, number> | undefined;
                    if (!map) {
                        map = new WeakMap<Player, number>();
                        (attacker as any).__assassinComboCritByTarget = map;
                    }
                    const cur = Math.max(0, Number(map.get(this) ?? 0));
                    bonus += cur;
                }
            } catch {
                // noop
            }
            const baseChance = atkForce > 0 ? Math.max(0, atkCrit / atkForce) : 0;
            const critChance = Math.min(1, baseChance + bonus);
            if (critChance > 0 && Math.random() < critChance) {
                critical = true;
                incoming = Math.round(incoming * 2);
            }
        }

        // Réduction de dégâts via la caractéristique Défense:
        // reduction% = (defense / attaque_ennemi) * 100
        let defenseStatReduction = 0;
        {
            const enemyAttack = attacker
                ? Math.max(0, Math.floor(Number(attacker.effectiveAttack ?? attacker.baseAttack ?? 0)))
                : Math.max(0, Math.floor(Number(opts?.attackerAttackOverride ?? 0)));
            const def = Math.max(0, Math.floor(Number((this.characteristics as any)?.defense ?? 0)));
            if (enemyAttack > 0 && def > 0) {
                defenseStatReduction = Math.min(1, def / enemyAttack);
            }
        }

        const defenseReduction = this.activeEffects.filter(e => e.type === 'defense' && e.remainingTurns !== 0).reduce((sum, e) => sum + e.amount, 0);
        const reduced = defenseReduction > 0 || defenseStatReduction > 0;
        const actualDamage = Math.max(0, Math.round(incoming * (1 - defenseStatReduction) * (1 - defenseReduction)));
        this.pv -= actualDamage;
        const expiredMessages: string[] = [];
        if (critical) expiredMessages.push('Coup critique ! (dégâts x2)');

        // Assassin (passif): Combo
        // Après l'attaque, augmenter le bonus de +10% contre cette cible (pour le reste du tour).
        try {
            if (attacker && typeof (attacker as any)?.hasPassive === 'function' && (attacker as any).hasPassive('assassin_combo')) {
                let map = (attacker as any).__assassinComboCritByTarget as WeakMap<Player, number> | undefined;
                if (!map) {
                    map = new WeakMap<Player, number>();
                    (attacker as any).__assassinComboCritByTarget = map;
                }
                const cur = Math.max(0, Number(map.get(this) ?? 0));
                const next = Math.min(1, cur + 0.1);
                map.set(this, next);
            }
        } catch {
            // noop
        }
        console.log(
            'Il reste ' +
                this.pv +
                '/' +
                this.maxPv +
                ' PV à ' +
                this.name +
                (vulnerabilityIncrease > 0 ? ' (vulnérabilité +' + Math.round(vulnerabilityIncrease * 100) + '% dégâts reçus)' : '') +
                (critical ? ' (coup critique x2)' : '') +
                (defenseStatReduction > 0 ? ' (défense: -' + Math.round(defenseStatReduction * 100) + '% dégâts)' : '') +
                (defenseReduction > 0 ? ' (réduction de ' + Math.round(defenseReduction * 100) + '% des dégâts)' : '')
        );

        // Jouer le son spécial si la cible vient d'être tuée par un guerrier
        try {
            if (this.pv <= 0 && attacker) {
                const attackerIsWarrior = String((attacker as any).characterClass ?? '').toLowerCase() === 'guerrier';
                if (attackerIsWarrior) {
                    window.game?.audioManager.play('destinscelle');
                }
            }
        } catch (e) {
            // silence any audio errors
        }

        // Renvoi de dégâts (blocage de guerrier) : renvoie les dégâts reçus.
        const hasReflect = !opts?.ignoreReflect && !!attacker && this.activeEffects.some((e) => e.type === 'defense' && e.remainingTurns !== 0 && e.reflectDamage);
        if (hasReflect && attacker && actualDamage > 0) {
            const beforePvAttacker = attacker.pv;
            const reflectRes = attacker.takeDamage(actualDamage, undefined, { ignoreReflect: true });
            expiredMessages.push(`${this.name} renvoie ${reflectRes.actualDamage} dégâts à ${attacker.name} (PV ${beforePvAttacker} → ${attacker.pv}).`);
            if (reflectRes.expiredMessages && reflectRes.expiredMessages.length) {
                expiredMessages.push(...reflectRes.expiredMessages);
            }
        }

        // Passif Assassin (tier 1): sur coup critique, appliquer le même Poison que la compétence `poison`.
        // Note: on n'applique pas si les dégâts finaux sont 0 (pas de "touché").
        if (attacker && critical && actualDamage > 0 && attacker.hasPassive('assassin_poison_crit')) {
            try {
                const s = createSkill('poison') as any;
                const dur = Math.max(0, Math.floor(Number(s?.duration ?? 0)));
                const dpt = Number(s?.damagePerTurn ?? 0);
                if (dur > 0 && dpt > 0) {
                    const amount = Math.round(dpt * attacker.effectiveAttack);
                    this.activeEffects.push({
                        type: 'dot',
                        amount,
                        remainingTurns: dur,
                        sourceSkill: String(s?.name ?? 'Poison'),
                        sourceSkillId: 'poison',
                        sourceAttack: attacker.effectiveAttack,
                    } as any);
                    expiredMessages.push(`${this.name} est empoisonné ! (-${amount} PV/t pendant ${dur} tours)`);
                }
            } catch {
                // ignore (skill library not available / unexpected)
            }
        }

        // Decrement defense effects after use and collect expirations
        const newEffects: ActiveEffect[] = [];
        this.activeEffects.forEach((effect) => {
            if (effect.type === 'defense' && effect.remainingTurns > 0 && (effect as any).expireOnHit !== false) {
                effect.remainingTurns--;
                if (effect.remainingTurns === 0) {
                    expiredMessages.push(`Le blocage sur ${this.name} prend fin.`);
                    return; // skip adding expired effect
                }
            }

            // Hit-based vulnerability: consumes one stack per incoming hit
            if (effect.type === 'vulnerability' && (effect.remainingHits ?? 0) > 0 && damage > 0) {
                effect.remainingHits = (effect.remainingHits ?? 0) - 1;
                if ((effect.remainingHits ?? 0) <= 0) {
                    expiredMessages.push(`La vulnérabilité sur ${this.name} prend fin.`);
                    // Mark as expired
                    effect.remainingTurns = 0;
                    return;
                }
            }
            // keep other effects or defense with remainingTurns !== 0
            if (effect.remainingTurns !== 0) newEffects.push(effect);
        });
        this.activeEffects = newEffects;
        return { actualDamage, expiredMessages, reduced, critical };
    }

    regenerateMana() {
        const activeManaRegen = this.activeEffects.filter(e => e.type === 'mana_regen' && e.remainingTurns !== 0).reduce((s, e) => s + e.amount, 0);
        const regen = this.manaRegenPerTurn + this.getPassiveManaRegenPerTurnBonus() + activeManaRegen;
        this.currentMana = Math.max(0, Math.min(this.currentMana + regen, this.effectiveMaxMana));
        console.log(this.name + ' régénère ' + regen + ' mana. Mana actuel: ' + this.currentMana + '/' + this.effectiveMaxMana);
    }

    getXPForLevel(l: number): number {
        if (l <= 1) return 0;
        let xp = 100;
        for (let i = 2; i < l; i++) {
            xp = Math.round(xp * 1.2);
        }
        return xp;
    }

    // Ajoute un objet à l'inventaire
    addItem(item: import("./item.js").Item) {
        const it: any = item as any;
        const qtyToAdd = Math.max(1, Math.floor(Number(it?.quantity ?? 1)));
        const canStack = Boolean(it?.stackable);
        if (canStack) {
            const id = String(it?.id ?? '');
            const existing = this.inventory.find((x: any) => Boolean(x?.stackable) && String(x?.id ?? '') === id);
            if (existing) {
                const cur = Math.max(1, Math.floor(Number((existing as any).quantity ?? 1)));
                (existing as any).quantity = cur + qtyToAdd;
                console.log(`${it?.name ?? 'Objet'} x${qtyToAdd} ajouté (stack) à l'inventaire de ${this.name}`);
                return;
            }
        }

        (item as any).quantity = qtyToAdd;
        this.inventory.push(item);
        console.log(`${it?.name ?? 'Objet'} ajouté à l'inventaire de ${this.name}`);
    }

    // Utiliser un objet par index dans l'inventaire
    useItem(index: number): string {
        if (index < 0 || index >= this.inventory.length) return 'Objet introuvable.';
        const item = this.inventory[index];
        if (!item) return 'Objet introuvable.';
        if (!(item instanceof Consumable)) return `${item.name} ne peut pas être utilisé.`;
        const res = item.use(this);
        // Si c'est un consommable, on décrémente (stack) ou on retire après usage
        const q = Math.max(1, Math.floor(Number((item as any).quantity ?? 1)));
        if (Boolean((item as any).stackable) && q > 1) {
            (item as any).quantity = q - 1;
        } else {
            this.inventory.splice(index, 1);
        }
        console.log(res);
        return res;
    }

    // Équiper un équipement depuis l'inventaire (par index)
    equipItem(index: number): string {
        if (index < 0 || index >= this.inventory.length) return 'Objet introuvable.';
        const item = this.inventory[index];
        if (!item) return 'Objet introuvable.';
        if (item instanceof Equipment) {
            const eq = item;
            const slot: EquipmentSlot = eq.slot;
            // Désequipe l'ancien si présent
            const previous = this.equipment[slot];
            if (previous) {
                this.inventory.push(previous);
            }
            // Equipe le nouvel objet et retire de l'inventaire
            this.equipment[slot] = eq;
            this.inventory.splice(index, 1);
            // Ajuste PV et Mana courants si l'équipement augmente les maxima
            if (eq.hpBonus && eq.hpBonus > 0) {
                this.pv = Math.min(this.pv + eq.hpBonus, this.effectiveMaxPv);
            }
            if (eq.manaBonus && eq.manaBonus > 0) {
                this.currentMana = Math.min(this.currentMana + eq.manaBonus, this.effectiveMaxMana);
            }
            const msg = `${this.name} équipe ${eq.name} (slot: ${slot})`;
            console.log(msg);
            return msg;
        }
        return `${item.name} ne peut pas être équipé.`;
    }

    // Désequipe un objet d'un slot et le remet dans l'inventaire
    unequipSlot(slot: EquipmentSlot): string {
        const prev = this.equipment[slot];
        if (!prev) return `Aucun équipement en ${slot}.`;
        this.inventory.push(prev);
        delete this.equipment[slot];
        // Ajuste PV et Mana courants si maxima diminuent
        this.pv = Math.min(this.pv, this.effectiveMaxPv);
        this.currentMana = Math.min(this.currentMana, this.effectiveMaxMana);
        const msg = `${this.name} retire ${prev.name} (slot: ${slot})`;
        console.log(msg);
        return msg;
    }

    // Retirer un objet (par index)
    removeItem(index: number) {
        if (index < 0 || index >= this.inventory.length) return null;
        return this.inventory.splice(index, 1)[0];
    }

    gainXP(amount: number) {
        this.currentXP += amount;
        console.log(this.name + ' gagne ' + amount + ' XP.');
        while (this.level < 30 && this.currentXP >= this.getXPForLevel(this.level + 1)) {
            this.currentXP -= this.getXPForLevel(this.level + 1);
            this.level++;
            console.log('Félicitations ! ' + this.name + ' passe au niveau ' + this.level + ' !');
           
            this.skillPoints += 1;
            this.characteristicPoints += 1;
            console.log('Stats augmentés : PV max +10, Attaque +1, Mana max +5, Mana regen/tour +0, Points de compétence +1, Points de caractéristique +1');
        }
        console.log(this.name + ' Niveau ' + this.level + ' - XP: ' + this.currentXP + '/' + this.getXPForLevel(this.level + 1));
    }

    clone() {
        const cloned = new Player(
            this.name,
            this.pv,
            this.maxPv,
            this.baseAttack,
            this.skills,
            this.maxMana,
            this.isPlayer,
            this.gold,
            this.skillPoints,
            this.xpReward,
            this.goldReward,
            this.manaRegenPerTurn,
            this.wood,
            this.herb,
            this.actionPointsMax,
            this.characteristicPoints,
            { ...this.characteristics },
        );

        // Preserve dynamic/meta properties used by web/tactical modules.
        (cloned as any).characterClass = (this as any).characterClass;
        (cloned as any).__adventureMaxManaBonus = Math.max(0, Math.floor(Number((this as any).__adventureMaxManaBonus ?? 0)));
        (cloned as any).__adventureMaxHpPenalty = Math.max(0, Math.floor(Number((this as any).__adventureMaxHpPenalty ?? 0)));

        cloned.buffMultiplier = this.buffMultiplier;
        cloned.debuffMultiplier = this.debuffMultiplier;
        cloned.currentMana = this.currentMana;
        cloned.level = this.level;
        cloned.currentXP = this.currentXP;
        cloned.activeEffects = [...this.activeEffects];
        cloned.actionPointsMax = this.actionPointsMax;
        cloned.actionPoints = this.actionPoints;
        // copy inventory (shallow copy of items)
        cloned.inventory = [...(this.inventory || [])];
        // copy equipment mapping shallowly
        cloned.equipment = Object.assign({}, this.equipment);
        // copy passifs
        cloned.passiveSkills = [...(this.passiveSkills || [])];
        // copy cooldowns
        cloned.skillCooldowns = { ...(this.skillCooldowns || {}) };

        // Preserve resource counters (wood/herb/new resources)
        (cloned as any).cuir = Math.max(0, Math.floor(Number((this as any).cuir ?? 0)));
        (cloned as any).fer = Math.max(0, Math.floor(Number((this as any).fer ?? 0)));

        // Tactical status
        cloned.stunTurns = Math.max(0, Math.floor(Number((this as any).stunTurns ?? 0)));

        // Re-apply derived stats *after* copying adventure modifiers / equipment / passives,
        // so max HP penalties (wounds) and temporary mana bonuses persist across combat/session clones.
        cloned.syncDerivedStatsFromCharacteristics({ fillResources: false });
        return cloned;
    }
}

// Declaration merging to ensure external modules recognize added properties/methods
export interface Player {
    xpReward: number;
    goldReward: number;
    gainXP(amount: number): void;
    clone(): Player;
    inventory: Item[];
    equipment: Partial<Record<EquipmentSlot, Equipment>>;
    effectiveMaxPv: number;
    effectiveMaxMana: number;
    useItem(index: number): string;
    equipItem(index: number): string;
    unequipSlot(slot: EquipmentSlot): string;
    updateEffects(): string[];
    endTurnEffects(): string[];
    passiveSkills: PassiveId[];
    hasPassive(id: PassiveId): boolean;
    canLearnPassive(id: PassiveId): { ok: true } | { ok: false; message: string };
    learnPassive(id: PassiveId): string;
    getPassiveSkillTypeMultiplier(type: SkillType): number;
    getPassiveManaRegenPerTurnBonus(): number;
    manaRegenPerTurn: number;
    regenerateMana(): void;
    characteristicPoints: number;
    characteristics: Characteristics;
    canSpendCharacteristicPoint(key: CharacteristicKey): { ok: true } | { ok: false; message: string };
    spendCharacteristicPoint(key: CharacteristicKey): string;

    specializationPoints: SpecializationPoints;
    getSpecializationPoints(category: SpecializationCategory): number;
    spendSkillPointOnSpecialization(category: SpecializationCategory, amount?: number): void;

    skillCooldowns: Record<string, number>;
    getSkillCooldownRemaining(skill: Skill): number;
    isSkillOnCooldown(skill: Skill): boolean;
    startSkillCooldown(skill: Skill): void;
    tickSkillCooldowns(): void;
}
