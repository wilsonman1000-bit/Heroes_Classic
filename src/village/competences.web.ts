import { hero } from '../index.web.js';
import type { Skill } from '../skill.js';
import { installHoverTooltip } from '../utils.web.js';
import { encodeSkillTooltip } from '../skillUi.web.js';
import { escapeHtml } from '../utils.web.js';
import { PASSIVE_DEFS } from '../passives.js';
import type { PassiveId } from '../passives.js';
import { getPartyClassLabel, getPartyMember, getPartyMembers, type PartyIndex } from '../party.web.js';
import { showTalentTree } from '../talents/talentTree.web.js';

type SkillCategory = 'guerrier' | 'mage' | 'voleur';

function getLearnedSkillIds(p: any): string[] {
    return ((p?.learnedSkillIds ?? []) as string[]).filter(Boolean);
}

function hasLearnedSkill(p: any, skill: Skill): boolean {
    const id = String((skill as any).skillId ?? '');
    if (id) return getLearnedSkillIds(p).includes(id);
    // fallback par nom
    return (p?.skills ?? []).some((hs: Skill) => hs?.name === skill?.name);
}

function goVillage() {
    // Avoid static circular dependencies with the village facade
    void import('./villageMain.web.js').then((m) => m.showVillage());
}

export function showCompetences() {

    const app = document.getElementById('app');
    if (!app) return;

    const party = getPartyMembers();

    app.innerHTML = `
        <img src="https://img.freepik.com/photos-premium/interieur-ecole-magie-est-rempli-bureaux-bois-pour-eleves-enseignants-tableau-noir-ecritures-craie-chaudron-potion-chapeaux-sorciere-sorts-livres-magie-baguettes-balai-dessin-anime_76964-82543.jpg" class="background background-competences" alt="Compétences">
        <div class="centered-content">
            <h1>Compétences</h1>
            <p>Sélectionner un personnage :</p>
            <div style="display:flex;flex-direction:column;gap:14px;align-items:center;margin-top:18px;">
                ${party
                    .map((p, idx) => {
                        const label = `${p.name} — ${getPartyClassLabel(p)} (Niv ${p.level})`;
                        return `<button class="btn" data-pidx="${idx}" style="min-width:320px;">${label}</button>`;
                    })
                    .join('')}
                <button class="btn" id="retourVillageBtn">Retour village</button>
            </div>
        </div>
    `;

    document.querySelectorAll('[data-pidx]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number((btn as HTMLElement).getAttribute('data-pidx')) as PartyIndex;
            showCompetencesFor(idx);
        });
    });

    document.getElementById('retourVillageBtn')?.addEventListener('click', goVillage);
}

function getPartyCategoryForIdx(idx: PartyIndex): SkillCategory {
    const p = getPartyMember(idx);
    const cls = String((p as any).characterClass ?? '').toLowerCase();
    if (cls === 'mage') return 'mage';
    if (cls === 'voleur') return 'voleur';
    return 'guerrier';
}

function showCompetencesFor(idx: PartyIndex): void {
    const app = document.getElementById('app');
    if (!app) return;

    const p = getPartyMember(idx);
    const skills = (p.skills ?? []) as Skill[];
    const skillsHtml = skills.length
        ? `<ul style="list-style:none;padding:0;">${skills
              .map((skill) => `<li data-skill-desc="${encodeSkillTooltip(skill)}" style="cursor:help;"><b>${skill.key}</b> : ${escapeHtml(skill.name)}</li>`)
              .join('')}</ul>`
        : '<p>Aucune compétence apprise.</p>';

    app.innerHTML = `
        <img src="https://img.freepik.com/photos-premium/interieur-ecole-magie-est-rempli-bureaux-bois-pour-eleves-enseignants-tableau-noir-ecritures-craie-chaudron-potion-chapeaux-sorciere-sorts-livres-magie-baguettes-balai-dessin-anime_76964-82543.jpg" class="background background-competences" alt="Compétences">
        <div class="centered-content">
            <h1>Compétences — ${p.name}</h1>
            <p>Points de compétence : <b>${p.skillPoints}</b></p>
            ${skillsHtml}
            <button class="btn" id="showTalentTreeBtn">Arbre de talents</button>
            <button class="btn" id="showUnlearnedBtn">Compétences non apprises</button>
            <button class="btn" id="showPassifsBtn">Passifs</button>
            <button class="btn" id="retourSelectionBtn">Retour sélection</button>
            <button class="btn" id="retourVillageBtn">Retour village</button>
        </div>
    `;

    installHoverTooltip(app, { selector: '[data-skill-desc]' });
    document.getElementById('showTalentTreeBtn')?.addEventListener('click', () => {
        showTalentTree({ selectedIdx: idx, onBack: (backIdx) => showCompetencesFor(backIdx) });
    });
    document.getElementById('showUnlearnedBtn')?.addEventListener('click', () => showUnlearnedCompetences(idx));
    document.getElementById('showPassifsBtn')?.addEventListener('click', () => showPassiveCompetences(idx));
    document.getElementById('retourSelectionBtn')?.addEventListener('click', showCompetences);
    document.getElementById('retourVillageBtn')?.addEventListener('click', goVillage);
}

