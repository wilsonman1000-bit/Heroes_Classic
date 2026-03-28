import type { DialogueContext } from './dialogueTypes.js';
import { addVirtue, type VirtueKey } from '../virtues.js';

const VIRTUE_LABEL: Record<VirtueKey, string> = {
    honneur: 'honneur',
    liberte: 'liberté',
    humanite: 'humanité',
};

const VIRTUE_COLOR: Record<VirtueKey, string> = {
    honneur: '#ff4b4b',
    liberte: '#ffd36a',
    humanite: '#4ea7ff',
};

export function gainVirtue(ctx: DialogueContext, key: VirtueKey, delta: number): number {
    const d = Math.floor(Number(delta ?? 0));
    if (!Number.isFinite(d) || d === 0) return addVirtue(ctx.hero, key, 0);

    const next = addVirtue(ctx.hero, key, d);

    const sign = d > 0 ? '+' : '';
    ctx.dialogueFx?.floatText(`${sign}${d} ${VIRTUE_LABEL[key]}`, { color: VIRTUE_COLOR[key] });

    return next;
}
