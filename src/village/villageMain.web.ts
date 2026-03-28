import { hero } from '../index.web.js';
import { escapeHtml } from '../utils.web.js';
import { showAccueil } from '../accueil.web.js';
import { showForetMenu } from '../foret.web.js';
import { getBaseSpeedForActor } from '../tacticalBoard.js';
import { showEntrainement } from './entrainement.web.js';
import { showCompetences } from './competences.web.js';
import { Campfire, Consumable, Equipment, Item } from '../item.js';
import type { Skill } from '../skill.js';
import { showSelectionPersonnages } from '../personnages.web.js';
import { getPartyMembers } from '../party.web.js';
import { ensureTacticalStyles } from '../tactical/styles.web.js';
import { showTemporaryMessage } from '../uiNotifications.js';
import { showMaisonDeplacement } from '../movement/houseMovement.web.js';
import { showMarche } from '../market/market.web.js';
import { advanceGameTimeHours, getGameTime } from '../daySystem.web.js';
import { renderItemIconHtml } from '../itemIcons.web.js';
import { startDialogue } from '../dialogue/dialogueManager.web.js';

let hasPlayedAubergeIntroAudio = false;

export function showVillage() {
        // Supprime le bouton Fuir du DOM si présent (manière sûre)
        const fuirBtn = document.getElementById('fuirBtn');
        fuirBtn?.remove();
    const app = document.getElementById('app');
    if (!app) return;

    // Reuse the tactical tile + sprite + hp/mana bars styles in the village HUD.
    ensureTacticalStyles();

    // Extra tiny UI bits for village-only party tiles (level badge + XP bar)
    if (!document.getElementById('village-party-tiles-style')) {
        const style = document.createElement('style');
        style.id = 'village-party-tiles-style';
        style.innerHTML = `
            .unit-sprite-level { position:absolute; top:4px; right:4px; padding:2px 6px; border-radius:999px; font-size:11px; font-weight:800; color:#111; background: rgba(255, 235, 59, 0.95); border: 1px solid rgba(0,0,0,0.25); box-shadow: 0 2px 10px rgba(0,0,0,0.25); pointer-events:none; }
            .unit-sprite-xpbar { height:4px; border-radius:999px; background: rgba(255,255,255,0.10); overflow:hidden; border:1px solid rgba(255,255,255,0.08); }
            .unit-sprite-xpfill { height:100%; border-radius:999px; background: linear-gradient(90deg,#ffeb3b,#f9a825); }
        `;
        document.head.appendChild(style);
    }

    const party = getPartyMembers().slice(0, 3);
    const fmtInt = (n: unknown, min = 0): number => Math.max(min, Math.floor(Number(n ?? 0) || 0));
    const clampPct = (v: number): number => Math.max(0, Math.min(100, v));
    const renderPartyPlateauTile = (p: any): string => {
        const cls = String(p?.characterClass ?? '').toLowerCase();
        const spriteSrc = cls === 'mage'
            ? './ImagesRPG/imagespersonnage/mage.png'
            : cls === 'voleur'
                ? './ImagesRPG/imagespersonnage/voleur.png'
                : './ImagesRPG/imagespersonnage/trueplayer.png';

        const maxPv = Math.max(1, fmtInt(p.effectiveMaxPv ?? p.maxPv ?? 1, 1));
        const curPv = fmtInt(p.pv ?? 0, 0);
        const hpPct = clampPct((curPv / maxPv) * 100);

        const maxMana = Math.max(0, fmtInt(p.effectiveMaxMana ?? p.maxMana ?? 0, 0));
        const curMana = fmtInt(p.currentMana ?? 0, 0);
        const manaPct = maxMana > 0 ? clampPct((curMana / maxMana) * 100) : 0;

        const lvl = fmtInt(p.level ?? 1, 1);
        const nextXp = fmtInt(p.getXPForLevel?.(lvl + 1) ?? 0, 0);
        const curXp = fmtInt(p.currentXP ?? 0, 0);
        const xpPct = nextXp > 0 ? clampPct((curXp / nextXp) * 100) : 0;

        // Keep the same slight scaling tweaks used in tactical to better fit the tile.
        let imgStyle = '';
        if (cls === 'mage') imgStyle = 'transform:scale(0.9);';
        if (cls === 'voleur') imgStyle = 'transform:scale(0.8);';

        const attack = fmtInt(p.effectiveAttack ?? (p as any).attack ?? p.baseAttack ?? 0, 0);
        const manaRegen = fmtInt((p.manaRegenPerTurn ?? 0) + (typeof (p as any).getPassiveManaRegenPerTurnBonus === 'function' ? (p as any).getPassiveManaRegenPerTurnBonus() : (p as any).getPassiveManaRegenPerTurnBonus ?? 0), 0);
        const title = `${String(p.name ?? '')} — PV ${curPv}/${maxPv}${maxMana > 0 ? ` — Mana ${curMana}/${maxMana}` : ''} — ATK ${attack} — Régén ${manaRegen}/t`.replace(/"/g, '');
        return `
            <div class="tile" title="${escapeHtml(title)}" style="width:104px;height:104px;cursor:default;">
                <div class="unit-sprite-wrap unit-team-allies">
                    <img class="unit-sprite" src="${spriteSrc}" alt="${escapeHtml(String(p.name ?? ''))}" style="${imgStyle}">
                    <div class="unit-sprite-stats"><span class="stat-badge" title="Attaque"><span class="icon">⚔</span> ${attack}</span> <span class="stat-badge" title="Régénération mana"><span class="icon">M+</span> ${manaRegen}</span></div>
                    <div class="unit-sprite-level">Niv ${lvl}</div>
                    <div class="unit-sprite-overlay">
                        <div class="unit-sprite-xpbar" title="XP ${curXp}/${nextXp}"><div class="unit-sprite-xpfill" style="width:${xpPct}%;"></div></div>
                        <div class="unit-sprite-bar hp" title="${curPv}/${maxPv}">
                            <div class="unit-sprite-barfill hp" style="width:${hpPct}%;"></div>
                            <div class="bar-label">${curPv}/${maxPv}</div>
                        </div>
                        ${maxMana > 0 ? `<div class="unit-sprite-bar mana" title="${curMana}/${maxMana}"><div class="unit-sprite-barfill mana" style="width:${manaPct}%;"></div><div class="bar-label">${curMana}/${maxMana}</div></div>` : ''}
                    </div>
                </div>
            </div>
        `;
    };

    app.innerHTML = `
        <img src="ImagesRPG/imagesfond/village.jpg" class="background" alt="Boaraven">
        <div class="village-title">Bienvenue à Boaraven !</div>
        <!-- Carte des stats du joueur affichée dans le village -->
        <div id="village-stats" style="position:absolute;top:56%;right:2%;z-index:2;width:360px;background:rgba(0,0,0,0.5);padding:12px;border-radius:10px;text-align:left;color:#fff;transform:translateY(-50%);">
            <h3 style="margin-top:0;margin-bottom:10px;">Personnages</h3>
            <div style="display:flex; gap:10px; align-items:center; justify-content:space-between;">
                ${party.map((p) => renderPartyPlateauTile(p)).join('')}
            </div>
            <p style="margin:10px 0 6px 0;">Or <b>${hero.gold}</b></p>
            <div style="font-size:0.95em;color:#ddd;margin-top:6px;margin-bottom:6px;">
                <div>Bois: <b>${(hero as any).wood ?? 0}</b></div>
                <div>Herbes: <b>${(hero as any).herb ?? 0}</b></div>
            </div>
            <div style="margin-top:8px;"><button class="btn" id="voirFicheBtn">Personnage</button></div>
        </div>
        <button class="village-btn village-hg" id="aubergeBtn">Auberge</button>
        <button class="village-btn village-hc" id="enigmeBtn">Énigme</button>
        <button class="village-btn village-hd" id="competenceBtn">Compétences</button>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;pointer-events:none;display:flex;justify-content:center;align-items:center;width:100%;height:0;">
            <button class="village-btn" id="combattreBtn" style="min-width:220px;pointer-events:auto;">Combattre</button>
        </div>
        <button class="village-btn village-bg" id="entrainementBtn">Entraînement</button>
        <button class="village-btn village-bc" id="boutiqueBtn">Boutique</button>
        <button class="village-btn village-bd" id="maisonBtn">Maison</button>
        <button class="btn" style="position:absolute;top:2%;right:2%;z-index:2;" id="retourBtn">Retour accueil</button>
    `;
    document.getElementById('retourBtn')?.addEventListener('click', showAccueil);
    document.getElementById('maisonBtn')?.addEventListener('click', () => showMaisonDeplacement({ onBack: showVillage }));
    document.getElementById('combattreBtn')?.addEventListener('click', () => showForetMenu({ onBack: showVillage }));

    document.getElementById('aubergeBtn')?.addEventListener('click', () => showAuberge());
    document.getElementById('boutiqueBtn')?.addEventListener('click', () => showBoutique());
    document.getElementById('enigmeBtn')?.addEventListener('click', showEnigme);
    document.getElementById('competenceBtn')?.addEventListener('click', showCompetences);
    document.getElementById('entrainementBtn')?.addEventListener('click', showEntrainement);
    // Menu personnage => sélection des 3 personnages
    document.getElementById('voirFicheBtn')?.addEventListener('click', () => showSelectionPersonnages({ onBack: showVillage }));

    // Equipment buttons are no longer displayed on the mini party tiles.





    // Suppression du setTimeout/renderTraining orphelin
    return;
}

export function showAuberge(opts?: { onBack?: () => void }) {
    const audio = window.game?.audioManager;
    const aubergeIsPlaying = typeof (audio as any)?.isPlaying === 'function' ? Boolean((audio as any).isPlaying('auberge')) : false;
    if (!aubergeIsPlaying) {
        // Couper les autres musiques en cours (ex: background) puis lancer l'auberge immédiatement.
        audio?.pauseAll();
        audio?.play('auberge');
    }
    // Le PNJ intro se joue seulement la première fois, en parallèle (pas d'enchainement).
    if (!hasPlayedAubergeIntroAudio) {
        hasPlayedAubergeIntroAudio = true;
        audio?.playOnce('pnjintro');
    }

    const app = document.getElementById('app');
    if (!app) return;

    // Démarre la quête 'auberge_demarrage' la première fois qu'on entre dans l'auberge
    try {
        const qm = (window as any).game?.questManager;
        if (qm && typeof qm.getProgress === 'function' && !qm.getProgress('auberge_demarrage')) {
            qm.start('auberge_demarrage');
        }
    } catch (e) {
        console.error('[quest] error ensuring auberge quest start', e);
    }
    app.innerHTML = `
        <img src="ImagesRPG/imagesfond/auberge_Boaraven.jpeg" class="background" alt="Intérieur de taverne">

        <!-- PNJ buttons positioned on top of the background (top:30%) -->
        <div class="auberge-pnjs" style="position:absolute;top:30%;left:0;right:0;height:0;z-index:3;pointer-events:none;">
            <button id="pnjBtn1" class="auberge-pnj" aria-label="PNJ 1" title="PNJ 1" style="position:absolute;left:10%;top:0;transform:translateY(-50%);width:56px;height:56px;border-radius:999px;pointer-events:auto;background:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.25);"></button>
            <button id="pnjBtn2" class="auberge-pnj" aria-label="PNJ 2" title="PNJ 2" style="position:absolute;left:30%;top:0;transform:translateY(-50%);width:56px;height:56px;border-radius:999px;pointer-events:auto;background:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.25);"></button>
            <button id="pnjBtn3" class="auberge-pnj" aria-label="PNJ 3" title="PNJ 3" style="position:absolute;right:30%;top:0;transform:translateY(-50%);width:56px;height:56px;border-radius:999px;pointer-events:auto;background:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.25);"></button>
            <button id="pnjBtn4" class="auberge-pnj" aria-label="PNJ 4" title="PNJ 4" style="position:absolute;right:15%;top:0;transform:translateY(-50%);width:56px;height:56px;border-radius:999px;pointer-events:auto;background:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.12);box-shadow:0 2px 8px rgba(0,0,0,0.25);"></button>
        </div>

        <div class="centered-content">
            <h1>Auberge</h1>
            <p>Restaurez tous vos PV et mana pour 30 or.</p>
        </div>
        <button class="btn" id="restBtn" style="position:fixed; left:40%; bottom:30px; transform:translateX(-50%); z-index:10;">Se reposer</button>
        <button class="btn" id="retourVillageBtn" style="position:fixed; left:60%; bottom:30px; transform:translateX(-50%); z-index:10;">Retour village</button>
    `;
    document.getElementById('restBtn')?.addEventListener('click', () => {
        if (hero.gold >= 30) {
            hero.gold -= 30;
            // Restore the whole party
            const party = getPartyMembers();
            for (const p of party) {
                // Restore max HP lost during adventure/combat chains (wound system).
                const hpPenalty = Math.max(0, Math.floor(Number((p as any).__adventureMaxHpPenalty ?? 0)));
                if (hpPenalty > 0) {
                    (p as any).__adventureMaxHpPenalty = 0;
                    p.maxPv = Math.max(1, Math.floor(Number((p as any).maxPv ?? 1) + hpPenalty));
                }
                p.pv = Math.max(1, Math.floor(p.effectiveMaxPv));
                p.currentMana = Math.max(0, Math.floor(p.effectiveMaxMana));
            }
            const before = getGameTime(hero);
            const timeRes = advanceGameTimeHours(hero, 12, { reason: 'auberge_sleep' });
            try {
                const market = timeRes.market;
                const fromH = String(before.hour).padStart(2, '0');
                const toH = String(timeRes.hour).padStart(2, '0');
                const extra = timeRes.daysAdvanced > 0
                    ? (market && market.soldCount > 0 ? ` — Ventes: ${market.soldCount} (+${market.soldTotal} or à collecter)` : ' — Aucune vente')
                    : '';
                showTemporaryMessage(`Sommeil 12h: Jour ${before.day} ${fromH}h → Jour ${timeRes.day} ${toH}h${extra}`, 5200);
            } catch (e) {
                // noop (UI unavailable)
            }
            showAuberge(opts);
        } else {
            alert('Pas assez d\'or !');
        }
    });
    // On quitte l'auberge: on ne met pas en pause la musique d'auberge (elle continue de jouer)
    document.getElementById('retourVillageBtn')?.addEventListener('click', () => {
        (opts?.onBack ?? showVillage)();
    });

    const dialogueCtx = {
        questManager: (window as any).game?.questManager,
        hero,
        notify: (m: string, ms?: number) => showTemporaryMessage(m, ms ?? 3500),
    };

    document.getElementById('pnjBtn1')?.addEventListener('click', () => startDialogue('auberge_pnj1', dialogueCtx));
    document.getElementById('pnjBtn2')?.addEventListener('click', () => startDialogue('auberge_pnj2', dialogueCtx));
    document.getElementById('pnjBtn3')?.addEventListener('click', () => startDialogue('auberge_pnj3', dialogueCtx));
    document.getElementById('pnjBtn4')?.addEventListener('click', () => startDialogue('auberge_pnj4', dialogueCtx));

}

export function showBoutique(options: { onBack?: () => void } = {}) {
    const app = document.getElementById('app');
    if (!app) return;

    type ShopCategory = 'all' | 'consumable' | 'equipment' | 'other';
    let category: ShopCategory = 'all';

    // Items en boutique

    type ShopEntry =
        | {
              kind?: 'item';
              create: () => any;
              price: number;
              category: Exclude<ShopCategory, 'all'>;
          }
        | {
              kind: 'resource';
              resourceKey: 'wood' | 'fer' | 'herb' | 'cuir';
              create: () => any;
              price: number;
              category: Exclude<ShopCategory, 'all'>;
          };

    const shopItems: ShopEntry[] = [
        // Matières premières (10 or / unité)
        { kind: 'resource', resourceKey: 'wood', create: () => ({ id: 'res_wood', name: 'Bois', description: 'Matière première (+1 bois)' }), price: 10, category: 'other' },
        { kind: 'resource', resourceKey: 'fer', create: () => ({ id: 'res_fer', name: 'Fer', description: 'Matière première (+1 fer)' }), price: 10, category: 'other' },
        { kind: 'resource', resourceKey: 'herb', create: () => ({ id: 'res_herb', name: 'Herbe', description: 'Matière première (+1 herbe)' }), price: 10, category: 'other' },
        { kind: 'resource', resourceKey: 'cuir', create: () => ({ id: 'res_cuir', name: 'Cuir', description: 'Matière première (+1 cuir)' }), price: 10, category: 'other' },

        { create: () => new Consumable('potion_small', 'Potion de soin', 'Soigne 50 PV', 'heal', 50), price: 50, category: 'consumable' },
        { create: () => new Consumable('mana_small', 'Potion de mana', 'Restaure 30 mana', 'mana', 30), price: 30, category: 'consumable' },
        { create: () => new Consumable('pomme', 'Pomme', 'Restaure 10 PV', 'heal', 10), price: 8, category: 'consumable' },
        { create: () => new Campfire(), price: 60, category: 'other' },
        { create: () => new Equipment('sword_1', 'Épée basique', 'Épée en fer (+5 attaque)', 'weapon', 5, 0, 0, 0), price: 50, category: 'equipment' },
        { create: () => new Equipment('sword_bronze', 'Épée de bronze', 'Épée en bronze (+2 attaque)', 'weapon', 2, 0, 0, 0), price: 80, category: 'equipment' },
        { create: () => new Equipment('sword_wood', 'Épée en bois', 'Épée légère (+1 attaque)', 'weapon', 1, 0, 0, 0), price: 15, category: 'equipment' },
        { create: () => new Equipment('dague_fer', 'Dague de fer', 'Dague en fer (+2 attaque, +2 critique)', 'weapon', 2, 0, 0, 0, 2), price: 150, category: 'equipment' },
        { create: () => new Equipment('dagues_rouille', 'Dagues rouillées', 'Dagues usées (+1 critique)', 'weapon', 0, 0, 0, 0, 1), price: 25, category: 'equipment' },
        { create: () => new Equipment('staff_novice', 'Bâton de novice', 'Bâton simple (+10 mana maximum)', 'weapon', 0, 0, 0, 10), price: 40, category: 'equipment' },

        { create: () => new Equipment('armor_1', 'Armure de cuir', 'Armure légère (+20 PV)', 'armor', 0, 0, 20, 0), price: 50, category: 'equipment' },
        { create: () => new Equipment('ring_1', 'Anneau de mana', 'Anneau (+10 mana)', 'ring', 0, 0, 0, 10), price: 50, category: 'equipment' },
    ];

    const render = () => {
        const filtered = shopItems
            .map((s, idx) => ({ ...s, idx }))
            .filter((s) => category === 'all' || s.category === category);

        app.innerHTML = `
            <img src="ImagesRPG/imagesfond/boutique.jpeg" class="background" alt="Boutique RPG">
            <div class="centered-content" style="padding-top:26px;">
                <h1>Boutique</h1>

                <div style="display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;margin-bottom:12px;">
                    <label style="color:#ddd;font-weight:700;">Catégorie :</label>
                    <select id="shopCategorySelect">
                        <option value="all" ${category === 'all' ? 'selected' : ''}>Tout</option>
                        <option value="consumable" ${category === 'consumable' ? 'selected' : ''}>Consommables</option>
                        <option value="equipment" ${category === 'equipment' ? 'selected' : ''}>Équipement</option>
                        <option value="other" ${category === 'other' ? 'selected' : ''}>Autres</option>
                    </select>
                </div>

                <details open style="max-width:740px;margin:0 auto;text-align:left;background:rgba(0,0,0,0.16);border:1px solid rgba(255,255,255,0.10);border-radius:12px;">
                    <summary style="cursor:pointer;user-select:none;padding:12px 14px;font-weight:900;color:#fff;">Articles</summary>
                    <div style="padding:10px 12px 14px 12px;">
                        <div style="max-height:min(60vh, 520px);overflow:auto;padding-right:6px;">
                            <div style="display:flex;flex-direction:column;gap:12px;">
                                ${filtered
                                    .map((s) => {
                                        const item = s.create();
                                        const icon = renderItemIconHtml(item, { size: 60 });

                                        return `
                                            <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.18);padding:12px;border-radius:8px;gap:12px;">
                                                <div style="display:flex;gap:12px;align-items:flex-start;">
                                                    <div style="width:44px;display:flex;justify-content:center;">${icon}</div>
                                                </div>
                                                <div style="text-align:right;white-space:nowrap;">
                                                    <div style="font-weight:700;">${s.price} or</div>
                                                    <button class="btn" data-shop-idx="${s.idx}" style="margin-top:8px;min-width:120px;">Acheter</button>
                                                </div>
                                            </div>
                                        `;
                                    })
                                    .join('')}
                            </div>
                        </div>
                    </div>
                </details>

                <div style="margin-top:18px;display:flex;gap:8px;justify-content:center;">
                    <button class="btn" id="marcheBtn">Marché</button>
                    <button class="btn" id="retourVillageBtn">Retour village</button>
                </div>
            </div>
        `;

        document.getElementById('shopCategorySelect')?.addEventListener('change', (e) => {
            const v = (e.target as HTMLSelectElement).value as ShopCategory;
            category = v || 'all';
            render();
        });

        // Listeners d'achat
        (document.querySelectorAll('[data-shop-idx]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-shop-idx'));
                const shopEntry = shopItems[idx];
                if (!shopEntry) return;
                if (hero.gold >= shopEntry.price) {
                    hero.gold -= shopEntry.price;
                    const bought = shopEntry.create();

                    if ((shopEntry as any).kind === 'resource') {
                        const key = (shopEntry as any).resourceKey as 'wood' | 'fer' | 'herb' | 'cuir';
                        const cur = Math.max(0, Math.floor(Number((hero as any)[key] ?? 0)));
                        (hero as any)[key] = cur + 1;
                        alert(`Achat réussi : ${(bought as any)?.name ?? 'Ressource'} (+1) (-${shopEntry.price} or)`);
                    } else {
                        hero.addItem(bought);
                        alert(`Achat réussi : ${bought.name} (-${shopEntry.price} or)`);
                    }
                    render();
                } else {
                    alert('Pas assez d\'or !');
                }
            });
        });

        document.getElementById('marcheBtn')?.addEventListener('click', () => showMarche({ hero, onBack: () => showBoutique(options) }));
        document.getElementById('retourVillageBtn')?.addEventListener('click', options.onBack ?? showVillage);
    };

    render();
}

