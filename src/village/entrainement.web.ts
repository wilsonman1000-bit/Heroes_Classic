import { hero } from '../index.web.js';
import { Player } from '../player.js';
import { type Skill } from '../skill.js';
import { createSkill } from '../skillLibrary.js';
import { applyAutoTurn, applyPlayerSkillTurn } from '../battleTurn.web.js';
import { type HistoryEntry, pushHistory, pushHistoryMany, renderHistoryHtml } from '../history.web.js';
import { renderSkillButtons } from '../skillUi.web.js';

function goVillage() {
    // Avoid static circular dependencies with the village facade
    void import('./villageMain.web.js').then((m) => m.showVillage());
}

export function showEntrainement() {
    const app = document.getElementById('app');
    if (!app) return;

    const masterLevel = hero.level;
    const masterPv = 80 + masterLevel * 25;
    const masterAttack = Math.floor((8 + masterLevel * 2) / 2);
    const masterMana = 20 + masterLevel * 1;

    const masterXp = 10;
    const masterGold = 5 + masterLevel * 2;
    const master = new Player(
        `Maître niveau ${masterLevel}`,
        masterPv,
        masterPv,
        masterAttack,
        [createSkill('master_attack')],
        masterMana,
        false,
        0,
        0,
        masterXp,
        masterGold
    );

    let trainee = hero.clone();
    trainee.maxPv = hero.effectiveMaxPv;
    trainee.pv = trainee.maxPv;
    trainee.maxMana = hero.effectiveMaxMana;
    trainee.currentMana = trainee.maxMana;

    let enemy = master;
    let turn = 1;
    let message = '';
    let selectedEndInvIdx: number | null = null;
    let history: HistoryEntry[] = [];

    function renderEndInventoryEquipment(): string {
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
                <ul id="trainingEndInventoryBlock" style="list-style:none;padding:0;margin:0;">
                    ${hero.inventory
                        .map(
                            (it, idx) => {
                                const isSelected = selectedEndInvIdx === idx;
                                return `
                        <li data-training-inv-row="${idx}" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;user-select:none;${isSelected ? 'outline:1px solid rgba(255,235,59,0.35);border-radius:10px;background:rgba(255,255,255,0.05);padding:6px 8px;' : ''}">
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

    function syncHeroToTraineeClone() {
        trainee.inventory = [...(hero.inventory || [])];
        trainee.equipment = Object.assign({}, hero.equipment);
        trainee.maxPv = hero.effectiveMaxPv;
        trainee.maxMana = hero.effectiveMaxMana;
        trainee.pv = Math.min(hero.pv, trainee.maxPv);
        trainee.currentMana = Math.min(hero.currentMana, trainee.maxMana);
    }

    // Début du 1er tour du joueur (entraînement)
    const startMsgs = trainee.updateEffects();
    if (startMsgs.length) pushHistoryMany(history, turn, startMsgs);
    if (trainee.pv <= 0) {
        message = 'Défaite ! Retour au village.';
        pushHistory(history, turn, 'Défaite ! Retour au village.');
        hero.pv = trainee.pv;
        hero.currentMana = trainee.currentMana;
        renderTraining();
        return;
    }

    // Début du tour du joueur : régénération mana/tour
    {
        const beforeMana = trainee.currentMana;
        const regen = (trainee.manaRegenPerTurn || 0) + trainee.getPassiveManaRegenPerTurnBonus();
        trainee.currentMana = Math.min(trainee.currentMana + regen, trainee.maxMana);
        if (trainee.currentMana > beforeMana) {
            pushHistory(history, turn, `${trainee.name} régénère ${trainee.currentMana - beforeMana} mana (Mana ${beforeMana} → ${trainee.currentMana})`);
        }
    }

    function renderTraining() {
        const app = document.getElementById('app');
        if (!app) return;

        const combatEnded = enemy.pv <= 0 || trainee.pv <= 0;
        if (!combatEnded) {
            app.innerHTML = `
                <img src="https://s1.dmcdn.net/v/SQtz81XF1Q2rdQZLt/x1080" class="background" alt="Entraînement">
                <div class="centered-content">
                    <h1>Entraînement contre le maître</h1>
                    <div class="hp-row">
                        <div class="hp-column">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <div class="hp-label"><b>${trainee.name}</b> - PV : ${trainee.pv} / ${trainee.maxPv}</div>
                                <div class="stat-badges-inline">
                                    ${Math.round(trainee.activeEffects.filter(e => e.type === 'buff').reduce((s, e) => s + (e.amount || 0), 0) * 100) > 0 ? `<span class="stat-badge up"><span class="icon">🗡️</span>▲ ${Math.round(trainee.activeEffects.filter(e => e.type === 'buff').reduce((s, e) => s + (e.amount || 0), 0) * 100)}%</span>` : ''}
                                    ${Math.round(trainee.activeEffects.filter(e => e.type === 'debuff').reduce((s, e) => s + (e.amount || 0), 0) * 100) > 0 ? `<span class="stat-badge down"><span class="icon">🗡️</span>▼ ${Math.round(trainee.activeEffects.filter(e => e.type === 'debuff').reduce((s, e) => s + (e.amount || 0), 0) * 100)}%</span>` : ''}
                                    ${Math.round(trainee.activeEffects.filter(e => e.type === 'defense').reduce((s, e) => s + (e.amount || 0), 0) * 100) > 0 ? `<span class="stat-badge defense"><span class="icon">🛡️</span>Bloc ${Math.round(trainee.activeEffects.filter(e => e.type === 'defense').reduce((s, e) => s + (e.amount || 0), 0) * 100)}%${trainee.activeEffects.some(e=>e.type==='defense' && e.remainingTurns===-1) ? ' (combat)' : (trainee.activeEffects.filter(e=>e.type==='defense' && e.remainingTurns>0).map(e=>e.remainingTurns)[0] ? ` (${trainee.activeEffects.filter(e=>e.type==='defense' && e.remainingTurns>0).map(e=>e.remainingTurns)[0]}t)` : '')}</span>` : ''}
                                </div>
                            </div>
                            <div class="hp-bar-container"><div class="hp-bar player" style="width:${Math.max(0, Math.round((trainee.pv/trainee.maxPv)*100))}%;"></div><div class="bar-label">${trainee.pv}/${trainee.maxPv}</div></div>
                            <div class="mana-bar-container"><div class="mana-bar" style="width:${Math.max(0, Math.round((trainee.currentMana/trainee.maxMana)*100))}%;"></div><div class="bar-label">${trainee.currentMana}/${trainee.maxMana}</div></div>
                        </div>
                        <div class="hp-column" style="text-align:right">
                            <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
                                <div class="stat-badges-inline">
                                    ${Math.round(enemy.activeEffects.filter(e => e.type === 'buff').reduce((s, e) => s + (e.amount || 0), 0) * 100) > 0 ? `<span class="stat-badge up"><span class="icon">🗡️</span>▲ ${Math.round(enemy.activeEffects.filter(e => e.type === 'buff').reduce((s, e) => s + (e.amount || 0), 0) * 100)}%</span>` : ''}
                                    ${Math.round(enemy.activeEffects.filter(e => e.type === 'debuff').reduce((s, e) => s + (e.amount || 0), 0) * 100) > 0 ? `<span class="stat-badge down"><span class="icon">🗡️</span>▼ ${Math.round(enemy.activeEffects.filter(e => e.type === 'debuff').reduce((s, e) => s + (e.amount || 0), 0) * 100)}%</span>` : ''}
                                ${Math.round(enemy.activeEffects.filter(e => e.type === 'defense').reduce((s, e) => s + (e.amount || 0), 0) * 100) > 0 ? `<span class="stat-badge defense"><span class="icon">🛡️</span>Bloc ${Math.round(enemy.activeEffects.filter(e => e.type === 'defense').reduce((s, e) => s + (e.amount || 0), 0) * 100)}%${enemy.activeEffects.some(e=>e.type==='defense' && e.remainingTurns===-1) ? ' (combat)' : (enemy.activeEffects.filter(e=>e.type==='defense' && e.remainingTurns>0).map(e=>e.remainingTurns)[0] ? ` (${enemy.activeEffects.filter(e=>e.type==='defense' && e.remainingTurns>0).map(e=>e.remainingTurns)[0]}t)` : '')}</span>` : ''}
                                </div>
                                <div class="hp-label"><b>${enemy.name}</b> - PV : ${enemy.pv} / ${enemy.maxPv}</div>
                            </div>
                            <div class="hp-bar-container"><div class="hp-bar enemy" style="width:${Math.max(0, Math.round((enemy.pv/enemy.maxPv)*100))}%;"></div><div class="bar-label">${enemy.pv}/${enemy.maxPv}</div></div>
                            <div class="mana-bar-container"><div class="mana-bar" style="width:${Math.max(0, Math.round((enemy.currentMana/enemy.maxMana)*100))}%;"></div><div class="bar-label">${enemy.currentMana}/${enemy.maxMana}</div></div>
                        </div>
                    </div>
                    <div id="player-effects" class="effect-badges">
                        ${trainee.activeEffects.map(e => `<span class="effect-badge ${e.type === 'buff' ? 'buff' : e.type === 'debuff' ? 'debuff' : e.type === 'defense' ? 'defense' : e.type === 'mana_regen' ? 'buff' : ''}">${e.type === 'buff' ? 'Buff' : e.type === 'debuff' ? 'Debuff' : e.type === 'defense' ? '🛡 Blocage' : e.type === 'mana_regen' ? 'Mana regen' : e.type.toUpperCase()} ${e.type === 'mana_regen' ? '+' + e.amount + ' mana/t' : (e.amount ? Math.round(e.amount * 100) + '%' : '')}${e.remainingTurns > 0 ? ' (' + e.remainingTurns + 't)' : e.remainingTurns === -1 ? ' (combat)' : ''}</span>`).join('')}
                    </div>
                    <div id="enemy-effects" class="effect-badges">
                        ${enemy.activeEffects.map(e => `<span class="effect-badge ${e.type === 'buff' ? 'buff' : e.type === 'debuff' ? 'debuff' : e.type === 'mana_regen' ? 'buff' : ''}">${e.type === 'buff' ? 'Buff' : e.type === 'debuff' ? 'Debuff' : e.type === 'mana_regen' ? 'Mana regen' : e.type.toUpperCase()} ${e.type === 'mana_regen' ? '+' + e.amount + ' mana/t' : (e.amount ? Math.round(e.amount * 100) + '%' : '')}${e.remainingTurns > 0 ? ' (' + e.remainingTurns + 't)' : e.remainingTurns === -1 ? ' (combat)' : ''}</span>`).join('')}
                    </div>
                    <div id="combat-message">${message}</div>
                    <div id="recent-infos" style="margin:10px 0 15px 0; color:#e0e0e0; font-size:1.05em;">
                        ${renderHistoryHtml(history, 3)}
                    </div>
                    <button class="btn" id="fuirBtn">Fuir</button>
                </div>
                <div class="combat-history">
                    <div class="combat-history-title">Historique du combat</div>
                    ${renderHistoryHtml(history, 10)}
                </div>
                <div id="skills-bar" style="position:fixed;bottom:0;left:0;width:100vw;display:flex;justify-content:center;align-items:center;padding:24px 0 18px 0;z-index:10;background:rgba(0,0,0,0.4);gap:16px;"></div>
            `;

            if (trainee.pv > 0 && enemy.pv > 0) {
                const skillsDiv = document.getElementById('skills-bar');
                if (skillsDiv) {
                    renderSkillButtons(skillsDiv, trainee.skills, playTrainingTurn);
                }
            }
            document.getElementById('fuirBtn')?.addEventListener('click', goVillage);
        } else {
            app.innerHTML = `
                <img src="https://s1.dmcdn.net/v/SQtz81XF1Q2rdQZLt/x1080" class="background" alt="Entraînement">
                <div class="centered-content">
                    <h1>Combat terminé</h1>
                    <p><b>${trainee.name}</b> - PV : ${trainee.pv} / ${trainee.maxPv} | Mana : ${trainee.currentMana} / ${trainee.maxMana}</p>
                    <div id="player-effects" class="effect-badges">
                        ${trainee.activeEffects.map(e => `<span class="effect-badge ${e.type === 'buff' ? 'buff' : e.type === 'debuff' ? 'debuff' : e.type === 'defense' ? 'defense' : e.type === 'mana_regen' ? 'buff' : ''}">${e.type === 'buff' ? 'Buff' : e.type === 'debuff' ? 'Debuff' : e.type === 'defense' ? '🛡 Blocage' : e.type === 'mana_regen' ? 'Mana regen' : e.type.toUpperCase()} ${e.type === 'mana_regen' ? '+' + e.amount + ' mana/t' : (e.amount ? Math.round(e.amount * 100) + '%' : '')}${e.remainingTurns > 0 ? ' (' + e.remainingTurns + 't)' : e.remainingTurns === -1 ? ' (combat)' : ''}</span>`).join('')}
                    </div>
                    <p><b>${enemy.name}</b> - PV : ${enemy.pv} / ${enemy.maxPv} | Mana : ${enemy.currentMana} / ${enemy.maxMana}</p>
                    <div id="enemy-effects" class="effect-badges">
                        ${enemy.activeEffects.map(e => `<span class="effect-badge ${e.type === 'buff' ? 'buff' : e.type === 'debuff' ? 'debuff' : e.type === 'defense' ? 'defense' : e.type === 'mana_regen' ? 'buff' : ''}">${e.type === 'buff' ? 'Buff' : e.type === 'debuff' ? 'Debuff' : e.type === 'defense' ? '🛡 Blocage' : e.type === 'mana_regen' ? 'Mana regen' : e.type.toUpperCase()} ${e.type === 'mana_regen' ? '+' + e.amount + ' mana/t' : (e.amount ? Math.round(e.amount * 100) + '%' : '')}${e.remainingTurns > 0 ? ' (' + e.remainingTurns + 't)' : e.remainingTurns === -1 ? ' (combat)' : ''}</span>`).join('')}
                    </div>
                    <div id="combat-message">${message}</div>
                    <div id="recent-infos" style="margin:10px 0 15px 0; color:#e0e0e0; font-size:1.05em;">
                        ${renderHistoryHtml(history, 10)}
                    </div>
                    <button class="btn" id="retourVillageBtn">Retour village</button>
                    ${renderEndInventoryEquipment()}
                </div>
            `;
            document.getElementById('retourVillageBtn')?.addEventListener('click', goVillage);

            const invButtons = document.querySelectorAll('[data-inv-idx]');
            invButtons.forEach(btn => {
                (btn as HTMLElement).addEventListener('click', () => {
                    selectedEndInvIdx = null;
                    const idx = Number((btn as HTMLElement).getAttribute('data-inv-idx'));
                    const msg = hero.useItem(idx);
                    message = msg;
                    pushHistory(history, turn, msg);
                    syncHeroToTraineeClone();
                    renderTraining();
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
                    syncHeroToTraineeClone();
                    renderTraining();
                });
            });

            const invRows = document.querySelectorAll('[data-training-inv-row]');
            invRows.forEach((row) => {
                (row as HTMLElement).addEventListener('click', (ev) => {
                    const t = ev.target as HTMLElement | null;
                    if (t?.closest('button')) return;
                    const idx = Number((row as HTMLElement).getAttribute('data-training-inv-row'));
                    selectedEndInvIdx = Number.isFinite(idx) ? idx : null;
                    renderTraining();
                });
                (row as HTMLElement).addEventListener('contextmenu', (ev) => {
                    ev.preventDefault();
                    selectedEndInvIdx = null;
                    renderTraining();
                });
            });

            (document.getElementById('trainingEndInventoryBlock') as HTMLElement | null)?.addEventListener('click', (ev) => {
                const t = ev.target as HTMLElement | null;
                if (!t) return;
                if (t.closest('[data-training-inv-row]') || t.closest('button')) return;
                selectedEndInvIdx = null;
                renderTraining();
            });

            const unequipButtons = document.querySelectorAll('[data-unequip-slot]');
            unequipButtons.forEach(btn => {
                (btn as HTMLElement).addEventListener('click', () => {
                    const slot = (btn as HTMLElement).getAttribute('data-unequip-slot') as import('../item.js').EquipmentSlot;
                    const msg = hero.unequipSlot(slot);
                    message = msg;
                    pushHistory(history, turn, msg);
                    syncHeroToTraineeClone();
                    renderTraining();
                });
            });
        }
    }

    function playTrainingTurn(skill: Skill) {
        const res = applyPlayerSkillTurn({ caster: trainee, target: enemy, skill, turn });
        if (!res.ok) {
            message = res.message;
            pushHistory(history, turn, message);
            renderTraining();
            return;
        }

        message = res.message;
        // SFX: play attack / boule de feu when the trainee uses specific skills
        if (skill.name === 'Attaque de base' || skill.name === 'Hache lourde' || skill.name === 'Buff attaque') {
            window.game?.audioManager.play('attaque');
        }
        if (skill.name === 'Boule de feu') {
            window.game?.audioManager.play('bouledefeu');
        }
        pushHistory(history, turn, message);
        pushHistoryMany(history, turn, res.extraHistory);

        // Fin du tour du joueur : fait avancer les durées buff/debuff du joueur
        const traineeEndMsgs = trainee.endTurnEffects?.() || [];
        if (traineeEndMsgs.length) pushHistoryMany(history, turn, traineeEndMsgs);

        if (res.healFlashOnCaster) {
            renderTraining();
            setTimeout(() => {
                const playerHp = document.querySelector('.hp-bar.player') as HTMLElement | null;
                if (playerHp) {
                    playerHp.classList.add('flash-heal');
                    setTimeout(() => playerHp.classList.remove('flash-heal'), 360);
                }
            }, 20);
        }

        if (res.damageFlashOnTarget && res.damageFlashOnTarget.actualDamage > 0) {
            renderTraining();
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
        } else if (res.damageFlashOnTarget && res.damageFlashOnTarget.reduced) {
            renderTraining();
            setTimeout(() => {
                const enemyHp = document.querySelector('.hp-bar.enemy') as HTMLElement | null;
                const enemyShield = document.querySelector('.stat-badge.defense') as HTMLElement | null;
                if (enemyHp) {
                    enemyHp.classList.add('flash-reduced');
                    setTimeout(() => enemyHp.classList.remove('flash-reduced'), 360);
                }
                if (enemyShield) {
                    enemyShield.classList.add('flash-reduced');
                    setTimeout(() => enemyShield.classList.remove('flash-reduced'), 360);
                }
            }, 20);
        }

        if (enemy.pv <= 0) {
            const wood = Number((enemy as any).woodReward ?? 0);
            const woodTxt = wood > 0 ? ` et ${wood} bois` : '';
            message += `<br>Victoire ! Vous gagnez ${enemy.xpReward} XP et ${enemy.goldReward} or${woodTxt}.`;
            pushHistory(history, turn, `Victoire ! Vous gagnez ${enemy.xpReward} XP et ${enemy.goldReward} or${woodTxt}.`);
            hero.gainXP ? hero.gainXP(enemy.xpReward) : (hero.currentXP += enemy.xpReward);
            hero.gold += enemy.goldReward;
            hero.wood = (hero.wood ?? 0) + wood;
            hero.pv = trainee.pv;
            hero.currentMana = trainee.currentMana;
            pushHistory(history, turn, `PV et mana transférés au héros (${hero.pv}/${hero.maxPv}, Mana ${hero.currentMana}/${hero.maxMana})`);
            renderTraining();
            return;
        }

        setTimeout(() => {
            if (enemy.pv <= 0 || trainee.pv <= 0) return;

            turn++;

            // Début du tour de l'ennemi
            const enemyStartMsgs = enemy.updateEffects();
            if (enemyStartMsgs.length) pushHistoryMany(history, turn, enemyStartMsgs);
            if (enemy.pv <= 0) {
                const wood = Number((enemy as any).woodReward ?? 0);
                const woodTxt = wood > 0 ? ` et ${wood} bois` : '';
                message += `<br>Victoire ! Vous gagnez ${enemy.xpReward} XP et ${enemy.goldReward} or${woodTxt}.`;
                pushHistory(history, turn, `Victoire ! Vous gagnez ${enemy.xpReward} XP et ${enemy.goldReward} or${woodTxt}.`);
                hero.gainXP ? hero.gainXP(enemy.xpReward) : (hero.currentXP += enemy.xpReward);
                hero.gold += enemy.goldReward;
                hero.wood = (hero.wood ?? 0) + wood;
                hero.pv = trainee.pv;
                hero.currentMana = trainee.currentMana;
                pushHistory(history, turn, `PV et mana transférés au héros (${hero.pv}/${hero.maxPv}, Mana ${hero.currentMana}/${hero.maxMana})`);
                renderTraining();
                return;
            }

            // Début du tour de l'ennemi : régénération mana/tour
            {
                const beforeMana = enemy.currentMana;
                const regen = (enemy.manaRegenPerTurn || 0) + enemy.getPassiveManaRegenPerTurnBonus();
                enemy.currentMana = Math.min(enemy.currentMana + regen, enemy.maxMana);
                if (enemy.currentMana > beforeMana) {
                    pushHistory(history, turn, `${enemy.name} régénère ${enemy.currentMana - beforeMana} mana (Mana ${beforeMana} → ${enemy.currentMana})`);
                }
            }

            const resEnemy = applyAutoTurn({ caster: enemy, target: trainee, turn });
            message = resEnemy.message;
            pushHistory(history, turn, message);
            if (resEnemy.ok) pushHistoryMany(history, turn, resEnemy.extraHistory);

            // Fin du tour de l'ennemi : fait avancer les durées buff/debuff de l'ennemi
            const enemyEndMsgs = enemy.endTurnEffects?.() || [];
            if (enemyEndMsgs.length) pushHistoryMany(history, turn, enemyEndMsgs);

            if (resEnemy.ok && resEnemy.damageFlashOnTarget) {
                renderTraining();
                setTimeout(() => {
                    const playerHp = document.querySelector('.hp-bar.player') as HTMLElement | null;
                    const playerShield = document.querySelector('.stat-badge.defense') as HTMLElement | null;
                    if (resEnemy.damageFlashOnTarget && resEnemy.damageFlashOnTarget.actualDamage > 0 && playerHp) {
                        playerHp.classList.add('flash-damage');
                        setTimeout(() => playerHp.classList.remove('flash-damage'), 600);
                    }
                    if (resEnemy.damageFlashOnTarget && resEnemy.damageFlashOnTarget.reduced && playerShield) {
                        playerShield.classList.add('flash-reduced');
                        setTimeout(() => playerShield.classList.remove('flash-reduced'), 360);
                    }
                }, 20);
            }

            if (trainee.pv <= 0) {
                message += `<br>Défaite ! Retour au village.`;
                pushHistory(history, turn, 'Défaite ! Retour au village.');
                hero.pv = trainee.pv;
                hero.currentMana = trainee.currentMana;
                pushHistory(history, turn, `PV et mana transférés au héros (${hero.pv}/${hero.maxPv}, Mana ${hero.currentMana}/${hero.maxMana})`);
                renderTraining();
                return;
            }

            // Début du tour du joueur (après l'action de l'ennemi)
            const traineeStartMsgs = trainee.updateEffects();
            if (traineeStartMsgs.length) pushHistoryMany(history, turn, traineeStartMsgs);
            if (trainee.pv <= 0) {
                message += `<br>Défaite ! Retour au village.`;
                pushHistory(history, turn, 'Défaite ! Retour au village.');
                hero.pv = trainee.pv;
                hero.currentMana = trainee.currentMana;
                pushHistory(history, turn, `PV et mana transférés au héros (${hero.pv}/${hero.maxPv}, Mana ${hero.currentMana}/${hero.maxMana})`);
                renderTraining();
                return;
            }

            // Début du tour du joueur : régénération mana/tour
            {
                const beforeMana = trainee.currentMana;
                const regen = (trainee.manaRegenPerTurn || 0) + trainee.getPassiveManaRegenPerTurnBonus();
                trainee.currentMana = Math.min(trainee.currentMana + regen, trainee.maxMana);
                if (trainee.currentMana > beforeMana) {
                    pushHistory(history, turn, `${trainee.name} régénère ${trainee.currentMana - beforeMana} mana (Mana ${beforeMana} → ${trainee.currentMana})`);
                }
            }

            renderTraining();
        }, 900);

        renderTraining();
    }

    renderTraining();
}
