import { type Pos, type TacticalState, type UnitId, getUnitById } from '../tacticalBoard.js';

export function createSpellAnimator(deps: { getState: () => TacticalState; render: () => void }) {
    const { getState, render } = deps;

    const ensureOverlayRoot = (): HTMLElement => {
        const existing = document.getElementById('tacticalSpellOverlay') as HTMLElement | null;
        if (existing) return existing;
        const el = document.createElement('div');
        el.id = 'tacticalSpellOverlay';
        el.style.position = 'fixed';
        el.style.left = '0';
        el.style.top = '0';
        el.style.right = '0';
        el.style.bottom = '0';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '999999';
        // Avoid capturing layout; this is a pure overlay.
        el.style.contain = 'layout style paint';
        document.body.appendChild(el);
        return el;
    };

    const normalizeCandidates = (src: string): string[] => {
        const s = String(src ?? '');
        if (!s) return [];
        // Absolute or already-relative paths
        if (/^(https?:)?\/\//.test(s) || s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) {
            return [s];
        }
        // Most of the project uses './' for assets; also try without it.
        return [`./${s}`, s];
    };

    const setImgSrcWithFallback = (img: HTMLImageElement, src: string) => {
        const candidates = normalizeCandidates(src);
        let idx = 0;
        const tryNext = () => {
            const next = candidates[idx++];
            if (!next) return;
            img.src = next;
        };
        img.addEventListener('error', () => {
            // Retry next candidate on load failure
            if (idx < candidates.length) tryNext();
        });
        tryNext();
    };

    const preloadGif = (src: string): Promise<void> => {
        return new Promise((resolve) => {
            try {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => resolve();
                // Use same normalization/fallback as runtime placement
                const candidates = normalizeCandidates(src);
                let idx = 0;
                const tryNext = () => {
                    const next = candidates[idx++];
                    if (!next) return resolve();
                    img.src = next;
                };
                img.onerror = () => {
                    if (idx < candidates.length) tryNext();
                    else resolve();
                };
                tryNext();
            } catch {
                resolve();
            }
        });
    };

    const playSpellAt = async (
        at: Pos,
        imgSrc: string,
        options: { duration?: number; scale?: number; zIndex?: number; offsetX?: number; offsetY?: number } = {}
    ): Promise<void> => {
        const gridEl = document.getElementById('tacticalGrid') as HTMLElement | null;
        const boardPanel = document.querySelector('.tactical-board-panel') as HTMLElement | null;
        if (!gridEl) return;

        const tile = gridEl.querySelector(`.tile[data-x="${at.x}"][data-y="${at.y}"]`) as HTMLElement | null;
        if (!tile) return;

        const tileRect = tile.getBoundingClientRect();
        // Prefer attaching to the board panel (keeps DOM tidy), but fall back to a fixed overlay
        // to avoid stacking-context / z-index surprises with transforms.
        const attachToOverlay = !boardPanel;
        const panelRect = boardPanel ? boardPanel.getBoundingClientRect() : null;

        const offsetX = Math.floor(Number(options.offsetX ?? 0));
        const offsetY = Math.floor(Number(options.offsetY ?? 0));

        const cxOverlay = tileRect.left + tileRect.width / 2 + offsetX;
        const cyOverlay = tileRect.top + tileRect.height / 2 + offsetY;

        const cxPanel = panelRect ? cxOverlay - panelRect.left : cxOverlay;
        const cyPanel = panelRect ? cyOverlay - panelRect.top : cyOverlay;

        const img = document.createElement('img');
        img.className = 'tactical-spell-gif';
        setImgSrcWithFallback(img, imgSrc);
        img.alt = '';
        img.style.position = 'absolute';
        img.style.pointerEvents = 'none';
        img.style.transform = 'translate(-50%, -50%)';
        if (options.zIndex) img.style.zIndex = String(options.zIndex);

        // Optionally scale relative to tile size
        if (typeof options.scale === 'number') {
            img.style.width = `${Math.round(tileRect.width * options.scale)}px`;
            img.style.height = 'auto';
        }

        const root = attachToOverlay ? ensureOverlayRoot() : boardPanel;
        if (attachToOverlay) {
            img.style.left = `${cxOverlay}px`;
            img.style.top = `${cyOverlay}px`;
            // Ensure visible above everything
            if (!options.zIndex) img.style.zIndex = '999999';
        } else {
            img.style.left = `${cxPanel}px`;
            img.style.top = `${cyPanel}px`;
        }

        root.appendChild(img);

        const duration = Math.max(80, Math.floor(Number(options.duration ?? 1200)));

        await new Promise<void>((resolve) => setTimeout(resolve, duration));

        try {
            img.remove();
        } catch {
            // noop
        }
    };

    const playSpellOnUnit = async (
        unitId: UnitId,
        imgSrc: string,
        options: { duration?: number; scale?: number; zIndex?: number } = {}
    ): Promise<void> => {
        const state = getState();
        const unit = getUnitById(state, unitId);
        if (!unit) return;
        return playSpellAt(unit.pos, imgSrc, options);
    };

    return {
        playSpellAt,
        playSpellOnUnit,
        preloadGif,
    };
}