export function showEnigme() {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `
        <img src="./imagesRPG/Fabienne_photo.png" class="background" alt="Fabienne">
        <div class="centered-content">
            <h1>Énigme</h1>
            <p>Quel est l'animal qui a quatre pattes le matin, deux à midi et trois le soir ?</p>
            <button class="btn" id="reponseA">L'homme</button>
            <button class="btn" id="reponseB">Le lion</button>
            <button class="btn" id="reponseC">Le serpent</button>
            <button class="btn" id="retourVillageBtn">Retour village</button>
        </div>
    `;
    document.getElementById('reponseA')?.addEventListener('click', () => {
        if (!app) return;
        hero.gainXP ? hero.gainXP(200) : hero.currentXP += 200;
        app.innerHTML = `<img src='./imagesRPG/Fabienne_photo.png' class='background' alt='Fabienne'><div class='centered-content'><h1>Bonne réponse !</h1><p>Vous gagnez <b>200 XP</b> !</p><button class='btn' id='retourVillageBtn'>Retour village</button></div>`;
        document.getElementById('retourVillageBtn')?.addEventListener('click', showVillage);
    });
    document.getElementById('reponseB')?.addEventListener('click', () => {
        if (!app) return;
        app.innerHTML = `<img src='./imagesRPG/Fabienne_photo.png' class='background' alt='Fabienne'><div class='centered-content'><h1>Mauvaise réponse !</h1><button class='btn' id='retourVillageBtn'>Retour village</button></div>`;
        document.getElementById('retourVillageBtn')?.addEventListener('click', showVillage);
    });
    document.getElementById('reponseC')?.addEventListener('click', () => {
        if (!app) return;
        app.innerHTML = `<img src='./imagesRPG/Fabienne_photo.png' class='background' alt='Fabienne'><div class='centered-content'><h1>Mauvaise réponse !</h1><button class='btn' id='retourVillageBtn'>Retour village</button></div>`;
        document.getElementById('retourVillageBtn')?.addEventListener('click', showVillage);
    });

    // Button to show the full list of puzzles
    const enigmesBtn = document.createElement('button');
    enigmesBtn.className = 'btn';
    enigmesBtn.id = 'enigmesDisponiblesBtn';
    enigmesBtn.textContent = 'Enigmes disponibles';
    const content = document.querySelector('.centered-content');
    if (content) content.appendChild(enigmesBtn);
    document.getElementById('enigmesDisponiblesBtn')?.addEventListener('click', showEnigmesList);

    document.getElementById('retourVillageBtn')?.addEventListener('click', showVillage);
}

