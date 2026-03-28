import { type Skill } from './skill.js';
import { installHoverTooltip, escapeHtml } from './utils.web.js';
import { createSkill, findCanonicalSkillByNameOrKey } from './skillLibrary.js';

export function encodeSkillTooltip(skill: Skill): string {
    // Use canonical skill description when available (reflects latest factory changes)
    const skillId = String((skill as any).skillId ?? '');
    let canonical: any = null;
    if (skillId) {
        try {
            canonical = createSkill(skillId as any);
        } catch {
            canonical = null;
        }
    }
    if (!canonical) {
        // Try to resolve by key/name/id for skill objects that lack a stable id (or have a non-factory id)
        const key = String((skill as any).key ?? '');
        const name = String(skill?.name ?? '');
        const otherId = String((skill as any).id ?? '');
        canonical =
            findCanonicalSkillByNameOrKey(skillId) ??
            findCanonicalSkillByNameOrKey(key) ??
            findCanonicalSkillByNameOrKey(name) ??
            findCanonicalSkillByNameOrKey(otherId) ??
            null;
    }
    const s: any = canonical ?? skill;
    const description = s.description ?? skill.description ?? '';

    let stats = '';
    const percent = (v: number) => Math.round(v * 100) + '%';
    switch (s.type) {
        case 'damage':
            stats = `Attaque ${percent(s.damage ?? 0)}`;
            break;
        case 'heal':
            stats = `Soin ${percent(s.heal ?? 0)}`;
            break;
        case 'buff':
            if (s.manaRegenAmount !== undefined) {
                stats = `Mana/t : +${s.manaRegenAmount}`;
            } else {
                stats = `Bonus : ${percent(s.buffAmount ?? 0)}`;
            }
            if (s.duration) stats += `, Durée : ${s.duration} tours`;
            break;
        case 'debuff':
            if (s.vulnerabilityAmount !== undefined) {
                stats = `Dégâts reçus : +${percent(s.vulnerabilityAmount ?? 0)}`;
                const hits = Number(s.hits ?? 0);
                const dur = Number(s.duration ?? 0);
                if (hits > 0) stats += `, Attaques : ${hits}`;
                else if (dur) stats += `, Durée : ${dur} tours`;
            } else {
                stats = `Malus : ${percent(s.debuffAmount ?? 0)}`;
                if (s.duration) stats += `, Durée : ${s.duration} tours`;
            }
            break;
        case 'dot':
            stats = `Dégâts/tour : ${percent(s.damagePerTurn ?? 0)} attaque`;
            if (s.duration) stats += `, Durée : ${s.duration} tours`;
            break;
        case 'hot':
            stats = `Soin/tour : ${percent(s.healPerTurn ?? 0)} attaque`;
            if (s.duration) stats += `, Durée : ${s.duration} tours`;
            break;
        case 'defense':
            stats = `Réduction : ${percent(s.defenseAmount ?? 0)}`;
            if (s.duration) stats += `, Durée : ${s.duration} tours`;
            break;
        case 'mana':
            stats = '';
            break;
        case 'movement': {
            const range = Number(s?.tactical?.range ?? 0);
            if (range > 0) stats = `Portée : ${Math.floor(range)}`;
            break;
        }
        default:
            stats = '';
    }

    // If a tactical range is defined for any skill, include it (useful for damage/assassinat/etc.)
    try {
        const tacticalRange = Number(s?.tactical?.range ?? 0);
        if (tacticalRange > 0 && !stats.includes('Portée')) {
            stats += (stats ? ', ' : '') + `Portée : ${Math.floor(tacticalRange)}`;
        }
    } catch (e) { /* noop */ }

    if (s.manaCost && s.manaCost > 0) {
        stats += (stats ? ', ' : '') + `Coût : ${s.manaCost} mana`;
    }
    if (s.actionPoints && s.actionPoints > 0) {
        stats += (stats ? ', ' : '') + `Coût : ${s.actionPoints} PA`;
    }
    // Always show cooldown explicitly (includes 0)
    stats += (stats ? ', ' : '') + `Cooldown : ${s.cooldownTurns ?? 0} tours`;
    return encodeURIComponent(`${s.name}${stats ? ' — ' + stats : ''} : ${description}`);
}

