export type MoveDir =
    | 'upRight'
    | 'downRight'
    | 'upLeft'
    | 'downLeft'
    | 'right'
    | 'left'
    | 'up'
    | 'down'
    | 'none';

export function getMoveDir(from: { x: number; y: number }, to: { x: number; y: number }): MoveDir {
    const dx = Math.sign((to?.x ?? 0) - (from?.x ?? 0));
    const dy = Math.sign((to?.y ?? 0) - (from?.y ?? 0));

    // The board is rendered isometrically in several places.
    // To match what the player *sees* (screen direction), we map grid delta -> screen delta:
    //   screenX ~ (dx - dy)
    //   screenY ~ (dx + dy)
    // Example: grid (0,-1) => screen (+1,-1) => visually up-right.
    const sx = dx - dy;
    const sy = dx + dy;

    if (sx > 0 && sy < 0) return 'upRight';
    if (sx > 0 && sy > 0) return 'downRight';
    if (sx < 0 && sy < 0) return 'upLeft';
    if (sx < 0 && sy > 0) return 'downLeft';
    if (sx > 0 && sy === 0) return 'right';
    if (sx < 0 && sy === 0) return 'left';
    if (sx === 0 && sy < 0) return 'up';
    if (sx === 0 && sy > 0) return 'down';
    return 'none';
}

type WalkAnimDef = {
    frames: string[];
    frameMs: number;
};

type CharacterSpriteDef = {
    idleRight: string;
    walk?: Partial<Record<MoveDir, WalkAnimDef>>;
};

const SPRITES: Record<string, CharacterSpriteDef> = {
    guerrier: {
        idleRight: './ImagesRPG/imagespersonnage/guerrier_static_droite.png',
        walk: {
            upRight: {
                frames: [
                    './ImagesRPG/imagespersonnage/guerrier_walk_droite1.png',
                    './ImagesRPG/imagespersonnage/guerrier_walk_droite2.png',
                ],
                frameMs: 250,
            },
        },
    },
};

export function getIdleSpriteSrc(characterClass: string | null | undefined): string | null {
    const cls = String(characterClass ?? '').toLowerCase();
    const def = SPRITES[cls];
    return def?.idleRight ?? null;
}

export function getWalkCycle(characterClass: string | null | undefined, dir: MoveDir): { cycle: string[]; frameMs: number } | null {
    const cls = String(characterClass ?? '').toLowerCase();
    const def = SPRITES[cls];
    const walk = def?.walk?.[dir];
    const idle = def?.idleRight ?? '';
    if (!walk || !walk.frames?.length) return null;

    const cycle = [...walk.frames, idle].filter(Boolean);
    if (!cycle.length) return null;
    return { cycle, frameMs: Math.max(60, Math.floor(walk.frameMs)) };
}

export function preloadImages(srcs: string[]): void {
    for (const src of srcs) {
        try {
            const img = new Image();
            img.decoding = 'async';
            img.loading = 'eager';
            img.src = src;
        } catch {
            // ignore
        }
    }
}

export function startWalkSpriteAnimation(opts: {
    container: HTMLElement;
    characterClass: string | null | undefined;
    dir: MoveDir;
}): { stop: () => void } {
    const cls = String(opts.characterClass ?? '').toLowerCase();
    const def = SPRITES[cls];
    const walk = def?.walk?.[opts.dir];

    const img = opts.container.querySelector('img.unit-sprite') as HTMLImageElement | null;
    if (!img || !walk || !walk.frames?.length) return { stop: () => void 0 };

    const idle = def?.idleRight ?? '';
    // Required loop while moving: walk1 -> walk2 -> static -> ...
    // (Start on walk1, NOT on static.)
    const cycle = [...walk.frames, idle].filter(Boolean);
    if (!cycle.length) return { stop: () => void 0 };

    preloadImages(idle ? [idle, ...cycle] : cycle);

    let idx = 0;
    const startSrc = img.getAttribute('src') ?? '';

    // While moving: walk1 -> walk2 -> static -> ...
    // On arrival (stop): keep static.
    img.src = cycle[0]!;

    const timer = window.setInterval(() => {
        idx = (idx + 1) % cycle.length;
        img.src = cycle[idx]!;
    }, Math.max(60, Math.floor(walk.frameMs)));

    const stop = () => {
        try {
            window.clearInterval(timer);
        } catch {
            // ignore
        }
        // Arrival pose: prefer configured idle sprite.
        if (idle) img.src = idle;
        else if (startSrc) img.src = startSrc;
    };

    return { stop };
}

export function getWalkAnimMinDurationMs(characterClass: string | null | undefined, dir: MoveDir): number {
    const cls = String(characterClass ?? '').toLowerCase();
    const def = SPRITES[cls];
    const walk = def?.walk?.[dir];
    if (!walk || !walk.frames?.length) return 0;
    const frameMs = Math.max(0, Math.floor(walk.frameMs ?? 0));
    // Ensure a full cycle is visible: walk1 + walk2 + static.
    return Math.max(0, 3 * frameMs);
}