// List of puzzles / enigmes UI
export function showEnigmesList() {
    const app = document.getElementById('app');
    if (!app) return;

    const enigmes = [
        {
            id: 'enigme1',
            title: "Quelle compétence permet de lancer un ennemi avec un guerrier ?",
            options: ["Lancer d'allié", "Lancer d'ennemi", "Lancer de nain"],
            correctIndex: 1,
            rewardXp: 500,
        },
        {
            id: 'enigme2',
            title: "Quelle compétence de voleur permet de regagner du mana en tuant un ennemi ?",
            options: ["Assassinat", "Vol de mana", "Frappe sournoise"],
            correctIndex: 0,
            rewardXp: 500,
        },
        {
            id: 'enigme3',
            title: "Quelle spécialisation appartient au mage ?",
            options: ["Invocateur", "Chaman", "Illusioniste"],
            correctIndex: 0,
            rewardXp: 500,
        },
    ];

    const progress = (hero as any).enigmes ?? {};

    app.innerHTML = `
        <img src="./imagesRPG/Fabienne_photo.png" class="background" alt="Enigmes">
        <div class="centered-content">
            <h1>Énigmes disponibles</h1>
            <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px;text-align:left;">
                ${enigmes
                    .map((e) => {
                        const done = progress[e.id] ? "<span style='color:#c8e6c9;'>Résolue</span>" : "<span style='color:#ddd;'>Non résolue</span>";
                        return `
                            <div style="background:rgba(0,0,0,0.55);padding:12px;border-radius:8px;">
                                <div style="font-weight:700;">${escapeHtml(String(e.title))}</div>
                                <div style="margin-top:6px;">${done}</div>
                                <div style="margin-top:8px;"><button class="btn" data-enigme-open="${e.id}">Répondre</button></div>
                            </div>
                        `;
                    })
                    .join('')}
            </div>
            <div style="margin-top:16px;display:flex;gap:12px;justify-content:center;">
                <button class="btn" id="enigmesBackBtn">Retour</button>
            </div>
        </div>
    `;

    (app.querySelectorAll('[data-enigme-open]') as NodeListOf<HTMLButtonElement>).forEach((btn) =>
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-enigme-open') ?? '';
            showEnigmeQuestion(id);
        })
    );

    document.getElementById('enigmesBackBtn')?.addEventListener('click', showEnigme);
}

