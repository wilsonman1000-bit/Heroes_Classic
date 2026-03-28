import type { TacticalUnit } from '../tacticalBoard.js';
import { getIdleSpriteSrc } from '../characterSprites.web.js';

type ActiveEffectLike = {
    type: string;
    amount: number;
    remainingTurns: number;
    remainingHits?: number;
    sourceSkill?: string;
    sourceSkillId?: string;
};

const turnsText = (t: number | undefined) => {
    const n = Number(t ?? 0);
    if (n === -1) return '∞';
    return String(Math.max(0, Math.floor(n)));
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

const effectTitle = (e: ActiveEffectLike): string => {
    const base = e.sourceSkill ? `${e.sourceSkill} — ` : '';
    if (e.type === 'dot') return `${base}DoT: -${Math.abs(Math.round(e.amount))} PV/t (${turnsText(e.remainingTurns)}t)`;
    if (e.type === 'hot') return `${base}HoT: +${Math.abs(Math.round(e.amount))} PV/t (${turnsText(e.remainingTurns)}t)`;
    if (e.type === 'mana_regen') {
        const sign = (e.amount ?? 0) >= 0 ? '+' : '';
        return `${base}Mana/t: ${sign}${Math.round(e.amount)} (${turnsText(e.remainingTurns)}t)`;
    }
    if (e.type === 'buff') return `${base}Buff attaque: +${pct(e.amount)} (${turnsText(e.remainingTurns)}t)`;
    if (e.type === 'debuff') return `${base}Débuff attaque: -${pct(e.amount)} (${turnsText(e.remainingTurns)}t)`;
    if (e.type === 'defense') return `${base}Défense: -${pct(e.amount)} dmg (${turnsText(e.remainingTurns)}t)`;
    if (e.type === 'vulnerability') {
        const hits = Math.max(0, Math.floor((e as any).remainingHits ?? 0));
        if (hits > 0) return `${base}Vulnérable: +${pct(e.amount)} dmg reçus (${hits} hit(s))`;
        return `${base}Vulnérable: +${pct(e.amount)} dmg reçus (${turnsText(e.remainingTurns)}t)`;
    }
    return `${base}${e.type}`;
};

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const effectBadge = (e: ActiveEffectLike): { className: string; label: string } => {
    const id = norm(String(e.sourceSkillId ?? ''));
    const name = norm(String(e.sourceSkill ?? ''));

    if (e.type === 'dot') {
        if (id.includes('poison') || name.includes('poison')) return { className: 'dot poison', label: '☠' };
        if (id.includes('brulure') || name.includes('brulure') || name.includes('brul')) return { className: 'dot burn', label: '🔥' };
        return { className: 'dot', label: 'DoT' };
    }
    if (e.type === 'hot') return { className: 'hot', label: '✚' };
    if (e.type === 'buff') return { className: 'buff', label: '⚔' };
    if (e.type === 'debuff') return { className: 'debuff', label: '⚔' };
    if (e.type === 'defense') return { className: 'defense', label: '🛡' };
    if (e.type === 'vulnerability') return { className: 'vulnerability', label: '!' };
    if (e.type === 'mana_regen') {
        const isNeg = (e.amount ?? 0) < 0;
        return { className: `mana_regen ${isNeg ? 'neg' : 'pos'}`, label: isNeg ? 'M-' : 'M+' };
    }
    return { className: e.type, label: String(e.type).slice(0, 3).toUpperCase() };
};

const getActiveEffects = (actor: any): ActiveEffectLike[] => {
    const list = (((actor as any)?.activeEffects ?? []) as ActiveEffectLike[]) || [];
    return list.filter((e) => !!e && typeof e.type === 'string' && (e.remainingTurns ?? 0) !== 0);
};

const renderEffectBadges = (effects: ActiveEffectLike[], maxCount: number, variant: 'sprite' | 'panel'): string => {
    const list = (effects || []).slice(0, maxCount);
    const baseClass = variant === 'panel' ? 'unit-panel-effbadge' : 'unit-sprite-effbadge';
    return list
        .map((e) => {
            const meta = effectBadge(e);
            const klass = `${baseClass} ${meta.className}`;
            const title = effectTitle(e).replace(/"/g, '&quot;');
            return `<span class="${klass}" title="${title}">${meta.label}</span>`;
        })
        .join('');
};

export function renderUnitHtml(u: TacticalUnit): string {
    const teamClass = u.team === 'allies' ? 'unit-team-allies' : 'unit-team-enemies';
    const actor = u.actor;
    const cls = String((actor as any)?.characterClass ?? '').toLowerCase();
    let spriteSrc = u.team === 'allies'
        ? (cls === 'mage'
            ? './ImagesRPG/imagespersonnage/mage.png'
            : cls === 'voleur'
                ? './ImagesRPG/imagespersonnage/voleur.png'
                : cls === 'guerrier'
                    ? (getIdleSpriteSrc(cls) ?? './ImagesRPG/imagespersonnage/true_perso_guerrier.png')
                    : './ImagesRPG/imagespersonnage/trueplayer.png')
        : ((actor as any)?.image ?? './ImagesRPG/imagespersonnage/trueennemi.png');

    const maxPv = Math.max(1, Math.floor(actor?.maxPv ?? u.maxPv ?? 1));
    const pv = Math.max(0, Math.floor(actor?.pv ?? u.pv ?? 0));
    const hpPct = Math.max(0, Math.min(100, (pv / maxPv) * 100));

    const maxMana = Math.max(0, Math.floor((actor as any)?.effectiveMaxMana ?? actor?.maxMana ?? 0));
    const mana = Math.max(0, Math.floor(actor?.currentMana ?? 0));
    const manaPct = maxMana > 0 ? Math.max(0, Math.min(100, (mana / maxMana) * 100)) : 0;

    const apMax = Math.max(0, Math.floor((actor as any)?.actionPointsMax ?? u.actionPointsMax ?? 0));
    const ap = Math.max(0, Math.floor((actor as any)?.actionPoints ?? u.actionPoints ?? 0));
    const apDots = apMax > 0
        ? Array.from({ length: apMax })
              .map((_, i) => `<span class="unit-sprite-apdot ${i < ap ? 'filled' : ''}"></span>`)
              .join('')
        : '';

    // Étourdissement: badge visible si stunTurns > 0
    const stunTurns = Math.max(0, Math.floor(Number((actor as any)?.stunTurns ?? 0)));
    const stunBadge = stunTurns > 0 ? `<div class="unit-sprite-stun" title="Étourdi: ${stunTurns} tour(s)">💫 Étourdi</div>` : '';

    // If a temporary sprite is set (e.g., attack animation), prefer it.
    const tempSprite = String((actor as any)?.__tempSprite ?? '');
    if (tempSprite) {
        spriteSrc = tempSprite;
    } else {
        // If a warrior is stunned, show alternate 'stunned' sprite
        if (u.team === 'allies' && cls === 'guerrier' && stunTurns > 0) {
            spriteSrc = './ImagesRPG/imagespersonnage/perso_guerrier_mort.png';
        }
    }

    const activeEffects = getActiveEffects(actor as any);

    const hpAffecting = activeEffects.filter((e) => e.type === 'dot' || e.type === 'hot' || e.type === 'defense' || e.type === 'vulnerability');
    const manaAffecting = activeEffects.filter((e) => e.type === 'mana_regen');
    const statAffecting = activeEffects.filter((e) => e.type === 'buff' || e.type === 'debuff' || e.type === 'defense' || e.type === 'vulnerability');

    const hpDots = renderEffectBadges(hpAffecting, 4, 'sprite');
    const manaDots = renderEffectBadges(manaAffecting, 4, 'sprite');
    const statDots = renderEffectBadges(statAffecting, 4, 'sprite');

    let imgStyle = '';
    if (u.team === 'allies') {
        if (cls === 'mage') imgStyle = 'transform:scale(0.9);';
        if (cls === 'voleur') imgStyle = 'transform:scale(0.8);';
    }
    // Shift all character sprites up by ~20% of their own height so they "stand" slightly above the tile center.
    if (imgStyle.includes('transform:')) {
        imgStyle = imgStyle.replace(/transform:\s*([^;]+);?/, (_m, group1) => `transform:${group1} translateY(-30%);`);
    } else {
        imgStyle += 'transform:translateY(-30%);';
    }
    return `
        <div class="unit-sprite-wrap ${teamClass}">
            <img class="unit-sprite" src="${spriteSrc}" alt="${u.name}" style="${imgStyle}">
            ${statDots ? `<div class="unit-sprite-stats">${statDots}</div>` : ''}
            ${apDots ? `<div class="unit-sprite-ap">${apDots}</div>` : ''}
            <div class="unit-sprite-overlay">
                <div class="unit-sprite-bar hp" title="${pv}/${maxPv} PV">
                    <div class="unit-sprite-barfill hp" style="width:${hpPct}%;"></div>
                    ${hpDots ? `<div class="unit-sprite-effects">${hpDots}</div>` : ''}
                </div>
                ${maxMana > 0 ? `<div class="unit-sprite-bar mana" title="${mana}/${maxMana} Mana"><div class="unit-sprite-barfill mana" style="width:${manaPct}%;"></div>${manaDots ? `<div class="unit-sprite-effects">${manaDots}</div>` : ''}</div>` : ''}
            </div>
        </div>
    `;
}

export function renderBarsRow(u: TacticalUnit, isActive: boolean): string {
    const actor = u.actor;
    const maxPv = (actor as any)?.maxPv ?? u.maxPv;
    const pv = (actor as any)?.pv ?? u.pv;
    const maxMana = (actor as any)?.effectiveMaxMana ?? (actor as any)?.maxMana ?? 0;
    const mana = (actor as any)?.currentMana ?? 0;
    const hpPct = maxPv > 0 ? Math.max(0, Math.min(100, (pv / maxPv) * 100)) : 0;
    const manaPct = maxMana > 0 ? Math.max(0, Math.min(100, (mana / maxMana) * 100)) : 0;
    const hpClass = u.team === 'allies' ? 'player' : 'enemy';

    const effects = getActiveEffects(actor as any);
    const effectWeight = (e: ActiveEffectLike): number => {
        if (e.type === 'hot') return 10;
        if (e.type === 'mana_regen' && (e.amount ?? 0) >= 0) return 11;
        if (e.type === 'buff') return 12;
        if (e.type === 'defense') return 20;
        if (e.type === 'debuff') return 30;
        if (e.type === 'vulnerability') return 31;
        if (e.type === 'mana_regen' && (e.amount ?? 0) < 0) return 32;
        if (e.type === 'dot') return 40;
        return 50;
    };

    const effectsHtml = (() => {
        if (!effects.length) return '';
        const sorted = [...effects].sort((a, b) => effectWeight(a) - effectWeight(b));
        const badges = renderEffectBadges(sorted, 12, 'panel');
        if (!badges) return '';
        return `<div class="unit-panel-effects">${badges}</div>`;
    })();

    return `
        <div style="padding:10px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); ${isActive ? 'outline:2px solid rgba(255,255,255,0.55);' : ''}">
            <div class="hp-label" style="margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <span><b>${u.name}</b></span>
                <span style="font-size:0.92em; color:#ddd;">PA ${u.actionPoints}/${u.actionPointsMax}</span>
            </div>
            ${effectsHtml}
            <div class="hp-bar-container"><div class="hp-bar ${hpClass}" style="width:${hpPct}%;"></div><div class="bar-label">${Math.max(0, Math.floor(pv))}/${Math.max(1, Math.floor(maxPv))}</div></div>
            <div class="mana-bar-container"><div class="mana-bar" style="width:${manaPct}%;"></div><div class="bar-label">${Math.max(0, Math.floor(mana))}/${Math.max(0, Math.floor(maxMana))}</div></div>
        </div>
    `;
}