export function showPassiveCompetences(selectedIdx: PartyIndex = 0) {
    const app = document.getElementById('app');
    if (!app) return;

    const selected = getPartyMember(selectedIdx);

    const passives = Object.values(PASSIVE_DEFS).slice().sort((a, b) => a.unlockLevel - b.unlockLevel);

    const learnedItems: string[] = [];
    const unlockedItems: string[] = [];
    const lockedItems: string[] = [];

    // Si un passif Blocage est appris, masquer les autres de la liste
    const blockLearned = ['blocage_voleur', 'blocage_guerrier', 'blocage_mage'].find((pid) => selected.hasPassive?.(pid as import('../passives.js').PassiveId));
    for (const passive of passives) {
        // Si un passif Blocage est appris, on masque les autres Blocage non appris
        if (blockLearned && ['blocage_voleur', 'blocage_guerrier', 'blocage_mage'].includes(passive.id) && !selected.hasPassive?.(passive.id)) continue;

        const learned = selected.hasPassive?.(passive.id) ?? false;
        const unlocked = selected.level >= passive.unlockLevel;

        const meetsCat = true;

        let status = '';
        let actionBtn = '';

        if (learned) {
            status = `<span style='color:#4caf50;'>(Appris)</span>`;
        } else if (unlocked) {
            status = `<span style='color:#ffd700;'>(Débloqué)</span>`;
            if (selected.skillPoints >= passive.costSkillPoints) {
                actionBtn = `<button class='btn' style='margin-left:12px;min-width:120px;padding:6px 18px;font-size:0.95em;' data-passive-id='${passive.id}'>Apprendre</button>`;
            } else {
                actionBtn = `<span style='color:#aaa;margin-left:12px;'>(Pas assez de points)</span>`;
            }
        } else {
            status = `<span style='color:#f55;'>(Niveau ${passive.unlockLevel} requis)</span>`;
        }

        const line = `<li data-skill-desc='${encodeURIComponent(passive.description)}' style='margin-bottom:10px;cursor:help;'><b>${passive.name}</b> ${status} <span style='color:#bbb;'>(coût ${passive.costSkillPoints})</span> ${actionBtn}</li>`;

        if (learned) learnedItems.push(line);
        else if (unlocked) unlockedItems.push(line);
        else lockedItems.push(line);
    }

    const learnedHtml = learnedItems.length
        ? `<ul style="list-style:none;padding:0;">${learnedItems.join('')}</ul>`
        : `<p style="color:#ccc;">Aucun passif appris.</p>`;

    const unlockedHtml = unlockedItems.length
        ? `<ul style="list-style:none;padding:0;">${unlockedItems.join('')}</ul>`
        : `<p style="color:#ccc;">Aucun passif débloqué.</p>`;

    const lockedHtml = lockedItems.length
        ? `<ul style="list-style:none;padding:0;">${lockedItems.join('')}</ul>`
        : `<p style="color:#ccc;">Aucun passif verrouillé.</p>`;

    app.innerHTML = `
        <img src="https://img.freepik.com/photos-premium/interieur-ecole-magie-est-rempli-bureaux-bois-pour-eleves-enseignants-tableau-noir-ecritures-craie-chaudron-potion-chapeaux-sorciere-sorts-livres-magie-baguettes-balai-dessin-anime_76964-82543.jpg" class="background background-competences" alt="Passifs">
        <div class="centered-content" style="max-width:1000px;">
            <h1>Passifs — ${selected.name}</h1>
            <p>Points de compétence : <b id='skillPointsVal'>${selected.skillPoints}</b></p>
            <div class="skills-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;align-items:start;">
                <div class="skills-column" style="background:rgba(0,0,0,0.25);padding:12px;border-radius:8px;">
                    <h3>Appris</h3>
                    ${learnedHtml}
                </div>
                <div class="skills-column" style="background:rgba(0,0,0,0.18);padding:12px;border-radius:8px;">
                    <h3>Débloqués</h3>
                    ${unlockedHtml}
                </div>
                <div class="skills-column" style="background:rgba(0,0,0,0.18);padding:12px;border-radius:8px;">
                    <h3>Verrouillés</h3>
                    ${lockedHtml}
                </div>
            </div>
            <div style="margin-top:12px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                <button class="btn" id="retourCompetencesBtn">Retour compétences</button>
                <button class="btn" id="retourVillageBtn">Retour village</button>
            </div>
        </div>
    `;

    installHoverTooltip(app, { selector: '[data-skill-desc]' });

    document.querySelectorAll('[data-passive-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).getAttribute('data-passive-id') as PassiveId;
            // Apprend et rafraîchit
            getPartyMember(selectedIdx).learnPassive(id);
            showPassiveCompetences(selectedIdx);
        });
    });

    document.getElementById('retourCompetencesBtn')?.addEventListener('click', () => showCompetencesFor(selectedIdx));
    document.getElementById('retourVillageBtn')?.addEventListener('click', goVillage);
}