// Render a single puzzle question
export function showEnigmeQuestion(id: string) {
    const app = document.getElementById('app');
    if (!app) return;

    const enigmesMap: Record<string, any> = {
        enigme1: {
            id: 'enigme1',
            title: "Quelle compétence permet de lancer un ennemi avec un guerrier ?",
            options: ["Lancer d'allié", "Lancer d'ennemi", "Lancer de nain"],
            correctIndex: 1,
            rewardXp: 500,
        },
        enigme2: {
            id: 'enigme2',
            title: "Quelle compétence de voleur permet de regagner du mana en tuant un ennemi ?",
            options: ["Assassinat", "Vol de mana", "Frappe sournoise"],
            correctIndex: 0,
            rewardXp: 500,
        },
        enigme3: {
            id: 'enigme3',
            title: "Quelle spécialisation appartient au mage ?",
            options: ["Invocateur", "Chaman", "Illusioniste"],
            correctIndex: 0,
            rewardXp: 500,
        },
    };

    const e = enigmesMap[id];
    if (!e) return showEnigmesList();

    app.innerHTML = `
        <img src="./imagesRPG/Fabienne_photo.png" class="background" alt="Enigme question">
        <div class="centered-content">
            <h1>${escapeHtml(String(e.title))}</h1>
            ${e.options
                .map((opt: string, idx: number) => `<button class="btn" data-enigme-ans="${idx}">${escapeHtml(opt)}</button>`)
                .join('')}
            <div style="margin-top:12px;"><button class="btn" id="enigmeQuestionBackBtn">Retour</button></div>
        </div>
    `;

    (app.querySelectorAll('[data-enigme-ans]') as NodeListOf<HTMLButtonElement>).forEach((btn) =>
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-enigme-ans'));
            if (idx === e.correctIndex) {
                (hero as any).enigmes = Object.assign({}, (hero as any).enigmes ?? {}, { [id]: true });
                hero.gainXP ? hero.gainXP(e.rewardXp) : (hero.currentXP += e.rewardXp);
                app.innerHTML = `<img src='./imagesRPG/Fabienne_photo.png' class='background' alt='Fabienne'><div class='centered-content'><h1>Bonne réponse !</h1><p>Vous gagnez <b>${e.rewardXp} XP</b> !</p><button class='btn' id='enigmeDoneBackBtn'>Retour énigmes</button></div>`;
                document.getElementById('enigmeDoneBackBtn')?.addEventListener('click', showEnigmesList);
            } else {
                app.innerHTML = `<img src='./imagesRPG/Fabienne_photo.png' class='background' alt='Fabienne'><div class='centered-content'><h1>Mauvaise réponse !</h1><p>Réessayez plus tard.</p><button class='btn' id='enigmeTryBackBtn'>Retour énigmes</button></div>`;
                document.getElementById('enigmeTryBackBtn')?.addEventListener('click', showEnigmesList);
            }
        })
    );

    document.getElementById('enigmeQuestionBackBtn')?.addEventListener('click', showEnigmesList);
}

