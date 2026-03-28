import type { Player } from './player.js';
import { getPartyMembers } from './party.web.js';
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
    ActionPointSkill,
    ManaRegenBuffSkill,
    ManaRegenDebuffSkill,
    VulnerabilitySkill,
    type Skill,
} from './skill.js';

function getEffectiveSkillForCaster(skill: Skill, caster: Player): Skill {
    if (!(skill instanceof DefenseSkill)) return skill;
    if (skill.name !== 'Blocage') return skill;

    if (caster.hasPassive?.('blocage_voleur' as any)) {
        return new DefenseSkill(skill.key, skill.description, skill.name, 0.33, skill.duration, 10, 1);
    }

    if (caster.hasPassive?.('blocage_mage' as any)) {
        // -10 mana => donne 10 mana quand utilisé
        return new DefenseSkill(skill.key, skill.description, skill.name, skill.defenseAmount, skill.duration, -10, skill.actionPoints);
    }

    // guerrier: même réduction/couts, mais renvoi géré via activeEffects.reflectDamage
    return skill;
}

export type SkillTurnResult =
    | {
          ok: true;
          message: string;
          extraHistory: string[];
          healFlashOnCaster: boolean;
          damageFlashOnTarget: { actualDamage: number; reduced: boolean } | null;
      }
    | {
          ok: false;
          message: string;
      };

