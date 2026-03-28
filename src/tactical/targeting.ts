import type { Skill } from '../skill.js';
import type { Pos } from '../tacticalBoard.js';

export function getSkillStableKey(skill: Skill): string {
    return String((skill as any).skillId ?? skill.key ?? skill.name);
}

export function isEnemyTargetingSkill(skill: Skill): boolean {
    // Skills offensifs (sur ennemi)
    return skill.type === 'damage' || skill.type === 'debuff' || skill.type === 'dot';
}

export function isSelfTargetingSkill(skill: Skill): boolean {
    // Only skills that are actually cast on self.
    return skill.type === 'buff' || skill.type === 'defense' || skill.type === 'mana';
}

export function isAllyHealSkill(skill: Skill): boolean {
    // Permet de cibler un allié (ex: Soin) sur le plateau.
    return skill.type === 'heal' || skill.type === 'hot';
}

export function getSkillRange(skill: Skill): number {
    const id = String((skill as any).skillId ?? '');

    const tacticalRange = Number((skill as any)?.tactical?.range ?? NaN);
    if (Number.isFinite(tacticalRange) && tacticalRange > 0) return Math.floor(tacticalRange);

    // Demande utilisateur (pour l'instant):
    // - attaque de base: portée 1
    // - tous les autres sorts offensifs: portée illimitée (comme Missile magique)
    // - sorts sur soi: pas de notion de portée
    if (id === 'basic_attack' || skill.name === 'Attaque de base') return 1;
    if (isEnemyTargetingSkill(skill)) return 999;
    return 0;
}

export function distManhattan(a: Pos, b: Pos): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function getRangedAimModeForActor(actor: unknown): 'manhattan' | 'orthogonal' | 'diagonal' | 'diagonal_strict' {
    const cls = String((actor as any)?.characterClass ?? '').toLowerCase();
    if (cls === 'mage') return 'orthogonal';
    if (cls === 'voleur') return 'diagonal';
    return 'manhattan';
}

function getAimModeForSkill(
    caster: unknown,
    skill: Skill
): 'manhattan' | 'orthogonal' | 'diagonal' | 'diagonal_strict' | 'circle' | 'square' {
    const override = String((skill as any)?.tactical?.aim ?? '').toLowerCase();
    if (override === 'orthogonal') return 'orthogonal';
    if (override === 'diagonal_strict' || override === 'diagonal-only' || override === 'diagonalonly') return 'diagonal_strict';
    if (override === 'diagonal') return 'diagonal';
    if (override === 'manhattan') return 'manhattan';
    if (override === 'circle' || override === 'euclidean') return 'circle';
    if (override === 'square' || override === 'chebyshev') return 'square';
    return getRangedAimModeForActor(caster);
}

export function getDirectionalDistance(
    mode: 'manhattan' | 'orthogonal' | 'diagonal' | 'diagonal_strict' | 'circle' | 'square',
    from: Pos,
    to: Pos
): number {
    const dx = Math.abs(from.x - to.x);
    const dy = Math.abs(from.y - to.y);
    if (dx === 0 && dy === 0) return 0;

    // Circle (euclidean): allow all directions within a radius.
    if (mode === 'circle') return Math.sqrt(dx * dx + dy * dy);
    // Square (chebyshev): allow any direction within a square radius.
    if (mode === 'square') return Math.max(dx, dy);
    if (mode === 'manhattan') return dx + dy;
    if (mode === 'orthogonal') return dx === 0 || dy === 0 ? dx + dy : Number.POSITIVE_INFINITY;
    // diagonal_strict: only allow exact diagonal moves (dx === dy) (e.g., move one cell diagonally only)
    if (mode === 'diagonal_strict') return dx === dy ? dx : Number.POSITIVE_INFINITY;
    // diagonal (flexible): allow diagonal lines, and also allow adjacent orthogonal for melee convenience
    if (dx + dy === 1) return 1;
    return dx === dy ? dx : Number.POSITIVE_INFINITY;
}

export function isWithinSkillRangeDirectional(caster: any, skill: Skill, from: Pos, to: Pos): boolean {
    const range = getSkillRange(skill);
    if (range <= 0) return false;

    // Attaque de base: manhattan par défaut, sauf pour le joueur "Voleur" (adjacent incl. diagonale).
    const id = String((skill as any).skillId ?? '');
    const cls = String((caster as any)?.characterClass ?? '').toLowerCase();
    const isPlayerVoleur = Boolean((caster as any)?.isPlayer) && cls === 'voleur';
    const mode = id === 'basic_attack' && !isPlayerVoleur ? 'manhattan' : getAimModeForSkill(caster, skill);
    const d = getDirectionalDistance(mode, from, to);
    return d > 0 && d <= range;
}