export function showQuetes(options: { onBack?: () => void; tab?: 'active' | 'completed' } = {}) {
    const app = document.getElementById('app');
    if (!app) return;

    const qm = (window as any).game?.questManager;
    const items: Array<{ def: any; progress: any }> = typeof qm?.getAll === 'function' ? qm.getAll() : [];

    const tab: 'active' | 'completed' = options.tab ?? 'active';

    const isClaimed = (id: string): boolean => {
        const p = qm?.getProgress?.(id);
        return p?.status === 'claimed';
    };
    const isVisible = (def: any): boolean => {
        if (!def) return false;
        const gate = def.hiddenUntilClaimedQuestId;
        if (gate && !isClaimed(String(gate))) return false;
        return true;
    };

    const renderStatus = (p: any): string => {
        const s = String(p?.status ?? '');
        if (s === 'claimed') return 'Terminée';
        if (s === 'completed') return 'À valider';
        if (s === 'active') return 'En cours';
        return 'Non démarrée';
    };

    const renderProgress = (def: any, p: any): string => {
        if (!p || p.status === undefined) return '<div style="color:#bbb;">Non démarrée.</div>';
        const stepIndex = Math.max(0, Math.floor(Number(p.stepIndex ?? 0)));
        const step = Array.isArray(def?.steps) ? def.steps[stepIndex] : null;
        if (!step) {
            if (p?.status === 'claimed' || p?.status === 'completed') {
                return '<div style="margin-top:10px;color:#c8e6c9;font-weight:700;">Objectifs terminés.</div>';
            }
            return '<div style="color:#bbb;">Aucune étape.</div>';
        }

        const objectives = Array.isArray(step.objectives) ? step.objectives : [];
        const objState: Record<string, number> = (p.objectives ?? {}) as any;

        return `
            <div style="margin-top:10px;">
                <div style="font-weight:700;">Étape: ${escapeHtml(String(step.title ?? step.id ?? ''))}</div>
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
                    ${objectives
                        .map((o: any) => {
                            const cur = Math.max(0, Math.floor(Number(objState?.[String(o.id)] ?? 0)));
                            const t = String(o.type ?? '');
                            if (t === 'counter') {
                                const target = Math.max(1, Math.floor(Number(o.target ?? 1)));
                                const done = cur >= target;
                                return `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
                                    <div style="color:${done ? '#c8e6c9' : '#ddd'};">${done ? '✔' : '•'} ${escapeHtml(String(o.description ?? o.id ?? ''))}</div>
                                    <div style="color:#bbb;white-space:nowrap;">${cur}/${target}</div>
                                </div>`;
                            }

                            const done = cur >= 1;
                            return `<div style="color:${done ? '#c8e6c9' : '#ddd'};">${done ? '✔' : '•'} ${escapeHtml(String(o.description ?? o.id ?? ''))}</div>`;
                        })
                        .join('')}
                </div>
            </div>
        `;
    };

    app.innerHTML = `
        <img src="ImagesRPG/imagesfond/village.jpg" class="background" alt="Quêtes">
        <div class="centered-content" style="max-width:900px;">
            <h1>Quêtes</h1>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:6px;">
                <button class="btn" id="quetesTabActiveBtn" style="min-width:180px;${tab === 'active' ? 'border:2px solid #ffd700;' : ''}">Quêtes</button>
                <button class="btn" id="quetesTabCompletedBtn" style="min-width:180px;${tab === 'completed' ? 'border:2px solid #ffd700;' : ''}">Quêtes terminées</button>
            </div>
            ${!qm ? '<div style="background:rgba(0,0,0,0.55);padding:14px;border-radius:10px;">Quêtes indisponibles (questManager manquant).</div>' : ''}
            <div style="display:flex;flex-direction:column;gap:14px;margin-top:14px;text-align:left;">
                ${items
                    .filter(({ def, progress }) => {
                        if (!isVisible(def)) return false;
                        const status = String(progress?.status ?? '');
                        if (tab === 'completed') return status === 'claimed';
                        // active tab: everything except claimed
                        return status !== 'claimed';
                    })
                    .map(({ def, progress }) => {
                        const status = renderStatus(progress);
                        return `
                            <div style="background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.08);padding:14px;border-radius:12px;">
                                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                                    <div>
                                        <div style="font-size:1.1em;font-weight:800;">${escapeHtml(String(def?.name ?? def?.id ?? 'Quête'))} ${(def && (def as any).__newlyUnlocked && !progress) ? `<span style="display:inline-block;background:#4caf50;color:#fff;padding:2px 8px;border-radius:8px;font-size:0.7em;margin-left:8px;">Nouveau</span>` : ''}</div>
                                        <div style="color:#ddd;margin-top:4px;">${escapeHtml(String(def?.description ?? ''))}</div>
                                    </div>
                                    <div style="text-align:right;min-width:120px;">
                                        <div style="font-weight:800;color:#ffd700;">${escapeHtml(status)}</div>
                                        ${tab === 'active' && !progress && qm && (def?.manualStartAllowed ?? true) ? `<button class="btn" data-quest-start="${escapeHtml(String(def?.id ?? ''))}" style="min-width:140px;margin-top:8px;">Démarrer</button>` : (tab === 'active' && !progress ? `<div style="color:#999;margin-top:8px;">Quête verrouillée</div>` : '')}
                                    </div>
                                </div>
                                ${renderProgress(def, progress)}
                            </div>
                        `;
                    })
                    .join('')}
                ${items.filter(({ def, progress }) => {
                    if (!isVisible(def)) return false;
                    const status = String(progress?.status ?? '');
                    if (tab === 'completed') return status === 'claimed';
                    return status !== 'claimed';
                }).length === 0 ? '<div style="background:rgba(0,0,0,0.55);padding:14px;border-radius:10px;">Aucune quête.</div>' : ''}
            </div>
            <div style="margin-top:16px;display:flex;gap:12px;justify-content:center;">
                <button class="btn" id="quetesBackBtn">Retour</button>
            </div>
        </div>
    `;

    // Tab buttons
    document.getElementById('quetesTabActiveBtn')?.addEventListener('click', () => {
        showQuetes({ ...options, tab: 'active' });
    });
    document.getElementById('quetesTabCompletedBtn')?.addEventListener('click', () => {
        showQuetes({ ...options, tab: 'completed' });
    });

    // Start buttons (active tab only)
    if (tab === 'active') {
        (app.querySelectorAll('[data-quest-start]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-quest-start') ?? '';
                try {
                    qm?.start?.(id);
                } catch (e) {
                    console.error('[quest] start error', e);
                }
                showQuetes(options);
            });
        });
    }

    // If a quest was unlocked elsewhere, re-render the page so the 'Nouveau' badge appears.
    if (!(document as any).__questUnlockedHandlerAdded) {
        document.addEventListener('quest:unlocked', () => {
            try { showQuetes(options); } catch (e) { /* noop */ }
        });
        (document as any).__questUnlockedHandlerAdded = true;
    }

    document.getElementById('quetesBackBtn')?.addEventListener('click', () => {
        if (options.onBack) options.onBack();
        else showVillage();
    });
}