export function getSkillIconSrc(skill: Skill): string {
    const skillId = String((skill as any).skillId ?? '').toLowerCase();
    const n = skill.name.toLowerCase();

    // Specific icon overrides (by stable id or by name)
    if (skillId === 'shuriken' || n.includes('shuriken')) return './ImagesRPG/imagesobjets/kunai.png';

    if (skill.type === 'movement' || n.includes('téléport') || n.includes('teleport')) return './ImagesRPG/imageskill/iconemana.png';
    if (skill.type === 'mana' || n.includes('gain de mana') || n.includes('regen mana') || (n.includes('regen') && n.includes('mana'))) return './ImagesRPG/imageskill/iconemana.png';

    if (n.includes('regénération') || n.includes('régénération')) return './ImagesRPG/imageskill/soinrouge.png';
    if (n.includes('drain de vie') || n.includes('drain')) return './ImagesRPG/imageskill/iconedrain.png';
    if (skill.type === 'defense' || n.includes('blocage') || n.includes('bouclier')) return './ImagesRPG/imageskill/iconeshield.png';
    if (skill.type === 'debuff' || n.includes('débuff') || n.includes('debuff')) return './ImagesRPG/imageskill/iconedebuff.png';
    if (skill.type === 'buff' || n.includes('buff attaque') || n.includes('buff permanent')) return './ImagesRPG/imageskill/iconebuffattaque.png';
    // Specific icon for Hache lourde
    if (n.includes('hache lourde') || n === 'hache lourde') return './ImagesRPG/imageskill/hache.png';
    if (n.includes('attaque') || n.includes('hache')) return './ImagesRPG/imageskill/iconeattaque.png';
    if (n.includes('poison')) return './ImagesRPG/imageskill/iconepoison.png';
    if (n.includes('malédiction') || n.includes('crâne')) return './ImagesRPG/imageskill/iconecrane.png';
    if (n.includes('feu') || n.includes('boule de feu')) return './ImagesRPG/imageskill/iconefeu.png';
    if (n.includes('éclair') || n.includes('eclair')) return './ImagesRPG/imageskill/eclair.png';
    if (skill.type === 'heal' || n.includes('soin') || n.includes('heal')) return './ImagesRPG/imageskill/iconesoin.png';

    return './ImagesRPG/imageskill/iconeattaque.png';
}

export function renderSkillButtons(
    container: HTMLElement,
    skills: Skill[],
    onClick: (skill: Skill) => void,
    opts?: {
        buttonClass?: string;
        buttonStyle?: string;
        playerPA?: number;
        getCooldownRemaining?: (skill: Skill) => number;
    }
): void {
    const buttonClass = opts?.buttonClass ?? 'btn skill-btn';
    const buttonStyle = opts?.buttonStyle ?? 'margin:0 12px 0 0;display:inline-block;';
    const playerPA = opts?.playerPA ?? 0;
    const getCooldownRemaining = opts?.getCooldownRemaining;

    container.innerHTML = skills
        .map(
            (skill, idx) => {
                return `<button class='${buttonClass}' style='${buttonStyle}' data-idx='${idx}' data-skill-desc='${encodeSkillTooltip(skill)}' aria-label='${escapeHtml(skill.name)}'>
                    <img src='${getSkillIconSrc(skill)}' alt='${escapeHtml(skill.name)}'>
                </button>`;
            }
        )
        .join('');

    installHoverTooltip(container, { selector: 'button[data-skill-desc]' });

    const buttons = container.querySelectorAll<HTMLButtonElement>('button[data-idx]');
    buttons.forEach((btn) => {
        const idxStr = btn.getAttribute('data-idx');
        const idx = idxStr ? Number(idxStr) : NaN;
        if (!Number.isFinite(idx) || idx < 0 || idx >= skills.length) return;
        const skill = skills[idx];
        if (!skill) return;
        btn.addEventListener('click', () => onClick(skill));
    });
}
