export type VirtueKey = 'honneur' | 'liberte' | 'humanite';

function clamp0100(n: unknown): number {
    const v = Math.floor(Number(n ?? 0));
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v));
}

export function getVirtue(actor: any, key: VirtueKey): number {
    if (!actor) return 0;
    return clamp0100((actor as any)[key]);
}

export function setVirtue(actor: any, key: VirtueKey, value: unknown): number {
    if (!actor) return 0;
    const v = clamp0100(value);
    (actor as any)[key] = v;
    return v;
}

export function addVirtue(actor: any, key: VirtueKey, delta: unknown): number {
    if (!actor) return 0;
    const cur = clamp0100((actor as any)[key]);
    const d = Math.floor(Number(delta ?? 0));
    const next = clamp0100(cur + (Number.isFinite(d) ? d : 0));
    (actor as any)[key] = next;
    return next;
}

export function addHonneur(actor: any, delta: unknown): number {
    return addVirtue(actor, 'honneur', delta);
}

export function addLiberte(actor: any, delta: unknown): number {
    return addVirtue(actor, 'liberte', delta);
}

export function addHumanite(actor: any, delta: unknown): number {
    return addVirtue(actor, 'humanite', delta);
}
