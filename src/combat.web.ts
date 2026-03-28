// DEPRECATION NOTICE: legacy "simple" combat mode (non-tactical) — deprecated and disabled by default.
// Rationale: the tactical / plateau combat system is the canonical and maintained combat mode.
// This file is kept only for compatibility and may be removed in the future. Do not add new features here.
// To temporarily re-enable for testing, set `ENABLE_SIMPLE_COMBAT = true` in `src/config.web.ts`.

// Logique et UI du combat
import { Player } from './player.js';
import { DefenseSkill, Skill } from './skill.js';
import { createSkill } from './skillLibrary.js';
import { hero } from './index.web.js';
import { showAccueil } from './accueil.web.js';
import { ENABLE_SIMPLE_COMBAT } from './config.web.js';
import { showVillage } from './village.web.js';
import { applyAutoTurn, applyPlayerSkillTurn } from './battleTurn.web.js';
import { type HistoryEntry, pushHistory, pushHistoryMany, renderHistoryHtml } from './history.web.js';
import { renderSkillButtons } from './skillUi.web.js';

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
    return skill;
}

export type CombatOptions = {
    enemy?: Player;
    enemyFactory?: (level: number) => Player;
    startAtFull?: boolean;
    backgroundUrl?: string;
    title?: string;
    showAgainButton?: boolean;
    onAgain?: () => void;
    onBack?: () => void;
    // 1 = premier combat de la chaîne (0% bonus), 2 = +25%, 3 = +50%, 4 = +75%, 5+ = +100%
    comboIndex?: number;
};