export function applyPlayerSkillTurn(params: {
    caster: Player;
    target: Player;
    skill: Skill;
    turn: number;
    // Optional additive crit chance bonus (0..1). Ex: +0.2 => +20%.
    critChanceBonus?: number;
}): SkillTurnResult {
    const { caster, target, turn } = params;
    const baseSkill = params.skill;
    const skill = getEffectiveSkillForCaster(baseSkill, caster);

    const baseSkillId = (baseSkill as any).skillId as string | undefined;

    // If the caster is a guerrier and uses certain offensive skills, show a temporary attack sprite for 500ms.
    try {
        const cls = String((caster as any).characterClass ?? '').toLowerCase();
        const offensiveSkills = new Set(['basic_attack', 'hache_lourde']);
        if (cls === 'guerrier' && offensiveSkills.has(String(baseSkillId ?? ''))) {
            try {
                (caster as any).__tempSprite = 'ImagesRPG/imagespersonnage/perso_guerrier_attaque.png';
                // Notify UI to re-render if interested
                try { window.dispatchEvent(new CustomEvent('tempSpriteChanged', { detail: { casterName: caster.name } })); } catch (e) { /* noop */ }
                setTimeout(() => {
                    try {
                        delete (caster as any).__tempSprite;
                        try { window.dispatchEvent(new CustomEvent('tempSpriteChanged', { detail: { casterName: caster.name } })); } catch (e) { /* noop */ }
                    } catch (e) {
                        // noop
                    }
                }, 500);
            } catch (e) {
                // noop
            }
        }
    } catch (e) {
        // noop
    }

    const beforeCasterMana = caster.currentMana;
    const beforeCasterPv = caster.pv;
    const beforeTargetPv = target.pv;

    if (caster.currentMana < skill.manaCost) {
        return { ok: false, message: 'Pas assez de mana pour utiliser ' + skill.name };
    }

    // Règle spéciale : Boule de Givre ne peut être appliquée qu'une seule fois sur la cible.
    // => si déjà présent, on refuse l'action (sans dépenser mana/cooldown).
    if ((baseSkillId === 'boule_de_givre' || skill.name === 'Boule de Givre') && skill instanceof ManaRegenDebuffSkill) {
        const alreadyPresent = (target.activeEffects || []).some(
            (e: any) => e.type === 'mana_regen' && (e.amount ?? 0) < 0 && e.remainingTurns !== 0 && e.sourceSkillId === 'boule_de_givre'
        );
        if (alreadyPresent) {
            return { ok: false, message: `${target.name} est déjà sous Boule de Givre.` };
        }
    }

    caster.currentMana -= skill.manaCost;
    caster.startSkillCooldown?.(baseSkill);
    const manaSpentMsg = skill.manaCost > 0 ? ` (${skill.manaCost} mana dépensé)` : '';

    const extraHistory: string[] = [];
    let message = `${caster.name} utilise ${skill.name}${manaSpentMsg}.`;
    let healFlashOnCaster = false;
    let damageFlashOnTarget: { actualDamage: number; reduced: boolean } | null = null;

    if (skill instanceof Damageskill) {
        const typeMult = caster.getPassiveSkillTypeMultiplier?.('damage') ?? 1;
        const dmg = Math.round(skill.damage * caster.effectiveAttack * typeMult);
        const critBonus = typeof params.critChanceBonus === 'number' ? params.critChanceBonus : undefined;
        const res =
            typeof critBonus === 'number'
                ? target.takeDamage(dmg, caster, { critChanceBonus: critBonus })
                : target.takeDamage(dmg, caster);
        const critMsg = (res as any).critical ? ' (Coup critique !)' : '';
        message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et inflige ${res.actualDamage} dégâts à ${target.name}${critMsg} (PV ${beforeTargetPv} → ${target.pv})`;
        if (res.expiredMessages && res.expiredMessages.length) extraHistory.push(...res.expiredMessages);

        // Effet spécial Malédiction : fait perdre 5 mana à l'adversaire
        if (skill.name === 'Malédiction') {
            const beforeMana = target.currentMana;
            target.currentMana = Math.max(0, target.currentMana - 5);
            if (target.currentMana < beforeMana) {
                extraHistory.push(`${target.name} perd 5 mana à cause de la Malédiction ! (Mana ${beforeMana} → ${target.currentMana})`);
            }
        }

        // Effet spécial Missile magique : jouer le son
        if (skill.name === 'Missile magique' && caster.isPlayer) {
            window.game?.audioManager.play('sortaudio');
        }

        // Son d'attaque de base quand un ennemi (ex: gobelin) utilise l'attaque de base
        if (!caster.isPlayer && baseSkillId === 'basic_attack') {
            window.game?.audioManager.play('attaque');
        }

        if (skill instanceof LifeDrainSkill) {
            const beforePvCaster = caster.pv;
            caster.pv = Math.min(caster.maxPv, caster.pv + res.actualDamage);
            if (caster.pv > beforePvCaster) {
                extraHistory.push(`${caster.name} récupère ${caster.pv - beforePvCaster} PV grâce à ${skill.name}`);
                healFlashOnCaster = true;
            }
        }

        // Effet spécial Assassinat : si la cible est tuée, restaurer 50 mana au lanceur
        if (baseSkillId === 'assassinat' && target.pv <= 0) {
            const beforeManaCaster = caster.currentMana;
            caster.currentMana = Math.min(caster.effectiveMaxMana, caster.currentMana + 50);
            if (caster.currentMana > beforeManaCaster) {
                extraHistory.push(`${caster.name} récupère ${caster.currentMana - beforeManaCaster} mana grâce à ${skill.name} !`);
            }
        }

        damageFlashOnTarget = { actualDamage: res.actualDamage, reduced: res.reduced };
    } else if (skill instanceof DoTSkill) {
        const typeMult = caster.getPassiveSkillTypeMultiplier?.('dot') ?? 1;
        const dmgPerTurn = Math.round(skill.damagePerTurn * caster.effectiveAttack * typeMult);
        const dur = skill.duration;
        target.activeEffects.push({
            type: 'dot',
            amount: dmgPerTurn,
            remainingTurns: dur,
            sourceSkill: skill.name,
            sourceSkillId: baseSkillId,
            sourceAttack: caster.effectiveAttack,
        } as any);
        message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et inflige ${dmgPerTurn} dégâts par tour à ${target.name} pendant ${dur} tours`;
    } else if (skill instanceof HoTSkill) {
        const typeMult = caster.getPassiveSkillTypeMultiplier?.('hot') ?? 1;
        const healPerTurn = Math.round(skill.healPerTurn * caster.baseAttack * typeMult);
        const dur = skill.duration;
        // HoT: s'applique immédiatement (un tick), puis tick au début des tours du lanceur.
        const beforePvCaster = caster.pv;
        caster.pv = Math.min(caster.maxPv, caster.pv + healPerTurn);
        const actualHeal = caster.pv - beforePvCaster;
        if (actualHeal > 0) {
            extraHistory.push(`${caster.name} récupère ${actualHeal} PV grâce à ${skill.name}`);
            healFlashOnCaster = true;
        }
        const remaining = dur > 0 ? dur - 1 : dur;
        if (remaining !== 0) {
            caster.activeEffects.push({
                type: 'hot',
                amount: healPerTurn,
                remainingTurns: remaining,
                sourceSkill: skill.name,
                sourceSkillId: baseSkillId,
            } as any);
        }
        message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et soigne ${healPerTurn} PV par tour pendant ${dur} tours`;
        // Play healing SFX when a player uses HoT
        if (caster.isPlayer) {
            window.game?.audioManager.play('healaudio');
        }
    } else if (skill instanceof Healskill) {
        const typeMult = caster.getPassiveSkillTypeMultiplier?.('heal') ?? 1;
        const heal = Math.round(skill.heal * caster.baseAttack * typeMult);
        caster.pv = Math.min(caster.pv + heal, caster.maxPv);
        message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et soigne ${heal} PV (PV ${beforeCasterPv} → ${caster.pv})`;
        // Play healing SFX when a player uses a heal skill
        if (caster.isPlayer) {
            window.game?.audioManager.play('healaudio');
        }
    } else if (skill instanceof BuffSkill) {
        const dur = skill.duration <= 0 ? -1 : skill.duration;
        if (dur === -1 && caster.activeEffects.some((e) => e.type === 'buff' && e.remainingTurns === -1)) {
            message = `${caster.name} utilise ${skill.name}, mais un buff permanent est déjà actif.`;
        } else {
            caster.activeEffects.push({
                type: 'buff',
                amount: skill.buffAmount,
                remainingTurns: dur,
                sourceSkill: skill.name,
                sourceSkillId: baseSkillId,
            } as any);
            message = `${caster.name} utilise ${skill.name} et augmente son attaque de ${Math.round(skill.buffAmount * 100)}%` +
                (skill.duration > 0 ? ` pour ${skill.duration} tours` : ' pendant tout le combat');

            // Play Olaf sound when the warrior uses attack-buff skills
            const cls = String((caster as any).characterClass ?? '').toLowerCase();
            if (caster.isPlayer && cls === 'guerrier' && (baseSkillId === 'buff_attaque' || baseSkillId === 'buff_permanent')) {
                window.game?.audioManager.play('olaf');
            }
        }
    } else if (skill instanceof DebuffSkill) {
        // (existing Debuff handling continues)
        const dur = skill.duration <= 0 ? -1 : skill.duration;
        if (dur === -1 && target.activeEffects.some((e) => e.type === 'debuff' && e.remainingTurns === -1)) {
            message = `${caster.name} utilise ${skill.name}, mais un débuff permanent est déjà actif sur ${target.name}.`;
        } else {
            // Special-case immobiliser: movement-only root (NOT a stun)
            if (baseSkillId === 'immobiliser') {
                target.activeEffects.push({
                    type: 'root',
                    amount: 0,
                    remainingTurns: dur,
                    sourceSkill: skill.name,
                    sourceSkillId: baseSkillId,
                } as any);

                message = `${caster.name} utilise ${skill.name} et immobilise ${target.name} (ne peut pas se déplacer) pendant ${dur} tour${dur > 1 ? 's' : ''}`;
                if (caster.isPlayer) window.game?.audioManager.play('givre');
            } else {
                target.activeEffects.push({
                    type: 'debuff',
                    amount: skill.debuffAmount,
                    remainingTurns: dur,
                    sourceSkill: skill.name,
                    sourceSkillId: baseSkillId,
                } as any);
                message = `${caster.name} utilise ${skill.name} et réduit l'attaque de ${target.name} de ${Math.round(skill.debuffAmount * 100)}%` +
                    (skill.duration > 0 ? ` pour ${skill.duration} tours` : ' pendant tout le combat');
            }
        }
    } else if (skill instanceof VulnerabilitySkill) {
        const amount = skill.vulnerabilityAmount;
        const hits = Math.max(0, Math.floor(skill.hits ?? 0));
        const dur = skill.duration <= 0 ? -1 : skill.duration;

        const vulnEffect: any = {
            type: 'vulnerability',
            amount,
            remainingTurns: hits > 0 ? -1 : dur,
            sourceSkill: skill.name,
            sourceSkillId: baseSkillId,
        };
        if (hits > 0) vulnEffect.remainingHits = hits;
        target.activeEffects.push(vulnEffect);

        if (caster.isPlayer) {
            window.game?.audioManager.play('riremalefique');
        }

        if (hits > 0) {
            message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et augmente les dégâts reçus par ${target.name} de ${Math.round(amount * 100)}% sur les ${hits} prochaines attaques`;
        } else {
            message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et augmente les dégâts reçus par ${target.name} de ${Math.round(amount * 100)}% pendant ${dur} tours`;
        }
    } else if (skill instanceof DefenseSkill) {
        const dur = skill.duration <= 0 ? -1 : skill.duration;
        const reflectDamage = !!(skill.name === 'Blocage' && caster.hasPassive?.('blocage_guerrier' as any));
        caster.activeEffects.push({
            type: 'defense',
            amount: skill.defenseAmount,
            remainingTurns: dur,
            sourceSkill: skill.name,
            sourceSkillId: baseSkillId,
            reflectDamage,
            // Only the warrior-style block should persist for the full turn (not expire on first hit).
            // Detect either the warrior class or the specific warrior block passive.
            expireOnHit: baseSkillId === 'block' && (caster.hasPassive?.('blocage_guerrier' as any) || String((caster as any).characterClass ?? '').toLowerCase() === 'guerrier') ? false : true,
        } as any);
        message = `${caster.name} utilise ${skill.name} et réduira les dégâts reçus de ${Math.round(skill.defenseAmount * 100)}%` +
            (skill.duration > 0 ? ` pendant ${skill.duration} tour(s)` : ' pendant tout le combat');
    } else if (skill instanceof ManaRegenBuffSkill) {
        const dur = skill.duration <= 0 ? -1 : skill.duration;
        caster.activeEffects.push({
            type: 'mana_regen',
            amount: skill.manaRegenAmount,
            remainingTurns: dur,
            sourceSkill: skill.name,
            sourceSkillId: baseSkillId,
        } as any);
        message = `${caster.name} utilise ${skill.name} et gagne +${skill.manaRegenAmount} mana/t pour ${skill.duration} tours`;
        if (caster.isPlayer) {
            window.game?.audioManager.play('magic');
        }
    } else if (skill instanceof ManaRegenDebuffSkill) {
        const dur = skill.duration <= 0 ? -1 : skill.duration;
        target.activeEffects.push({
            type: 'mana_regen',
            amount: -skill.manaRegenPenalty,
            remainingTurns: dur,
            sourceSkill: skill.name,
            sourceSkillId: baseSkillId,
        } as any);
        message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et réduit la régénération de mana de ${target.name} de ${skill.manaRegenPenalty} mana/t` +
            (skill.duration > 0 ? ` pendant ${skill.duration} tours` : ' pendant tout le combat');
        if (caster.isPlayer) {
            window.game?.audioManager.play('givre');
        }
    } else if (skill instanceof ManaSkill) {
        const manaGain = 20;
        const maxMana = Math.max(0, Math.floor((caster as any).effectiveMaxMana ?? caster.maxMana ?? 0));
        caster.currentMana = Math.min(caster.currentMana + manaGain, maxMana);
        message = `${caster.name} utilise ${skill.name} et régénère ${manaGain} mana (Mana ${beforeCasterMana} → ${caster.currentMana})`;
        // Play magic SFX when a player uses a mana skill
        if (caster.isPlayer) {
            window.game?.audioManager.play('magic');
        }
    } else if (skill instanceof ActionPointSkill) {
        const amt = Math.max(0, Math.floor((skill as any).amount ?? 1));
        const dur = Math.max(0, Math.floor((skill as any).duration ?? 1));

        // Gain de PA groupe (voleur): +1 PA au début du prochain tour (une seule fois) pour tous les alliés + le lanceur.
        // Note: on utilise un couple d'effets (ap_max_delayed + pa_gain) pour garantir que le +1 PA fonctionne même au cap.
        if (baseSkillId === 'gain_pa_groupe') {
            let targets: any[] = [caster];
            try {
                if (caster.isPlayer) {
                    const members = getPartyMembers?.();
                    if (Array.isArray(members) && members.length) targets = members;
                }
            } catch {
                // ignore
            }

            for (const m of targets) {
                if (!m) continue;
                if (!Array.isArray((m as any).activeEffects)) (m as any).activeEffects = [];
                // Increase AP max next turn, then grant PA (one-time)
                (m as any).activeEffects.push({ type: 'ap_max_delayed', amount: 1, remainingTurns: 1, sourceSkill: skill.name, sourceSkillId: baseSkillId } as any);
                (m as any).activeEffects.push({ type: 'pa_gain', amount: 1, remainingTurns: 1, sourceSkill: skill.name, sourceSkillId: baseSkillId } as any);
            }

            message = `${caster.name} utilise ${skill.name}${manaSpentMsg} : +1 PA pour le groupe au début du prochain tour.`;
            if (caster.isPlayer) window.game?.audioManager.play('magic');
            return { ok: true, message, extraHistory, healFlashOnCaster, damageFlashOnTarget };
        }

        // Special-case: Fureur -> sacrifice 10% PV max de PV pour activer
        if (baseSkillId === 'fureur') {
            const sac = Math.max(1, Math.floor(Number(caster.maxPv ?? 0) * 0.1));
            const beforeSac = caster.pv;
            caster.pv = Math.max(1, Math.max(0, caster.pv - sac));
            if (caster.pv < beforeSac) extraHistory.push(`${caster.name} sacrifie ${beforeSac - caster.pv} PV pour utiliser ${skill.name}.`);
        }

        // Temporarily increase max AP so the caster can exceed previous cap.
        // - If duration>0: max AP stays boosted through next turn, then is removed via ap_max.
        // - If duration==0 (ex: Fureur): max AP boost is removed at end of current turn.
        const baseApMax = Math.max(1, Math.floor(Number(caster.actionPointsMax ?? 2)));
        const boostedApMax = baseApMax + amt;
        caster.actionPointsMax = boostedApMax;
        const beforePA = caster.actionPoints;
        caster.actionPoints = Math.min(boostedApMax, caster.actionPoints + amt);
        if (caster.actionPoints > beforePA) {
            extraHistory.push(`${caster.name} gagne ${caster.actionPoints - beforePA} PA immédiatement.`);
        }
        if (dur > 0) {
            caster.activeEffects.push({
                type: 'pa_gain',
                amount: amt,
                remainingTurns: dur,
                sourceSkill: skill.name,
                sourceSkillId: baseSkillId,
            } as any);
        }

        // Track the temporary max AP buff so we can remove it when it expires.
        // If dur==0, remove it at end of current turn.
        caster.activeEffects.push({
            type: 'ap_max',
            amount: amt,
            // ap_max should last through the NEXT turn (expire after next endTurn), so add 1 to duration
            remainingTurns: dur > 0 ? dur + 1 : 1,
            sourceSkill: skill.name,
            sourceSkillId: baseSkillId,
        } as any);

        message = `${caster.name} utilise ${skill.name}${manaSpentMsg} et gagne ${amt} PA maintenant${dur > 0 ? ' et au début du prochain tour' : ''}.`;
        if (caster.isPlayer) {
            window.game?.audioManager.play('magic');
        }
    }

    return { ok: true, message, extraHistory, healFlashOnCaster, damageFlashOnTarget };
}

export function applyAutoTurn(params: { caster: Player; target: Player; turn: number }): SkillTurnResult {
    const { caster, target, turn } = params;
    const skills = caster.skills ?? [];
    const skill = skills.find((s) => {
        if (caster.currentMana < (s?.manaCost ?? 0)) return false;
        const cd = caster.getSkillCooldownRemaining?.(s) ?? 0;
        return cd <= 0;
    });

    if (!skill) {
        return {
            ok: true,
            message: `${caster.name} n'a pas assez de mana pour agir et passe son tour.`,
            extraHistory: [],
            healFlashOnCaster: false,
            damageFlashOnTarget: null,
        };
    }

    return applyPlayerSkillTurn({ caster, target, skill, turn });
}

