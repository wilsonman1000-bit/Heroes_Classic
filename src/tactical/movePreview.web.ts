import {
    getUnitAt,
    getUnitById,
    posKey,
    type Pos,
    type TacticalState,
    type TacticalUnit,
} from '../tacticalBoard.js';

export function bindMovePreview(grid: HTMLElement, params: {
    state: TacticalState;
    activeUnit: TacticalUnit;
    reachableSet: Set<string>;
    selectedSkillKey: string | null;
}): void {
    const { state, activeUnit, reachableSet, selectedSkillKey } = params;

    let lastHoverKey: string | null = null;
    let highlighted: HTMLElement[] = [];

    const clearHighlights = () => {
        for (const el of highlighted) {
            el.classList.remove('move-path');
            el.classList.remove('move-dest');
        }
        highlighted = [];
    };

    const findTileEl = (pos: Pos): HTMLElement | null =>
        grid.querySelector(`.tile[data-x="${pos.x}"][data-y="${pos.y}"]`) as HTMLElement | null;

    const inBounds = (p: Pos): boolean => p.x >= 0 && p.x < state.width && p.y >= 0 && p.y < state.height;

    const computeShortestPath = (from: Pos, to: Pos): Pos[] | null => {
        // BFS sur la grille, limité aux cases atteignables déjà calculées
        const startKey = posKey(from);
        const goalKey = posKey(to);
        const queue: Pos[] = [from];
        const parent = new Map<string, string>();
        const seen = new Set<string>([startKey]);

        while (queue.length) {
            const cur = queue.shift()!;
            const curKey = posKey(cur);
            if (curKey === goalKey) break;

            const neigh: Pos[] = [
                { x: cur.x + 1, y: cur.y },
                { x: cur.x - 1, y: cur.y },
                { x: cur.x, y: cur.y + 1 },
                { x: cur.x, y: cur.y - 1 },
            ];

            for (const n of neigh) {
                if (!inBounds(n)) continue;
                const nk = posKey(n);
                if (seen.has(nk)) continue;

                // On autorise start et les cases atteignables. Les autres sont ignorées.
                if (nk !== startKey && !reachableSet.has(nk)) continue;

                // Bloque le passage sur une case occupée (sauf départ)
                const occ = getUnitAt(state, n);
                if (occ && nk !== startKey) continue;

                seen.add(nk);
                parent.set(nk, curKey);
                queue.push(n);
            }
        }

        if (!seen.has(goalKey)) return null;

        // Reconstruit chemin (inclut from et to)
        const pathKeys: string[] = [];
        let k: string | undefined = goalKey;
        while (k) {
            pathKeys.push(k);
            if (k === startKey) break;
            k = parent.get(k);
        }
        pathKeys.reverse();

        const path: Pos[] = pathKeys.map((pk) => {
            const [xStr, yStr] = pk.split(',');
            return { x: Number(xStr), y: Number(yStr) };
        });
        return path;
    };

    grid.addEventListener('mousemove', (evt) => {
        const targetEl = (evt.target as HTMLElement | null)?.closest('.tile') as HTMLElement | null;
        if (!targetEl) return;

        const x = Number(targetEl.dataset.x);
        const y = Number(targetEl.dataset.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        const hoverPos: Pos = { x, y };
        const hk = posKey(hoverPos);
        if (hk === lastHoverKey) return;
        lastHoverKey = hk;

        clearHighlights();

        // Pas d'aide visuelle si on n'est pas sur un tour joueur, ou si une compétence est sélectionnée
        const activeNow = getUnitById(state, activeUnit.id);
        if (!activeNow || activeNow.pv <= 0 || activeNow.team !== 'allies') return;
        if (selectedSkillKey) return;

        // La destination doit être atteignable et libre
        if (!reachableSet.has(hk)) return;
        if (getUnitAt(state, hoverPos)) return;

        const path = computeShortestPath(activeNow.pos, hoverPos);
        if (!path || path.length < 2) return;

        // Sur-ligne le chemin (sans la case de départ)
        for (let i = 1; i < path.length; i++) {
            const p = path[i];
            if (!p) continue;
            const el = findTileEl(p);
            if (!el) continue;
            el.classList.add(i === path.length - 1 ? 'move-dest' : 'move-path');
            highlighted.push(el);
        }
    });

    grid.addEventListener('mouseleave', () => {
        lastHoverKey = null;
        clearHighlights();
    });
}