export function showCombat(enemyLevel = hero.level, options: CombatOptions = {}) {
    if (!ENABLE_SIMPLE_COMBAT) {
        // Legacy simple combat mode disabled intentionally. Kept file for compatibility but make it a no-op.
        console.warn('showCombat: simple combat mode disabled by configuration (ENABLE_SIMPLE_COMBAT=false).');
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `
                <div class="centered-content">
                    <h2>Le mode de combat simple est désactivé.</h2>
                    <div style="margin-top:8px;">Utilisez le <b>Combat plateau</b> (mode par défaut).</div>
                    <div style="margin-top:14px;"><button class="btn" id="combatDisabledBackBtn">Retour</button></div>
                </div>
            `;
            const b = document.getElementById('combatDisabledBackBtn');
            if (b) b.addEventListener('click', () => { (options.onBack ?? (() => showAccueil()))(); });
        }
        return;
    }
    const comboIndex = options.comboIndex ?? 1;
    const comboBonusPct = Math.min(Math.max(comboIndex - 1, 0) * 25, 100);
    const comboMultiplier = 1 + comboBonusPct / 100;

    // Création du gobelin ennemi (base 80 PV pour niveau 1)
    const defaultEnemyFactory = (level: number) => {
        const enemyPv = 80 + (level - 1) * 20;
        const enemyAttack = 8 + level * 2;
        const enemyMana = 20 + level * 1;
        const enemyXp = 15 + level * 5;
        const enemyGold = 15 + level * 5;
        console.log(`Création gobelin niveau ${level} PV: ${enemyPv}`);
        return new Player(
            `Guerrier gobelin niveau ${level}`,
            enemyPv,
            enemyPv,
            enemyAttack,
            [createSkill('basic_attack')],
            enemyMana,
            false,
            0,
            0,
            enemyXp,
            enemyGold
        );
    };

    // plus de rewards par défaut ni en option
    const backgroundUrl = options.backgroundUrl ?? 'https://img.freepik.com/photos-premium/arts-martiaux-pop-up-ui-dojo-jeu-theme-mobile-combat-deco-design-art-cadre-graphique-decor-carte_655090-771134.jpg';
    const title = options.title ?? `Combat contre`;
    const showAgainButton = options.showAgainButton ?? true;

    // On clone le joueur pour ne pas modifier l'objet principal en cas de défaite
    let player = hero.clone();
    // Ajuste les maxima du clone pour inclure les bonus d'équipement
    if (options.startAtFull) {
        player.maxPv = player.effectiveMaxPv;
        player.pv = player.maxPv;
        player.maxMana = player.effectiveMaxMana;
        player.currentMana = player.maxMana;
    } else {
        // IMPORTANT: ne pas "remettre" les PV/Mana en recalculant un pourcentage.
        // Sinon, si `player.maxPv`/`player.maxMana` ne reflétaient pas encore les maxima effectifs
        // (bonus équipement/passifs), on gonfle artificiellement les ressources au démarrage du combat.
        player.maxPv = Math.max(1, Math.floor(player.effectiveMaxPv));
        player.pv = Math.min(Math.max(0, Math.floor(player.pv ?? 0)), player.maxPv);

        player.maxMana = Math.max(0, Math.floor(player.effectiveMaxMana));
        player.currentMana = Math.min(Math.max(0, Math.floor(player.currentMana ?? 0)), player.maxMana);
    }

    // Base PA par classe (cohérent avec le mode tactique)
    {
        const cls = String((player as any).characterClass ?? '').toLowerCase();
        const baseApMax = cls === 'voleur' ? 4 : 3;
        player.actionPointsMax = Math.max(1, Math.floor(baseApMax));
        player.actionPoints = player.actionPointsMax;
    }

    let enemy = options.enemy ?? (options.enemyFactory ?? defaultEnemyFactory)(enemyLevel);
    let turn = 1;
    let message = '';
    let selectedEndInvIdx: number | null = null;
    let history: HistoryEntry[] = [];
    let isPlayerTurn = true;
    let isResolvingPlayerAction = false;
    const app = document.getElementById('app');

    function startEnemyTurnAfterDelay() {
        // Tour de l'ennemi après un court délai
        setTimeout(() => {
            if (enemy.pv <= 0 || player.pv <= 0) return;

            turn++;

            // Début du tour de l'ennemi : tick cooldowns
            enemy.tickSkillCooldowns?.();

            // Début du tour de l'ennemi : DoT sur l'ennemi / buffs/debuffs de l'ennemi
            const enemyStartMsgs = enemy.updateEffects();
            if (enemyStartMsgs.length) pushHistoryMany(history, turn, enemyStartMsgs);
            if (enemy.pv <= 0) {
                const { xp, gold, bonusPct } = computeVictoryRewards();
                const bonusTxt = bonusPct > 0 ? ` (Bonus combo +${bonusPct}%)` : '';
                message += `<br>Victoire ! Vous gagnez ${xp} XP et ${gold} or.${bonusTxt}`;
                applyVictoryRewards();
                render();
                return;
            }

            // Début du tour de l'ennemi : régénération mana/tour
            {
                const beforeMana = enemy.currentMana;
                const activeManaRegen = (enemy.activeEffects || [])
                    .filter((e: any) => e.type === 'mana_regen' && e.remainingTurns !== 0)
                    .reduce((s: number, e: any) => s + (e.amount || 0), 0);
                const regen = (enemy.manaRegenPerTurn || 0) + (enemy.getPassiveManaRegenPerTurnBonus?.() ?? 0) + activeManaRegen;
                enemy.currentMana = Math.min(enemy.currentMana + regen, enemy.maxMana);
                if (enemy.currentMana > beforeMana) {
                    pushHistory(history, turn, `${enemy.name} régénère ${enemy.currentMana - beforeMana} mana (Mana ${beforeMana} → ${enemy.currentMana})`);
                }
            }

            const res = applyAutoTurn({ caster: enemy, target: player, turn });
            message = res.message;
            pushHistory(history, turn, message);
            if (res.ok) pushHistoryMany(history, turn, res.extraHistory);

            // Fin du tour de l'ennemi : fait avancer les durées buff/debuff de l'ennemi
            const enemyEndMsgs = enemy.endTurnEffects?.() || [];
            if (enemyEndMsgs.length) pushHistoryMany(history, turn, enemyEndMsgs);

            if (res.ok && res.damageFlashOnTarget) {
                render();
                setTimeout(() => {
                    const playerHp = document.querySelector('.hp-bar.player') as HTMLElement | null;
                    const playerShield = document.querySelector('.stat-badge.defense') as HTMLElement | null;
                    if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0 && playerHp) {
                        playerHp.classList.add('flash-damage');
                        setTimeout(() => playerHp.classList.remove('flash-damage'), 600);
                    }
                    if (res.damageFlashOnTarget && res.damageFlashOnTarget.reduced && playerShield) {
                        playerShield.classList.add('flash-reduced');
                        setTimeout(() => playerShield.classList.remove('flash-reduced'), 360);
                    }
                }, 20);
            }

            if (player.pv <= 0) {
                message += `<br>Défaite ! Retour au village.`;
                pushHistory(history, turn, 'Défaite ! Retour au village.');
                hero.pv = player.pv;
                hero.currentMana = player.currentMana;
                syncHeroToCombatClone();
                render();
                return;
            }

            // Début du tour du joueur (après l'action de l'ennemi)
            player.tickSkillCooldowns?.();
            const playerStartMsgs = player.updateEffects();
            if (playerStartMsgs.length) pushHistoryMany(history, turn, playerStartMsgs);
            if (player.pv <= 0) {
                message += `<br>Défaite ! Retour au village.`;
                pushHistory(history, turn, 'Défaite ! Retour au village.');
                hero.pv = player.pv;
                hero.currentMana = player.currentMana;
                syncHeroToCombatClone();
                render();
                return;
            }

            // Début du tour du joueur : régénération mana/tour
            {
                const beforeMana = player.currentMana;
                const activeManaRegen = (player.activeEffects || [])
                    .filter((e: any) => e.type === 'mana_regen' && e.remainingTurns !== 0)
                    .reduce((s: number, e: any) => s + (e.amount || 0), 0);
                const regen = (player.manaRegenPerTurn || 0) + (player.getPassiveManaRegenPerTurnBonus?.() ?? 0) + activeManaRegen;
                player.currentMana = Math.min(player.currentMana + regen, player.maxMana);
                if (player.currentMana > beforeMana) {
                    pushHistory(history, turn, `${player.name} régénère ${player.currentMana - beforeMana} mana (Mana ${beforeMana} → ${player.currentMana})`);
                }
            }

            // Début du tour du joueur
            player.actionPoints = player.actionPointsMax;
            isPlayerTurn = true;
            render();
        }, 900);
    }

    function computeVictoryRewards(): { xp: number; gold: number; wood: number; herb: number; bonusPct: number } {
        const baseXp = enemy.xpReward;
        const baseGold = enemy.goldReward;
        const baseWood = Number((enemy as any).woodReward ?? 0);
        const baseHerb = Number((enemy as any).herbReward ?? 0);
        const xp = Math.round(baseXp * comboMultiplier);
        const gold = Math.round(baseGold * comboMultiplier);
        const wood = Math.round(baseWood * comboMultiplier);
        const herb = Math.round(baseHerb * comboMultiplier);
        return { xp, gold, wood, herb, bonusPct: comboBonusPct };
    }

    function renderEndCombatInventoryEquipment(): string {
        const slotLabel: Record<string, string> = { weapon: 'Arme', armor: 'Armure', ring: 'Anneau' };
        const slots = ['weapon', 'armor', 'ring'] as const;

        const equipmentLines = slots
            .map((slot) => {
                const eq = (hero.equipment as any)[slot] as { name: string } | undefined;
                return `
                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                        <span>${slotLabel[slot]} :</span>
                        <span style="display:flex;gap:10px;align-items:center;">
                            <b>${eq ? eq.name : '—'}</b>
                            ${eq ? `<button class="btn" data-unequip-slot="${slot}" style="min-width:80px;">Retirer</button>` : ''}
                        </span>
                    </div>
                `;
            })
            .join('');

        const invLines = hero.inventory.length === 0
            ? `<em>Aucun objet</em>`
            : `
                <ul id="combatEndInventoryBlock" style="list-style:none;padding:0;margin:0;">
                    ${hero.inventory
                        .map(
                            (it, idx) => {
                                const isSelected = selectedEndInvIdx === idx;
                                return `
                        <li data-combat-inv-row="${idx}" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;user-select:none;${isSelected ? 'outline:1px solid rgba(255,235,59,0.35);border-radius:10px;background:rgba(255,255,255,0.05);padding:6px 8px;' : ''}">
                            <div style="flex:1;">
                                <div style="font-weight:600;color:#fff;">${it.name}</div>
                                <div style="font-size:0.9em;color:#ddd;">${it.description}</div>
                            </div>
                            <div style="white-space:nowrap;">
                                ${isSelected && ((it as any).constructor && (it as any).constructor.name === 'Consumable') ? `<button class="btn" data-inv-idx="${idx}" style="min-width:80px;">Utiliser</button>` : ''}
                                ${isSelected && ((it as any).constructor && (it as any).constructor.name === 'Equipment') ? `<button class="btn" data-equip-idx="${idx}" style="min-width:80px;">Équiper</button>` : ''}
                            </div>
                        </li>
                    `;
                            }
                        )
                        .join('')}
                </ul>
            `;

        return `
            <div style="margin-top:14px; display:flex; gap:14px; flex-wrap:wrap; justify-content:center;">
                <div style="min-width:320px; max-width:520px; flex:1; padding:10px 12px; background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.08); border-radius:10px; text-align:left;">
                    <div style="font-weight:700; margin-bottom:6px;">Équipement</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">${equipmentLines}</div>
                </div>
                <div style="min-width:320px; max-width:520px; flex:1; padding:10px 12px; background:rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.08); border-radius:10px; text-align:left;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                        <div style="font-weight:700;">Inventaire</div>
                        <div style="color:#ddd;"><b>Or :</b> ${hero.gold}</div>
                    </div>
                    <div style="margin-top:8px; color:#ddd; font-size:0.95em;">${invLines}</div>
                </div>
            </div>
        `;
    }

    function syncHeroToCombatClone() {
        player.inventory = [...(hero.inventory || [])];
        player.equipment = Object.assign({}, hero.equipment);
        player.maxPv = hero.effectiveMaxPv;
        player.maxMana = hero.effectiveMaxMana;
        player.pv = Math.min(hero.pv, player.maxPv);
        player.currentMana = Math.min(hero.currentMana, player.maxMana);
    }

    function applyVictoryRewards() {
        const { xp, gold, wood, herb, bonusPct } = computeVictoryRewards();
        const bonusTxt = bonusPct > 0 ? ` (Bonus combo +${bonusPct}%)` : '';
        const woodTxt = wood > 0 ? ` et ${wood} bois` : '';
        const herbTxt = herb > 0 ? ` et ${herb} herbes` : '';
        pushHistory(history, turn, `Victoire ! Vous gagnez ${xp} XP et ${gold} or${woodTxt}${herbTxt}.${bonusTxt}`);
        hero.gainXP ? hero.gainXP(xp) : hero.currentXP += xp;
        hero.gold += gold;
        hero.wood = (hero.wood ?? 0) + wood;
        (hero as any).herb = (hero as any).herb ?? 0;
        (hero as any).herb = (hero as any).herb + herb;
        hero.pv = player.pv;
        hero.currentMana = player.currentMana;
        syncHeroToCombatClone();
    }

    function render() {
        if (!app) return;
        const combatEnded = enemy.pv <= 0 || player.pv <= 0;
        const playerHpPct = Math.max(0, Math.round((player.pv / player.maxPv) * 100));
        const enemyHpPct = Math.max(0, Math.round((enemy.pv / enemy.maxPv) * 100));
        const playerManaPct = Math.max(0, Math.round((player.currentMana / player.maxMana) * 100));
        const enemyManaPct = Math.max(0, Math.round((enemy.currentMana / enemy.maxMana) * 100));
        // Aggregate buff/debuff percents for display
        const playerBuffPct = Math.round(player.activeEffects.filter(e => e.type === 'buff').reduce((s, e) => s + (e.amount || 0), 0) * 100);
        const playerDebuffPct = Math.round(player.activeEffects.filter(e => e.type === 'debuff').reduce((s, e) => s + (e.amount || 0), 0) * 100);
        const playerDefenseArr = player.activeEffects.filter(e => e.type === 'defense');
        const playerDefensePct = Math.round(playerDefenseArr.reduce((s, e) => s + (e.amount || 0), 0) * 100);
        const playerDefenseTurn = playerDefenseArr.some(e => e.remainingTurns === -1) ? -1 : (playerDefenseArr.filter(e => e.remainingTurns > 0).map(e => e.remainingTurns)[0] || 0);
        const enemyBuffPct = Math.round(enemy.activeEffects.filter(e => e.type === 'buff').reduce((s, e) => s + (e.amount || 0), 0) * 100);
        const enemyDebuffPct = Math.round(enemy.activeEffects.filter(e => e.type === 'debuff').reduce((s, e) => s + (e.amount || 0), 0) * 100);
        const enemyDefenseArr = enemy.activeEffects.filter(e => e.type === 'defense');
        const enemyDefensePct = Math.round(enemyDefenseArr.reduce((s, e) => s + (e.amount || 0), 0) * 100);
        const enemyDefenseTurn = enemyDefenseArr.some(e => e.remainingTurns === -1) ? -1 : (enemyDefenseArr.filter(e => e.remainingTurns > 0).map(e => e.remainingTurns)[0] || 0);
        const playerCls = String((player as any).characterClass ?? '').toLowerCase();
        const playerSpriteSrc = playerCls === 'mage'
            ? 'ImagesRPG/imagespersonnage/mage.png'
            : playerCls === 'voleur'
                ? 'ImagesRPG/imagespersonnage/voleur.png'
                : 'ImagesRPG/imagespersonnage/trueplayer.png';

        let playerImgStyle = "max-width:260px;width:38vw;max-height:240px;height:auto;object-fit:contain;";
        if (playerCls === 'mage') playerImgStyle += ' transform:scale(0.9);';
        if (playerCls === 'voleur') playerImgStyle += ' transform:scale(0.8);';

        app.innerHTML = `
            <img src="${backgroundUrl}" class="background" alt="Combat">
            <div class="centered-content">
                <h1>${title} ${enemy.name}</h1>
                <div class="hp-row">
                    <div class="hp-column">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div class="hp-label"><b>${player.name}</b> - PV : ${player.pv} / ${player.maxPv}</div>
                            <div class="stat-badges-inline">
                                ${playerBuffPct > 0 ? `<span class="stat-badge up"><span class="icon">🗡️</span>▲ ${playerBuffPct}%</span>` : ''}
                                ${playerDebuffPct > 0 ? `<span class="stat-badge down"><span class="icon">🗡️</span>▼ ${playerDebuffPct}%</span>` : ''}
                                ${playerDefensePct > 0 ? `<span class="stat-badge defense"><span class="icon">🛡️</span>Bloc ${playerDefensePct}%${playerDefenseTurn > 0 ? ` (${playerDefenseTurn}t)` : playerDefenseTurn === -1 ? ' (combat)' : ''}</span>` : ''}
                            </div>
                        </div>
                        <div class="hp-bar-container"><div class="hp-bar player" style="width:${playerHpPct}%;"></div><div class="bar-label">${player.pv}/${player.maxPv}</div></div>
                        <div class="mana-bar-container"><div class="mana-bar" style="width:${playerManaPct}%;"></div><div class="bar-label">${player.currentMana}/${player.maxMana}</div></div>
                        <div class="pa-bar-container" style="margin-top:4px;"><span class="bar-label"><b>PA :</b> ${player.actionPoints} / ${player.actionPointsMax}</span></div>
                    </div>
                    <div class="hp-column" style="text-align:right">
                        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
                            <div class="stat-badges-inline">
                                ${enemyBuffPct > 0 ? `<span class="stat-badge up"><span class="icon">🗡️</span>▲ ${enemyBuffPct}%</span>` : ''}
                                ${enemyDebuffPct > 0 ? `<span class="stat-badge down"><span class="icon">🗡️</span>▼ ${enemyDebuffPct}%</span>` : ''}
                                ${enemyDefensePct > 0 ? `<span class="stat-badge defense"><span class="icon">🛡️</span>Bloc ${enemyDefensePct}%${enemyDefenseTurn > 0 ? ` (${enemyDefenseTurn}t)` : enemyDefenseTurn === -1 ? ' (combat)' : ''}</span>` : ''}
                            </div>
                            <div class="hp-label"><b>${enemy.name}</b> - PV : ${enemy.pv} / ${enemy.maxPv}</div>
                        </div>
                        <div class="hp-bar-container"><div class="hp-bar enemy" style="width:${enemyHpPct}%;"></div><div class="bar-label">${enemy.pv}/${enemy.maxPv}</div></div>
                        <div class="mana-bar-container"><div class="mana-bar" style="width:${enemyManaPct}%;"></div><div class="bar-label">${enemy.currentMana}/${enemy.maxMana}</div></div>
                    </div>
                </div>
                <div id="combat-sprites" style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin:18px auto 6px auto;max-width:760px;width:100%;">
                    <img src="${playerSpriteSrc}" alt="${player.name}" style="${playerImgStyle}" />
                    <img src="ImagesRPG/imagespersonnage/trueennemi.png" alt="${enemy.name}" style="max-width:260px;width:38vw;max-height:240px;height:auto;object-fit:contain;" />
                </div>
                <div id="player-effects" class="effect-badges">
                    ${player.activeEffects.map(e => `<span class="effect-badge ${e.type === 'buff' ? 'buff' : e.type === 'debuff' ? 'debuff' : e.type === 'defense' ? 'defense' : e.type === 'mana_regen' ? 'buff' : ''}">${e.type === 'buff' ? 'Buff' : e.type === 'debuff' ? 'Debuff' : e.type === 'defense' ? '🛡 Blocage' : e.type === 'mana_regen' ? 'Mana regen' : e.type.toUpperCase()} ${e.type === 'mana_regen' ? '+' + e.amount + ' mana/t' : (e.amount ? Math.round(e.amount * 100) + '%' : '')}${e.remainingTurns > 0 ? ' (' + e.remainingTurns + 't)' : e.remainingTurns === -1 ? ' (combat)' : ''}</span>`).join('')}
                </div>
                <div id="enemy-effects" class="effect-badges">
                    ${enemy.activeEffects.map(e => `<span class="effect-badge ${e.type === 'buff' ? 'buff' : e.type === 'debuff' ? 'debuff' : e.type === 'defense' ? 'defense' : e.type === 'mana_regen' ? 'buff' : ''}">${e.type === 'buff' ? 'Buff' : e.type === 'debuff' ? 'Debuff' : e.type === 'defense' ? '🛡 Blocage' : e.type === 'mana_regen' ? 'Mana regen' : e.type.toUpperCase()} ${e.type === 'mana_regen' ? '+' + e.amount + ' mana/t' : (e.amount ? Math.round(e.amount * 100) + '%' : '')}${e.remainingTurns > 0 ? ' (' + e.remainingTurns + 't)' : e.remainingTurns === -1 ? ' (combat)' : ''}</span>`).join('')}
                </div>
                <div id="combat-message">${message}</div>
                <div id="recent-infos" style="margin:10px 0 15px 0; color:#e0e0e0; font-size:1.05em;">
                    ${renderHistoryHtml(history, 3)}
                </div>
                ${combatEnded ? `
                    <div id="end-actions" style="margin-top:10px; display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                        ${(enemy.pv <= 0 && showAgainButton) ? `<button class='btn' id='againBtn'>Combattre à nouveau</button>` : ''}
                        <button class='btn' id='villageBtn'>Retour village</button>
                    </div>
                ` : ''}
                ${combatEnded ? renderEndCombatInventoryEquipment() : ''}
            </div>
            <div class="combat-history">
                <div class="combat-history-title">Historique du combat</div>
                ${renderHistoryHtml(history, 10)}
            </div>
            <div id="skills-bar" style="position:fixed;bottom:0;left:0;width:100vw;display:flex;justify-content:center;align-items:center;padding:24px 0 18px 0;z-index:10;background:rgba(0,0,0,0.4);gap:16px;"></div>
        `;
        // Ajoute le bouton Fuir à la fin du body pour garantir sa visibilité UNIQUEMENT en combat
        // Supprime toujours le bouton Fuir du DOM (même hors combat)
        const oldFuirBtn = document.getElementById('fuirBtn');
        if (oldFuirBtn && document.body.contains(oldFuirBtn)) document.body.removeChild(oldFuirBtn);
        // Ajoute le bouton uniquement si on est en combat (présence de .combat-history)
        if (document.querySelector('.combat-history')) {
            const fuirBtn = document.createElement('button');
            fuirBtn.className = 'btn';
            fuirBtn.id = 'fuirBtn';
            fuirBtn.textContent = 'Fuir';
            document.body.appendChild(fuirBtn);
            fuirBtn.onclick = showVillage;
        }
        {
            const skillsDiv = document.getElementById('skills-bar');
            if (skillsDiv) {
                const baseSkills = (player.skills ?? []);
                renderSkillButtons(skillsDiv, baseSkills, playTurn, {
                    buttonClass: 'btn skill-btn',
                    buttonStyle: 'margin:0 12px 0 0;display:inline-block;',
                    playerPA: player.actionPoints,
                    getCooldownRemaining: (skill) => player.getSkillCooldownRemaining?.(skill) ?? 0,
                });

                // Ajoute le bouton "Passer le tour" à côté des compétences
                skillsDiv.insertAdjacentHTML(
                    'beforeend',
                    `<button class='btn' id='passTurnBtn' style='margin:0 12px 0 0;display:inline-block;'>Passer le tour</button>`
                );
                const passBtn = document.getElementById('passTurnBtn') as HTMLButtonElement | null;
                if (passBtn) {
                    passBtn.disabled = !isPlayerTurn || combatEnded;
                    passBtn.onclick = () => {
                        if (!isPlayerTurn || combatEnded) return;

                        // Fin du tour du joueur : fait avancer les durées buff/debuff du joueur
                        const playerEndMsgs = player.endTurnEffects?.() || [];
                        if (playerEndMsgs.length) pushHistoryMany(history, turn, playerEndMsgs);

                        isPlayerTurn = false;
                        startEnemyTurnAfterDelay();
                        render();
                    };
                }
            }
        }
        document.getElementById('fuirBtn')?.addEventListener('click', showVillage);

        if (combatEnded) {
            document.getElementById('villageBtn')?.addEventListener('click', showVillage);
            document.getElementById('againBtn')?.addEventListener('click', () => {
                if (options.onAgain) return options.onAgain();
                const nextComboIndex = Math.min((options.comboIndex ?? 1) + 1, 5);
                return showCombat(enemyLevel + 1, { ...options, comboIndex: nextComboIndex });
            });

            const invButtons = document.querySelectorAll('[data-inv-idx]');
            invButtons.forEach(btn => {
                (btn as HTMLElement).addEventListener('click', () => {
                    selectedEndInvIdx = null;
                    const idx = Number((btn as HTMLElement).getAttribute('data-inv-idx'));
                    const msg = hero.useItem(idx);
                    message = msg;
                    pushHistory(history, turn, msg);
                    // sync hero state into the clone for UI consistency
                    syncHeroToCombatClone();
                    render();
                });
            });

            const equipButtons = document.querySelectorAll('[data-equip-idx]');
            equipButtons.forEach(btn => {
                (btn as HTMLElement).addEventListener('click', () => {
                    selectedEndInvIdx = null;
                    const idx = Number((btn as HTMLElement).getAttribute('data-equip-idx'));
                    const msg = hero.equipItem(idx);
                    message = msg;
                    pushHistory(history, turn, msg);
                    syncHeroToCombatClone();
                    render();
                });
            });

            const invRows = document.querySelectorAll('[data-combat-inv-row]');
            invRows.forEach((row) => {
                (row as HTMLElement).addEventListener('click', (ev) => {
                    const t = ev.target as HTMLElement | null;
                    if (t?.closest('button')) return;
                    const idx = Number((row as HTMLElement).getAttribute('data-combat-inv-row'));
                    selectedEndInvIdx = Number.isFinite(idx) ? idx : null;
                    render();
                });
                (row as HTMLElement).addEventListener('contextmenu', (ev) => {
                    ev.preventDefault();
                    selectedEndInvIdx = null;
                    render();
                });
            });

            (document.getElementById('combatEndInventoryBlock') as HTMLElement | null)?.addEventListener('click', (ev) => {
                const t = ev.target as HTMLElement | null;
                if (!t) return;
                if (t.closest('[data-combat-inv-row]') || t.closest('button')) return;
                selectedEndInvIdx = null;
                render();
            });

            const unequipButtons = document.querySelectorAll('[data-unequip-slot]');
            unequipButtons.forEach(btn => {
                (btn as HTMLElement).addEventListener('click', () => {
                    const slot = (btn as HTMLElement).getAttribute('data-unequip-slot') as import('./item.js').EquipmentSlot;
                    const msg = hero.unequipSlot(slot);
                    message = msg;
                    pushHistory(history, turn, msg);
                    syncHeroToCombatClone();
                    render();
                });
            });
        }
    }
    function playTurn(skill: Skill) {
        const effectiveSkill = getEffectiveSkillForCaster(skill, player);

        // Anti spam-clic / multi-actions
        if (!isPlayerTurn) return;
        if (player.pv <= 0 || enemy.pv <= 0) return;
        if (isResolvingPlayerAction) return;

        // Vérifie les points d'action
        if (player.actionPoints < effectiveSkill.actionPoints) {
            message = `Pas assez de points d'action pour utiliser ${effectiveSkill.name} (coût : ${effectiveSkill.actionPoints})`;
            pushHistory(history, turn, message);
            render();
            return;
        }

        // Vérifie le cooldown (basé sur le skill "de base")
        const cd = player.getSkillCooldownRemaining?.(skill) ?? 0;
        if (cd > 0) {
            message = `${effectiveSkill.name} est en cooldown (${cd} tour(s) restant(s)).`;
            pushHistory(history, turn, message);
            render();
            return;
        }

        isResolvingPlayerAction = true;

        const res = applyPlayerSkillTurn({ caster: player, target: enemy, skill, turn });
        if (!res.ok) {
            message = res.message;
            pushHistory(history, turn, message);
            isResolvingPlayerAction = false;
            render();
            return;
        }

        // Consomme les PA uniquement si l'action a réussi
        player.actionPoints -= effectiveSkill.actionPoints;

        // SFX: déclenche un son d'attaque pour certaines compétences du joueur
        if (effectiveSkill.name === 'Attaque de base' || effectiveSkill.name === 'Hache lourde' || effectiveSkill.name === 'Buff attaque') {
            window.game?.audioManager.play('attaque');
        }
        // SFX spécifique : Boule de feu
        if (effectiveSkill.name === 'Boule de feu') {
            window.game?.audioManager.play('bouledefeu');
        }

        message = res.message;
        pushHistory(history, turn, message);
        pushHistoryMany(history, turn, res.extraHistory);

        if (res.healFlashOnCaster) {
            render();
            setTimeout(() => {
                const playerHp = document.querySelector('.hp-bar.player') as HTMLElement | null;
                if (playerHp) {
                    playerHp.classList.add('flash-heal');
                    setTimeout(() => playerHp.classList.remove('flash-heal'), 360);
                }
            }, 20);
        }

        if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
            render();
            setTimeout(() => {
                const enemyHp = document.querySelector('.hp-bar.enemy') as HTMLElement | null;
                const enemyShield = document.querySelector('.stat-badge.defense') as HTMLElement | null;
                if (enemyHp) {
                    enemyHp.classList.add('flash-damage');
                    setTimeout(() => enemyHp.classList.remove('flash-damage'), 600);
                }
                if (res.damageFlashOnTarget?.reduced && enemyShield) {
                    enemyShield.classList.add('flash-reduced');
                    setTimeout(() => enemyShield.classList.remove('flash-reduced'), 360);
                }
            }, 20);
        }

        // Vérifie la victoire
        if (enemy.pv <= 0) {
            const { xp, gold, bonusPct } = computeVictoryRewards();
            const bonusTxt = bonusPct > 0 ? ` (Bonus combo +${bonusPct}%)` : '';
            message += `<br>Victoire ! Vous gagnez ${xp} XP et ${gold} or.${bonusTxt}`;
            applyVictoryRewards();
            isResolvingPlayerAction = false;
            render();
            return;
        }
        // Le tour ennemi démarre uniquement via le bouton "Passer le tour"
        isResolvingPlayerAction = false;
        render();
    }

    // Début du 1er tour du joueur : déclenchement des effets (HoT/DoT, fin buff/debuff)
    player.tickSkillCooldowns?.();
    player.actionPoints = player.actionPointsMax;
    const startMsgs = player.updateEffects();
    if (startMsgs.length) pushHistoryMany(history, turn, startMsgs);
    if (player.pv <= 0) {
        message = 'Défaite ! Retour au village.';
        pushHistory(history, turn, 'Défaite ! Retour au village.');
        hero.pv = player.pv;
        hero.currentMana = player.currentMana;
        syncHeroToCombatClone();
        render();
        return;
    }

    // Début du tour du joueur : régénération mana/tour
    {
        const beforeMana = player.currentMana;
        const activeManaRegen = (player.activeEffects || [])
            .filter((e: any) => e.type === 'mana_regen' && e.remainingTurns !== 0)
            .reduce((s: number, e: any) => s + (e.amount || 0), 0);
        const regen = (player.manaRegenPerTurn || 0) + (player.getPassiveManaRegenPerTurnBonus?.() ?? 0) + activeManaRegen;
        player.currentMana = Math.min(player.currentMana + regen, player.maxMana);
        if (player.currentMana > beforeMana) {
            pushHistory(history, turn, `${player.name} régénère ${player.currentMana - beforeMana} mana (Mana ${beforeMana} → ${player.currentMana})`);
        }
    }

    render();
}