// Ajout des images des personnages dans la scène de combat
export function renderBattleScene(player: Player, enemy: Player) {
    const battleContainer = document.getElementById('battle-container');
    if (!battleContainer) {
        console.error('Le conteneur de combat est introuvable.');
        return;
    }

    // Effacer le contenu précédent
    battleContainer.innerHTML = '';

    // Créer les éléments pour les personnages
    const playerImage = document.createElement('img');
    const cls = String((player as any)?.characterClass ?? '').toLowerCase();
    playerImage.src = cls === 'mage'
        ? 'ImagesRPG/imagespersonnage/mage.png'
        : cls === 'voleur'
            ? 'ImagesRPG/imagespersonnage/voleur.png'
            : 'ImagesRPG/imagespersonnage/player.png';
    playerImage.alt = player.name;
    playerImage.style.width = '150px';
    playerImage.style.height = '150px';
    if (cls === 'mage') playerImage.style.transform = 'scale(0.9)';
    if (cls === 'voleur') playerImage.style.transform = 'scale(0.8)';

    const enemyImage = document.createElement('img');
    enemyImage.src = 'ImagesRPG/imagespersonnage/ennemi.png';
    enemyImage.alt = enemy.name;
    enemyImage.style.width = '150px';
    enemyImage.style.height = '150px';

    // Ajouter les images au conteneur
    const playerContainer = document.createElement('div');
    playerContainer.appendChild(playerImage);
    playerContainer.style.textAlign = 'center';
    playerContainer.style.marginRight = '50px';

    const enemyContainer = document.createElement('div');
    enemyContainer.appendChild(enemyImage);
    enemyContainer.style.textAlign = 'center';
    enemyContainer.style.marginLeft = '50px';

    // Ajouter les conteneurs au conteneur principal
    const battleRow = document.createElement('div');
    battleRow.style.display = 'flex';
    battleRow.style.justifyContent = 'space-between';
    battleRow.style.alignItems = 'center';
    battleRow.appendChild(playerContainer);
    battleRow.appendChild(enemyContainer);

    battleContainer.appendChild(battleRow);
}