// Entraînement déjà présent plus haut

// Affichage des stats du personnage (doit être à la racine du module)
export function showPersonnage() {
    const app = document.getElementById('app');
    if (!app) return;
    // Avatar: portraits locaux par classe (mage/voleur)
    const cls = String((hero as any).characterClass ?? '').toLowerCase();
    const avatarUrl = cls === 'mage'
        ? 'ImagesRPG/imagespersonnage/mage.jpg'
        : cls === 'voleur'
            ? 'ImagesRPG/imagespersonnage/voleur.png'
            : 'https://img.freepik.com/vecteurs-premium/illustration-personnage_961307-22519.jpg';
    const backgroundUrl = 'https://thumbs.dreamstime.com/z/cozy-fantasy-medieval-tavern-inn-interior-food-drink-tables-burning-open-fireplace-candles-stone-ground-middle-277116558.jpg';
    app.innerHTML = `
        <img src="${backgroundUrl}" class="background" alt="Personnage">
        <div class="centered-content" style="max-width:1200px;margin:0 auto;">
            <h1>Fiche du personnage</h1>
            <div style="display:flex;gap:32px;justify-content:space-between;align-items:flex-start;margin-top:18px;flex-wrap:nowrap;width:100%;">
                <!-- Colonne 1 : Stats (alignée à gauche) -->
                <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:18px;min-width:220px;max-width:260px;box-shadow:0 2px 12px rgba(0,0,0,0.15);flex:1 1 220px;align-self:stretch;">
                    <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:12px;">
                        <img id="character-img" src="${avatarUrl}" alt="Avatar" style="width:120px;height:120px;border-radius:10px;object-fit:cover;box-shadow:0 2px 12px rgba(0,0,0,0.6);margin-bottom:8px;" data-fixed="true">
                        <div style="font-size:1.1em;font-weight:600;">${hero.name}</div>
                    </div>
                    <p><b>Niveau :</b> ${hero.level}</p>
                    <p><b>XP :</b> ${hero.currentXP} / ${hero.getXPForLevel(hero.level + 1)}</p>
                    <p><b>PV :</b> ${hero.pv} / ${hero.effectiveMaxPv}</p>
                    <p><b>Mana :</b> ${hero.currentMana} / ${hero.effectiveMaxMana}</p>
                    <p><b>Régénération mana :</b> ${hero.manaRegenPerTurn + hero.getPassiveManaRegenPerTurnBonus()} /tour <small style="color:#777;">(base ${hero.manaRegenPerTurn}${hero.getPassiveManaRegenPerTurnBonus() ? ' + ' + hero.getPassiveManaRegenPerTurnBonus() : ''})</small></p>
                    <p><b>Attaque :</b> ${hero.effectiveAttack} <small style="color:#777;">(base ${hero.baseAttack} + eq ${Object.values(hero.equipment).reduce((s: number, eq: any) => s + (eq?.attackBonus || 0), 0)})</small></p>
                    <p><b>Or :</b> ${hero.gold}</p>
                    <p><b>Points de compétence :</b> ${hero.skillPoints}</p>
                    <p><b>Points de caractéristique :</b> ${(hero as any).characteristicPoints ?? 0}</p>
                </div>
                <!-- Colonne 2 : Caractéristiques -->
                <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:18px;min-width:220px;max-width:260px;box-shadow:0 2px 12px rgba(0,0,0,0.15);flex:1 1 220px;align-self:stretch;">
                    <h2 style="margin-top:0;">Caractéristiques</h2>
                    <div style="font-size:0.95em; color:#ddd;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Force : <b>${(hero as any).characteristics?.force ?? 0}</b><br><small style="color:#999;">+1 attaque / point</small></div>
                            <button class="btn" data-stat="force" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Santé : <b>${(hero as any).characteristics?.sante ?? 0}</b><br><small style="color:#999;">+10 PV max / point</small></div>
                            <button class="btn" data-stat="sante" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Énergie : <b>${(hero as any).characteristics?.energie ?? 0}</b><br><small style="color:#999;">+1 mana/tour / point</small></div>
                            <button class="btn" data-stat="energie" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Magie : <b>${(hero as any).characteristics?.magie ?? 0}</b><br><small style="color:#999;">+1 mana / tour / point</small></div>
                            <button class="btn" data-stat="magie" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Vitesse : <b>${(hero as any).characteristics?.vitesse ?? 0}</b><br><small style="color:#999;"><span title="Total VIT = base de classe (guerrier/mage/voleur) + bonus de la caractéristique Vitesse">total VIT: ${getBaseSpeedForActor(hero as any, 'allies')}</span></small></div>
                            <button class="btn" data-stat="vitesse" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Critique : <b>${(hero as any).characteristics?.critique ?? 0}</b><br><small style="color:#999;">chance crit = (critique/force)×100, dégâts x2</small></div>
                            <button class="btn" data-stat="critique" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Défense : <b>${(hero as any).characteristics?.defense ?? 0}</b><br><small style="color:#999;">réduction = (défense/attaque ennemi)×100</small></div>
                            <button class="btn" data-stat="defense" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                            <div>Connaissance : <b>${(hero as any).characteristics?.connaissance ?? 0}</b><br><small style="color:#999;">+1 point de compétence / point</small></div>
                            <button class="btn" data-stat="connaissance" ${(hero as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                    </div>
                </div>
                <!-- Colonne 3 : Compétences -->
                <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:18px;min-width:220px;max-width:260px;box-shadow:0 2px 12px rgba(0,0,0,0.15);flex:1 1 220px;align-self:stretch;">
                    <h2 style="margin-top:0;">Compétences</h2>
                    <ul style="list-style:none;padding:0;">
                        ${hero.skills.map(skill => `<li><b>${skill.key}</b> : ${escapeHtml(skill.name)}</li>`).join('')}
                    </ul>
                </div>
            </div>
            <div style="margin-top:24px;text-align:center;">
                <button class="btn" id="retourVillageBtn">Retour village</button>
            </div>
        </div>
    `;
    // Prevent any accidental changes: remove potential edit listeners on the avatar
    const charImg = document.getElementById('character-img');
    if (charImg) {
        // Ensure no click listeners modify the image
        const clone = charImg.cloneNode(true) as HTMLElement;
        charImg.parentElement?.replaceChild(clone, charImg);
    }
    document.getElementById('retourVillageBtn')?.addEventListener('click', showVillage);

    // Dépense points de caractéristique
    (app.querySelectorAll('[data-stat]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
        btn.addEventListener('click', () => {
            const stat = btn.getAttribute('data-stat') as any;
            const msg = (hero as any).spendCharacteristicPoint?.(stat);
            // Alerte supprimée pour éviter les popups ; on met simplement à jour l'affichage
            showPersonnage();
        });
    });
}

export function showMaison() {
    // Ancien menu Maison supprimé : on redirige vers "Déplacement (maison)".
    showMaisonDeplacement({ onBack: showVillage });
}