export function showUnlearnedCompetences(selectedIdx: PartyIndex = 0) {
    const app = document.getElementById('app');
    const skillTree = window.game?.skillTree ?? [];
    const p = getPartyMember(selectedIdx);
    let allHtml = '<ul style="list-style:none;padding:0;">';
    const selectedCat = getPartyCategoryForIdx(selectedIdx);

    skillTree.forEach((s, idx: number) => {
        const cat = (s.skill as any).category as SkillCategory | undefined;
        // Special-case: allow the thief to see the permanent buff
        const specialShownToVoleur = selectedCat === 'voleur' && String((s.skill as any).name ?? '').toLowerCase() === 'buff permanent';
        if (cat !== selectedCat && !specialShownToVoleur) return;

        const learned = hasLearnedSkill(p as any, s.skill);
        const unlocked = p.level >= s.unlockLevel;
        const meetsCat = true;
        let status = '';
        let actionBtn = '';
        if (learned) {
            status = `<span style='color:#4caf50;'>(Apprise)</span>`;
        } else if (unlocked) {
            status = `<span style='color:#ffd700;'>(Débloquée)</span>`;
            if (p.skillPoints > 0) {
                actionBtn = `<button class='btn' style='margin-left:12px;min-width:120px;padding:6px 18px;font-size:1em;' data-idx='${idx}'>Apprendre</button>`;
            } else {
                actionBtn = `<span style='color:#aaa;margin-left:12px;'>(Pas assez de points)</span>`;
            }
        } else {
            status = `<span style='color:#f55;'>(Niveau ${s.unlockLevel} requis)</span>`;
        }
        allHtml += `<li data-skill-desc='${encodeSkillTooltip(s.skill)}' style='margin-bottom:10px;cursor:help;'><b>${s.skill.key}</b> : ${s.skill.name} ${status} ${actionBtn}</li>`;
    });
    allHtml += '</ul>';
    // Separate into three groups: learned (possédées), unlocked-but-not-learned (débloquées), and locked (non apprises)
    const learnedItems: string[] = [];
    const unlockedNotLearnedItems: Array<{ sortKey: string; html: string }> = [];
    const lockedItems: string[] = [];

    const categoryOrder: SkillCategory[] = ['guerrier', 'mage', 'voleur'];
    const getCategoryIndex = (cat: SkillCategory | undefined): number => {
        if (!cat) return 999;
        const idx = categoryOrder.indexOf(cat);
        return idx >= 0 ? idx : 999;
    };
    skillTree.forEach((s, idx: number) => {
        const cat = (s.skill as any).category as SkillCategory | undefined;
        const specialShownToVoleur = selectedCat === 'voleur' && String((s.skill as any).name ?? '').toLowerCase() === 'buff permanent';
        if (cat !== selectedCat && !specialShownToVoleur) return;

        const learned = hasLearnedSkill(p as any, s.skill);
        const unlocked = p.level >= s.unlockLevel;
        const meetsCat = true;
        let status = '';
        let actionBtn = '';
        if (learned) {
            status = `<span style='color:#4caf50;'>(Apprise)</span>`;
        } else if (unlocked) {
            status = `<span style='color:#ffd700;'>(Débloquée)</span>`;
            if (p.skillPoints > 0) {
                actionBtn = `<button class='btn' style='margin-left:12px;min-width:120px;padding:6px 18px;font-size:0.95em;' data-idx='${idx}'>Apprendre</button>`;
            } else {
                actionBtn = `<span style='color:#aaa;margin-left:12px;'>(Pas assez de points)</span>`;
            }
        } else {
            status = `<span style='color:#f55;'>(Niveau ${s.unlockLevel} requis)</span>`;
        }

        const li = (inner: string) => `<li data-skill-desc='${encodeSkillTooltip(s.skill)}' style='margin-bottom:10px;cursor:help;'>${inner}</li>`;

        if (learned) {
            learnedItems.push(li(`<b>${s.skill.key}</b> : ${escapeHtml(s.skill.name)} ${status}`));
        } else if (unlocked) {
            const itemHtml = li(`<b>${s.skill.key}</b> : ${escapeHtml(s.skill.name)} ${status} ${actionBtn}`);
            // Tri stable: catégorie -> niveau de déblocage -> index original (pour conserver l'ordre du skillTree)
            const sortKey = `${String(getCategoryIndex(cat)).padStart(3, '0')}_${String(s.unlockLevel).padStart(4, '0')}_${String(idx).padStart(4, '0')}`;
            unlockedNotLearnedItems.push({ sortKey, html: itemHtml });
        } else {
            lockedItems.push(li(`<b>${s.skill.key}</b> : ${escapeHtml(s.skill.name)} ${status}`));
        }
    });

    // Include base skills (those present on the hero but not listed in the skillTree)
    // Determine base skills by comparing names only (avoids hiding starter skills that share keys with later unlocks)
    const baseSkills = (p.skills ?? [])
        .filter((hs: Skill) => ((hs as any).category as SkillCategory | undefined) === selectedCat)
        .filter((hs: Skill) => !skillTree.some((s) => s.skill.name === hs.name));
    let baseHtml = '';
    if (baseSkills.length) {
        const items = baseSkills.map((bs: Skill) => `<li data-skill-desc='${encodeSkillTooltip(bs)}' style='margin-bottom:10px;cursor:help;'><b>${bs.key}</b> : ${escapeHtml(bs.name)} <span style='color:#ccc;'>(Compétence de base)</span></li>`);
        baseHtml = `<h4 style="margin-bottom:8px;">Compétences de base</h4><ul style="list-style:none;padding:0;">${items.join('')}</ul>`;
    }

    const otherLearnedHtml = learnedItems.length ? `<h4 style="margin-top:12px;">Autres apprises</h4><ul style="list-style:none;padding:0;">${learnedItems.join('')}</ul>` : '';
    const learnedHtml = (baseHtml || otherLearnedHtml) ? `${baseHtml}${otherLearnedHtml}` : '<p style="color:#ccc;">Aucune compétence apprise.</p>';
    const unlockedSorted = unlockedNotLearnedItems
        .slice()
        .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
        .map((x) => x.html);
    const unlockedHtml = unlockedSorted.length ? `<ul style="list-style:none;padding:0;">${unlockedSorted.join('')}</ul>` : '<p style="color:#ccc;">Aucune compétence débloquée.</p>';

    // Create locked columns of up to 10 items each
    const lockedCols: string[] = [];
    for (let i = 0; i < lockedItems.length; i += 10) {
        lockedCols.push(`<ul style="list-style:none;padding:0;">${lockedItems.slice(i, i + 10).join('')}</ul>`);
    }
    const firstColHtml = lockedCols[0] || '';
    const secondColHtml = lockedCols[1] || '';
    const extraCols = lockedCols.slice(2);
    let extraGridHtml = '';
    if (extraCols.length) {
        extraGridHtml = `<div class="extra-grid" style="display:grid;grid-template-columns:repeat(${extraCols.length},1fr);gap:18px;margin-top:12px;">` +
            extraCols.map(c => `<div class="skills-column" style="background:rgba(0,0,0,0.18);padding:12px;border-radius:8px;">${c}</div>`).join('') +
            `</div>`;
    }

    if (!app) return;
    app.innerHTML = `
        <img src="https://img.freepik.com/photos-premium/interieur-ecole-magie-est-rempli-bureaux-bois-pour-eleves-enseignants-tableau-noir-ecritures-craie-chaudron-potion-chapeaux-sorciere-sorts-livres-magie-baguettes-balai-dessin-anime_76964-82543.jpg" class="background background-competences" alt="Compétences">
        <div class="centered-content" style="max-width:1000px;">
            <h1>Compétences — ${getPartyMember(selectedIdx).name}</h1>
            <p>Points de compétence : <b id='skillPointsVal'>${p.skillPoints}</b></p>
            <div class="skills-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;align-items:start;">
                <div class="skills-column" style="background:rgba(0,0,0,0.25);padding:12px;border-radius:8px;">
                    <h3>Apprises</h3>
                    ${learnedHtml}
                </div>
                <div class="skills-column" style="background:rgba(0,0,0,0.18);padding:12px;border-radius:8px;">
                    <h3>Débloquées</h3>
                    ${unlockedHtml}
                </div>
                <div class="skills-column" style="background:rgba(0,0,0,0.18);padding:12px;border-radius:8px;">
                    <h3>Non apprises</h3>
                    ${firstColHtml}
                </div>
            </div>
            ${extraGridHtml ? `<div style="display:flex;justify-content:flex-end;gap:18px;margin-top:12px;">${extraCols.map(c => `<div style="background:rgba(0,0,0,0.18);padding:12px;border-radius:8px;">${c}</div>`).join('')}</div>` : ''}
            <div style="margin-top:12px; display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                <button class="btn" id="retourCompetencesBtn">Retour compétences</button>
                <button class="btn" id="retourSelectionBtn">Retour sélection</button>
            </div>
        </div>
    `;

    installHoverTooltip(app, { selector: '[data-skill-desc]' });
    // Ajout des listeners pour les boutons "Apprendre"
    skillTree.forEach((s, idx: number) => {
        const cat = (s.skill as any).category as SkillCategory | undefined;
        const specialShownToVoleur = selectedCat === 'voleur' && String((s.skill as any).name ?? '').toLowerCase() === 'buff permanent';
        if (cat !== selectedCat && !specialShownToVoleur) return;
        const meetsCat = true;

        if (!hasLearnedSkill(p as any, s.skill) && p.level >= s.unlockLevel && p.skillPoints > 0 && meetsCat) {
            const btn = document.querySelector(`[data-idx='${idx}']`);
            if (btn) {
                btn.addEventListener('click', () => {
                    const sid = String((s.skill as any).skillId ?? '');
                    if (sid) {
                        const learned = getLearnedSkillIds(p as any);
                        if (!learned.includes(sid)) learned.push(sid);
                        (p as any).learnedSkillIds = learned;
                    }
                    p.skillPoints = Math.max(0, Math.floor(p.skillPoints ?? 0) - 1);
                    // Rafraîchir la vue
                    showUnlearnedCompetences(selectedIdx);
                });
            }
        }
    });
    document.getElementById('retourCompetencesBtn')?.addEventListener('click', () => showCompetencesFor(selectedIdx));
    document.getElementById('retourSelectionBtn')?.addEventListener('click', showCompetences);
}
