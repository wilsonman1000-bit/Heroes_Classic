import { getPartyMembers } from '../party.web.js';
import { hero } from '../index.web.js';
import { Campfire, Consumable, Equipment, Item } from '../item.js';
import { CRAFT_RECIPES } from '../crafting/craftRecipes.js';
import { runForgeMinigame } from '../crafting/forgeMinigame.web.js';
import { runSewingMinigame } from '../crafting/sewingMinigame.web.js';
import { runOtherMinigame } from '../crafting/otherMinigame.web.js';
import { escapeHtml } from '../utils.web.js';
import { ensureTacticalStyles } from '../tactical/styles.web.js';
import { showTemporaryMessage } from '../uiNotifications.js';
import { showCompetences } from '../village/competences.web.js';
import { advanceGameDay, getGameDay, GAME_DAY_EVENT } from '../daySystem.web.js';
import { getIdleSpriteSrc } from '../characterSprites.web.js';

type HouseMovementOptions = {
	onBack: () => void;
};

const spriteForClass = (characterClass: unknown): string => {
	const cls = String(characterClass ?? '').toLowerCase();
	if (cls === 'mage') return './ImagesRPG/imagespersonnage/mage.png';
	if (cls === 'voleur') return './ImagesRPG/imagespersonnage/voleur.png';
	if (cls === 'guerrier') return getIdleSpriteSrc(cls) ?? './ImagesRPG/imagespersonnage/true_perso_guerrier.png';
	return './ImagesRPG/imagespersonnage/trueplayer.png';
};

export function showMaisonDeplacement(options: HouseMovementOptions): void {
	const app = document.getElementById('app');
	if (!app) return;

	// Reuse the existing 8x8 tactical plateau styles.
	ensureTacticalStyles();

	const party = getPartyMembers().slice(0, 3);
	const leader = party[0];
	const followerSprites = party.slice(1).map((p) => {
		const cls = String((p as any)?.characterClass ?? '').toLowerCase();
		const stun = Math.max(0, Math.floor(Number((p as any)?.stunTurns ?? 0)));
		const temp = String((p as any)?.__tempSprite ?? '');
		if (temp) return temp;
		if (cls === 'guerrier' && stun > 0) return './ImagesRPG/imagespersonnage/perso_guerrier_mort.png';
		return spriteForClass((p as any)?.characterClass);
	});
	const leaderSprite = (() => {
		const cls = String((leader as any)?.characterClass ?? '').toLowerCase();
		const stun = Math.max(0, Math.floor(Number((leader as any)?.stunTurns ?? 0)));
		const temp = String((leader as any)?.__tempSprite ?? '');
		if (temp) return temp;
		if (cls === 'guerrier' && stun > 0) return './ImagesRPG/imagespersonnage/perso_guerrier_mort.png';
		return spriteForClass((leader as any)?.characterClass);
	})();

	// Update rendering when temporary sprite changes
	const onTempSpriteChangedHouse = () => {
		render();
	};
	window.addEventListener('tempSpriteChanged', onTempSpriteChangedHouse);

	const onGameDayAdvance = (e: Event) => {
		const d = (e as CustomEvent)?.detail?.day ?? getGameDay(hero);
		try {
			const el = document.getElementById('houseDayVal');
			if (el) el.innerText = String(d);
		} catch {
			// noop
		}
	};
	window.addEventListener(GAME_DAY_EVENT, onGameDayAdvance);

	const GRID_SIZE = 8;
	const MOVE_STEP_MS = 220;

	// Ensure a high-priority background for the house grid so it shows even if other styles
	// set the tactical grid background.
	const HOUSE_GRID_STYLE_ID = 'house-grid-style';
	{
		const s = (document.getElementById(HOUSE_GRID_STYLE_ID) as HTMLStyleElement | null) ?? document.createElement('style');
		s.id = HOUSE_GRID_STYLE_ID;
		s.innerHTML = `
			.house-board-wrap { position: relative; display: inline-block; overflow: visible; --houseBgScale: 1.5; }
			/* Keep the plateau placement independent from the background; move the plateau down by 5% relative to current (6% -> 11%). */
			.house-board-wrap .house-grid-wrap { transform: translateY(11%); transform-origin: center; }
			.house-board-wrap .house-bg {
				position: absolute;
				left: 50%;
				/* Move ONLY the image up by 5% (plateau stays in .house-grid-wrap). */
				top: calc(50% - 5%);
				width: 100%;
				height: 100%;
				object-fit: contain;
				transform: translate(-50%, -50%) scale(var(--houseBgScale, 1));
				transform-origin: center;
				z-index: 0;
				filter: brightness(0.75);
				background: #000;
				pointer-events: none;
				clip-path: inset(0 3% 0 3%);
				-webkit-clip-path: inset(0 3% 0 3%);
			}
			.tactical-grid.house-grid {
				background-image: none !important;
				background: transparent !important;
				position: relative;
				z-index: 1;
			}
			.tactical-center.house-overflow { overflow: visible; }
		`;
		if (!s.parentNode) document.head.appendChild(s);
		// Additional house-specific styles: thinner / more transparent outlines and overlay lines
		const s2 = (document.getElementById('house-grid-style-override') as HTMLStyleElement | null) ?? document.createElement('style');
		s2.id = 'house-grid-style-override';
		s2.innerHTML = `
			/* Make tiles feel "integrated" into the terrain: each tile shows the corresponding cutout
			   of the background image instead of a visible grid overlay. */
			.tactical-grid.house-grid.iso .iso-grid-overlay { opacity: 0; pointer-events: none; }
			.tactical-grid.house-grid .tile { position: absolute; }
			.tactical-grid.house-grid .tile-bg {
				position: absolute;
				left: 50%;
				top: 50%;
				width: var(--isoTileW, 64px);
				height: var(--isoTileH, 32px);
				transform: translate(-50%, -50%);
				pointer-events: none;
				clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
				-webkit-clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
				background-image: var(--houseBgImage, none);
				background-size: var(--houseBgSize, auto);
				background-position: var(--houseBgPosX, 0px) var(--houseBgPosY, 0px);
				background-repeat: no-repeat;
				z-index: 0;
			}
			.tactical-grid.house-grid .tile > :not(.tile-bg) { position: relative; z-index: 1; }
			.tactical-grid.house-grid .tile:hover .tile-bg { filter: brightness(1.07) saturate(1.05); }
			.tactical-grid.house-grid .tile.interactive .tile-bg { box-shadow: inset 0 0 0 1px rgba(255, 215, 0, 0.16); }
			.tactical-grid.house-grid .tile.blocked .tile-bg { filter: saturate(0.92) brightness(0.98); }
		`;
		if (!s2.parentNode) document.head.appendChild(s2);

		// House-specific adjustments: reduce character sprites size by 35% for this view.
		const s3 = (document.getElementById('house-grid-sprite-override') as HTMLStyleElement | null) ?? document.createElement('style');
		s3.id = 'house-grid-sprite-override';
		s3.innerHTML = `
			.tactical-grid.house-grid .unit-sprite { width: 129% !important; height: 145% !important; }
			.tactical-grid.house-grid .unit-sprite-wrap { align-items: center; justify-content: center; }
		`;
		if (!s3.parentNode) document.head.appendChild(s3);
		// Forge highlight style (diamond-shaped, matches iso tile)
		const s4 = (document.getElementById('house-grid-forge-highlight') as HTMLStyleElement | null) ?? document.createElement('style');
		s4.id = 'house-grid-forge-highlight';
		s4.innerHTML = `
			.tactical-grid.house-grid .tile.forge { position: relative; }
			.tactical-grid.house-grid .tile.forge::before {
				content: '';
				position: absolute;
				left: 50%;
				top: 50%;
				width: var(--isoTileW, 64px);
				height: var(--isoTileH, 32px);
				transform: translate(-50%, -50%);
				pointer-events: none;
				clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
				-webkit-clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
				border: 1px solid rgba(255,215,0,0.6);
				background: transparent;
				box-shadow: 0 6px 14px rgba(0,0,0,0.18);
				z-index: 2;
			}
			.tactical-grid.house-grid .tile.forge::after {
				content: '';
				position: absolute;
				left: 50%;
				top: 50%;
				width: calc(var(--isoTileW, 64px) - 6px);
				height: calc(var(--isoTileH, 32px) - 6px);
				transform: translate(-50%, -50%);
				pointer-events: none;
				clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
				-webkit-clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
				background: linear-gradient(180deg, rgba(255,215,0,0.12), rgba(255,215,0,0.03));
				z-index: 1;
			}
		`;
		if (!s4.parentNode) document.head.appendChild(s4);
	}

	let isoResizeBound = false;

	const layoutIsoGrid = () => {
		const gridEl = document.getElementById('exploreGrid') as HTMLElement | null;
		if (!gridEl) return;
		if (!gridEl.classList.contains('iso')) return;

		const cols = GRID_SIZE;
		const rows = GRID_SIZE;

		// Base sizing inspired by the previous CSS grid: padding=10px and gap=6px.
		const gridW = Math.max(0, gridEl.clientWidth);
		const gridH = Math.max(0, gridEl.clientHeight);
		// If the browser hasn't laid out the grid yet, measurements can be 0.
		if (gridW < 80 || gridH < 80) return;
		const pad = 10;
		const gap = 6;

		// Base = previous square grid sizing, then scale up as requested.
		const baseTileW = Math.max(26, (gridW - pad * 2 - gap * (cols - 1)) / cols);

		// Match the combat plateau isometric sizing.
		// Reduce ONLY the plateau by 8%, then shrink it an additional 10% (relative), and reduced by 20%.
		// Now increase the final plateau size by +10% (relative), and again by +10%.
		// Final factor = 1.5 * 0.92 * 0.9 * 0.8 * 1.10 * 1.10
		const SCALE = 1.5 * 0.92 * 0.9 * 0.8 * 1.10 * 1.10; // ~1.202256
		const tileW = Math.max(28, Math.floor(baseTileW * SCALE));
		const tileH = Math.max(16, Math.floor(tileW * 0.68));

		const halfW = tileW / 2;
		const halfH = tileH / 2;

		// Add a real isometric gap so tiles don't visually cover each other.
		const isoGapX = Math.max(0, Math.floor(gap * 1.0));
		const isoGapY = Math.max(0, Math.floor(gap * 0.65));
		const stepW = halfW + isoGapX;
		const stepH = halfH + isoGapY;

		// Cache tile size in CSS vars (used by .tactical-grid.iso styles)
		gridEl.style.setProperty('--isoTileW', `${tileW}px`);
		gridEl.style.setProperty('--isoTileH', `${tileH}px`);

		// Prepare background cutout alignment (LOCKED): compute in local coordinates.
		// User request: enlarge house background by +50%.
		const BG_SCALE = 1.5;
		const wrap = gridEl.closest('.house-board-wrap') as HTMLElement | null;
		if (wrap) wrap.style.setProperty('--houseBgScale', String(BG_SCALE));
		// User request: move house background up by 5% total (moved down 10% from previous 15%).
		const BG_SHIFT_Y = -gridH * 0.05;
		// Note: the <img> shift is applied in CSS, but we still need BG_SHIFT_Y here
		// so the integrated tile cutouts match the shifted image.
		const bgEl = wrap?.querySelector('img.house-bg') as HTMLImageElement | null;
		const bgSrc = bgEl?.getAttribute('src') ?? '';

		let bgDrawW = 0;
		let bgDrawH = 0;
		let bgOffsetX = 0;
		let bgOffsetY = 0;
		const natW = Number(bgEl?.naturalWidth ?? 0);
		const natH = Number(bgEl?.naturalHeight ?? 0);
		if (bgEl && natW > 0 && natH > 0 && gridW > 10 && gridH > 10) {
			const fitScale = Math.min(gridW / natW, gridH / natH);
			const scale = fitScale * BG_SCALE;
			bgDrawW = natW * scale;
			bgDrawH = natH * scale;
			bgOffsetX = (gridW - bgDrawW) / 2;
			bgOffsetY = (gridH - bgDrawH) / 2 + BG_SHIFT_Y;
			gridEl.style.setProperty('--houseBgImage', bgSrc ? `url("${bgSrc}")` : 'none');
			gridEl.style.setProperty('--houseBgSize', `${Math.round(bgDrawW)}px ${Math.round(bgDrawH)}px`);
		} else {
			gridEl.style.setProperty('--houseBgImage', bgSrc ? `url("${bgSrc}")` : 'none');
			gridEl.style.setProperty('--houseBgSize', 'auto');
		}

		// Center the diamond map inside the square board.
		const minX = -(rows - 1) * stepW;
		const maxX = (cols - 1) * stepW;
		const minY = 0;
		const maxY = (cols + rows - 2) * stepH;
		const fullW = (maxX - minX) + tileW;
		const fullH = (maxY - minY) + tileH;
		const offsetX = (gridW - fullW) / 2 + tileW / 2 - minX;
		const offsetY = (gridH - fullH) / 2 + tileH / 2 - minY;

		const tiles = gridEl.querySelectorAll<HTMLElement>('.tile[data-x][data-y]');

		// Ensure the always-visible isometric grid overlay exists.
		let overlay = gridEl.querySelector('svg.iso-grid-overlay') as SVGSVGElement | null;
		if (!overlay) {
			overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
			overlay.classList.add('iso-grid-overlay');
			// Put the overlay before tiles (behind units).
			gridEl.insertBefore(overlay, gridEl.firstChild);
		}
		overlay.setAttribute('viewBox', `0 0 ${gridW} ${gridH}`);
		overlay.setAttribute('preserveAspectRatio', 'none');

		const hoverKey = String((gridEl as any).dataset?.isoHoverKey ?? '');

		const polygonFor = (cx: number, cy: number): string => {
			const p1 = `${cx},${cy - halfH}`;
			const p2 = `${cx + halfW},${cy}`;
			const p3 = `${cx},${cy + halfH}`;
			const p4 = `${cx - halfW},${cy}`;
			return `${p1} ${p2} ${p3} ${p4}`;
		};

		const polyParts: string[] = [];
		for (const el of tiles) {
			const x = Number(el.dataset.x);
			const y = Number(el.dataset.y);
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			const cx = offsetX + (x - y) * stepW;
			const cy = offsetY + (x + y) * stepH;

			el.style.left = `${cx}px`;
			el.style.top = `${cy}px`;
			// Stable painter's ordering (back to front)
			el.style.zIndex = String(Math.floor((x + y) * 100 + x));

			// Per-tile background cutout positioning.
			if (bgDrawW > 10 && bgDrawH > 10) {
				const desiredBgPosX = bgOffsetX - cx + tileW / 2;
				const desiredBgPosY = bgOffsetY - cy + tileH / 2;
				el.style.setProperty('--houseBgPosX', `${Math.round(desiredBgPosX)}px`);
				el.style.setProperty('--houseBgPosY', `${Math.round(desiredBgPosY)}px`);
			} else {
				el.style.setProperty('--houseBgPosX', '0px');
				el.style.setProperty('--houseBgPosY', '0px');
			}

			const tileKey = `${x},${y}`;
			const classes: string[] = ['iso-tile'];
			if (tileKey === hoverKey) classes.push('hovered');

			const pts = polygonFor(cx, cy);
			polyParts.push(`<polygon class="${classes.join(' ')}" points="${pts}"></polygon>`);
		}

		overlay.innerHTML = polyParts.join('');
	};

	const scheduleIsoLayout = () => {
		// Do 2 passes: after paint + a short delay (fonts/images/styles may affect sizing).
		requestAnimationFrame(() => {
			layoutIsoGrid();
			setTimeout(() => layoutIsoGrid(), 80);
		});

		// If the background loads after first layout, realign once it's ready.
		const gridEl = document.getElementById('exploreGrid') as HTMLElement | null;
		const wrap = gridEl?.closest('.house-board-wrap') as HTMLElement | null;
		const bgEl = wrap?.querySelector('img.house-bg') as HTMLImageElement | null;
		if (bgEl && !bgEl.complete) {
			bgEl.addEventListener(
				'load',
				() => {
					requestAnimationFrame(() => {
						layoutIsoGrid();
						setTimeout(() => layoutIsoGrid(), 80);
					});
				},
				{ once: true }
			);
		}
	};

	// Position on the 8x8 plateau.
	let pos = { x: 3, y: 6 };
	let moveQueue: Array<{ x: number; y: number }> = [];
	let moveTimer: number | null = null;
	let fabricationModalEl: HTMLElement | null = null;
	let inventoryModalEl: HTMLElement | null = null;
	let questJournalModalEl: HTMLElement | null = null;

	const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.floor(n)));

	// Interactive tiles
	// A4 = column A (x=0), row 4 (y=3)
	// Place the forge at x=0,y=4 as requested (A5 in user-facing coordinates).
	const FORGE_KEY = '0,4';
	// Chest: place at x=6,y=0 per request
	const CHEST_KEY = '6,0';
	// Grimoire (skills) placed at x=6,y=6 per request
	const GRIMOIRE_KEY = '6,6';
	// Journal de quêtes (requested): x=0, y=6
	const QUEST_JOURNAL_KEY = '0,6';
	// Sommeil / passer au lendemain: x=1, y=1
	const SLEEP_KEY = '1,1';
	// These tiles are treated as occupied for movement.
	const blockedTiles = new Set<string>([FORGE_KEY, CHEST_KEY, GRIMOIRE_KEY, QUEST_JOURNAL_KEY, SLEEP_KEY]);
	const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
	const isBlocked = (p: { x: number; y: number }) => blockedTiles.has(key(p));
	const isForge = (p: { x: number; y: number }) => key(p) === FORGE_KEY;
	const isChest = (p: { x: number; y: number }) => key(p) === CHEST_KEY;
	const isGrimoire = (p: { x: number; y: number }) => key(p) === GRIMOIRE_KEY;
	const isQuestJournal = (p: { x: number; y: number }) => key(p) === QUEST_JOURNAL_KEY;
	const isSleep = (p: { x: number; y: number }) => key(p) === SLEEP_KEY;

	// BFS pathfinder that avoids blocked tiles (the forge tile is enterable)
	const findPathBFS = (from: { x: number; y: number }, to: { x: number; y: number }) => {
		if (isBlocked(to) && !isForge(to)) return [];
		const q: Array<{ x: number; y: number }> = [from];
		const visited = new Set<string>([key(from)]);
		const cameFrom = new Map<string, string | null>();
		cameFrom.set(key(from), null);
		const neighbors = (p: { x: number; y: number }) => {
			const list: Array<{ x: number; y: number }> = [];
			const deltas = [
				{ x: 1, y: 0 },
				{ x: -1, y: 0 },
				{ x: 0, y: 1 },
				{ x: 0, y: -1 },
			];
			for (const d of deltas) {
				const nx = p.x + d.x;
				const ny = p.y + d.y;
				if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
				// Allow stepping onto the destination even if it's marked blocked (e.g., the forge)
				if (isBlocked({ x: nx, y: ny }) && !(nx === to.x && ny === to.y && isForge(to))) continue;
				list.push({ x: nx, y: ny });
			}
			return list;
		};

		while (q.length) {
			const cur = q.shift()!;
			if (cur.x === to.x && cur.y === to.y) break;
			for (const n of neighbors(cur)) {
				const k = key(n);
				if (visited.has(k)) continue;
				visited.add(k);
				cameFrom.set(k, key(cur));
				q.push(n);
			}
		}
		const destKey = key(to);
		if (!cameFrom.has(destKey)) return [];
		// Reconstruct path (excluding start)
		const path: Array<{ x: number; y: number }> = [];
		let curKey: string | null = destKey;
		while (curKey && curKey !== key(from)) {
			const [sx, sy] = curKey.split(',');
			path.unshift({ x: Number(sx), y: Number(sy) });
			curKey = cameFrom.get(curKey) ?? null;
		}
		return path;
	};

	const stopMovement = () => {
		if (moveTimer != null) {
			window.clearInterval(moveTimer);
			moveTimer = null;
		}
		moveQueue = [];
	};

	const closeFabricationModal = () => {
		fabricationModalEl?.remove();
		fabricationModalEl = null;
	};

	const closeInventoryModal = () => {
		inventoryModalEl?.remove();
		inventoryModalEl = null;
	};

	type QuestTab = 'active' | 'completed';

	const closeQuestJournalModal = () => {
		questJournalModalEl?.remove();
		questJournalModalEl = null;
	};

	const openQuestJournalModal = () => {
		if (questJournalModalEl) return;

		questJournalModalEl = document.createElement('div');
		questJournalModalEl.id = 'questJournalModalHouse';
		questJournalModalEl.style.cssText = [
			'position:fixed',
			'inset:0',
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'background:rgba(0,0,0,0.65)',
			'z-index:10000',
			'padding:18px',
		].join(';');

		const panel = document.createElement('div');
		panel.style.cssText = [
			'width:min(860px, 96vw)',
			'max-height:min(84vh, 820px)',
			'overflow:auto',
			'background:#111',
			'border:1px solid rgba(255,255,255,0.10)',
			'border-radius:12px',
			'padding:14px',
			'color:#fff',
		].join(';');

		let tab: QuestTab = 'active';

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

		const renderModal = () => {
			const qm = (window as any).game?.questManager;
			const items: Array<{ def: any; progress: any }> = typeof qm?.getAll === 'function' ? qm.getAll() : [];

			const list = items.filter(({ progress }) => {
				const status = String(progress?.status ?? '');
				if (tab === 'completed') return status === 'claimed';
				return status === 'active' || status === 'completed';
			});

			panel.innerHTML = `
				<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;">
					<div style="font-weight:900;font-size:18px;">Quêtes</div>
					<button class="btn" id="questJournalModalCloseBtn">Fermer</button>
				</div>
				<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:10px;">
					<button class="btn" id="questJournalTabActiveBtn" style="min-width:220px;${tab === 'active' ? 'border:2px solid #ffd700;' : ''}">Quêtes en cours</button>
					<button class="btn" id="questJournalTabCompletedBtn" style="min-width:220px;${tab === 'completed' ? 'border:2px solid #ffd700;' : ''}">Quêtes terminées</button>
				</div>
				${!qm ? '<div style="margin-top:12px;background:rgba(0,0,0,0.55);padding:14px;border-radius:10px;">Quêtes indisponibles (questManager manquant).</div>' : ''}
				<div style="display:flex;flex-direction:column;gap:14px;margin-top:14px;text-align:left;">
					${list
						.map(({ def, progress }) => {
							const status = renderStatus(progress);
							return `
								<div style="background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.08);padding:14px;border-radius:12px;">
									<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
										<div>
											<div style="font-size:1.1em;font-weight:800;">${escapeHtml(String(def?.name ?? def?.id ?? 'Quête'))}</div>
											<div style="color:#ddd;margin-top:4px;">${escapeHtml(String(def?.description ?? ''))}</div>
										</div>
										<div style="text-align:right;min-width:120px;">
											<div style="font-weight:800;color:#ffd700;">${escapeHtml(status)}</div>
										</div>
									</div>
									${renderProgress(def, progress)}
								</div>
							`;
						})
						.join('')}
					${list.length === 0 ? '<div style="background:rgba(0,0,0,0.55);padding:14px;border-radius:10px;">Aucune quête.</div>' : ''}
				</div>
			`;

			(panel.querySelector('#questJournalModalCloseBtn') as HTMLButtonElement | null)?.addEventListener('click', () => {
				closeQuestJournalModal();
			});
			(panel.querySelector('#questJournalTabActiveBtn') as HTMLButtonElement | null)?.addEventListener('click', () => {
				tab = 'active';
				renderModal();
			});
			(panel.querySelector('#questJournalTabCompletedBtn') as HTMLButtonElement | null)?.addEventListener('click', () => {
				tab = 'completed';
				renderModal();
			});
		};

		renderModal();
		questJournalModalEl.appendChild(panel);
		questJournalModalEl.addEventListener('click', (e) => {
			if (e.target === questJournalModalEl) closeQuestJournalModal();
		});
		document.body.appendChild(questJournalModalEl);
	};

	const openFabricationModal = () => {
		if (fabricationModalEl) return;

		fabricationModalEl = document.createElement('div');
		fabricationModalEl.id = 'fabricationModalHouse';
		fabricationModalEl.style.cssText = [
			'position:fixed',
			'inset:0',
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'background:rgba(0,0,0,0.65)',
			'z-index:10000',
			'padding:18px',
		].join(';');

		const panel = document.createElement('div');
		panel.style.cssText = [
			'width:min(720px, 96vw)',
			'max-height: min(84vh, 760px)',
			'overflow:auto',
			'background:#111',
			'border:1px solid rgba(255,255,255,0.10)',
			'border-radius:12px',
			'padding:14px',
			'color:#fff',
		].join(';');

		// Crafting state (persist across renders inside the modal)
		let craftingItemId: string | null = null;
		let craftingTimer: number | null = null;

		const renderModal = () => {
			const haveWood = Math.max(0, Math.floor((hero as any).wood ?? 0));
			const haveHerb = Math.max(0, Math.floor((hero as any).herb ?? 0));
			const haveCuir = Math.max(0, Math.floor((hero as any).cuir ?? 0));
			const haveFer = Math.max(0, Math.floor((hero as any).fer ?? 0));
			const partyMembers = getPartyMembers();

			const items = CRAFT_RECIPES;

			panel.innerHTML = `
				<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;">
					<div style="font-weight:900;font-size:18px;">Fabrication</div>
					<button class="btn" id="fabricationModalCloseBtn">Fermer</button>
				</div>
				<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
					<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Bois: <b>${haveWood}</b></div>
					<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Herbes: <b>${haveHerb}</b></div>
					<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Cuir: <b>${haveCuir}</b></div>
					<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Fer: <b>${haveFer}</b></div>
					<div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
						<label style="color:#ddd;">Filtre:</label>
						<select id="fabricationCategorySelect" style="margin-right:8px;">
							<option value="all">Tous</option>
							<option value="equipment">Équipement</option>
							<option value="consumable">Consommables</option>
							<option value="other">Autres</option>
						</select>
						<label style="color:#ddd;margin-left:6px"><input type="checkbox" id="fabricationAffordableChk"/> Fabricable</label>
						<label style="color:#ddd;margin-left:8px">Recevoir:</label>
						<select id="fabricationRecipientSelect">
							${partyMembers.map((p, idx) => `<option value="${idx}">${escapeHtml(p.name)}</option>`).join('')}
						</select>
					</div>
				</div>
				<div id="fabricationList" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
				</div>
			`;

			const closeBtn = panel.querySelector('#fabricationModalCloseBtn') as HTMLButtonElement | null;
			closeBtn?.addEventListener('click', () => { 
				if (typeof craftingTimer !== 'undefined' && craftingTimer != null) { window.clearTimeout(craftingTimer); }
				closeFabricationModal();
			});

			const categorySelect = panel.querySelector('#fabricationCategorySelect') as HTMLSelectElement | null;
			const affordableChk = panel.querySelector('#fabricationAffordableChk') as HTMLInputElement | null;
			const listEl = panel.querySelector('#fabricationList') as HTMLElement | null;

			const renderList = () => {
				if (!listEl) return;
				const sel = (categorySelect?.value as any) || 'all';
				const onlyAffordable = !!(affordableChk?.checked);
				const haveW = Math.max(0, Math.floor((hero as any).wood ?? 0));
				const haveH = Math.max(0, Math.floor((hero as any).herb ?? 0));
				const haveC = Math.max(0, Math.floor((hero as any).cuir ?? 0));
				const haveF = Math.max(0, Math.floor((hero as any).fer ?? 0));

				const filtered = items.filter(it => (sel === 'all' || it.category === sel) && (!onlyAffordable || (((it.cost.wood ?? 0) <= haveW) && ((it.cost.herb ?? 0) <= haveH) && ((it.cost.cuir ?? 0) <= haveC) && ((it.cost.fer ?? 0) <= haveF))));


				if (sel === 'all') {
					// Group by category
					const groups: Record<string, any[]> = {};
						for (const it of filtered) { let arr = groups[it.category]; if (!arr) { arr = []; groups[it.category] = arr; } arr.push(it); }
					listEl.innerHTML = Object.keys(groups).map(cat => `
						<div>
							<div style="font-weight:800;color:#ffd700;margin-bottom:6px;">${escapeHtml(cat === 'equipment' ? 'Équipement' : cat === 'consumable' ? 'Consommables' : 'Autres')}</div>
							${(groups[cat] || []).map(it => {
								const affordable = ((it.cost.wood ?? 0) <= haveW) && ((it.cost.herb ?? 0) <= haveH) && ((it.cost.cuir ?? 0) <= haveC) && ((it.cost.fer ?? 0) <= haveF);
								const costStr = `${it.cost.wood ? `${it.cost.wood} bois ` : ''}${it.cost.herb ? `${it.cost.herb} herbes ` : ''}${it.cost.cuir ? `${it.cost.cuir} cuir ` : ''}${it.cost.fer ? `${it.cost.fer} fer ` : ''}`.trim();
								const isPotionSoin = it.id === 'potion_small';
								const title = isPotionSoin ? 'Soigne 50 PV' : '';
								const labelHtml = isPotionSoin
									? `<img src="ImagesRPG/imagesobjets/potionsoin.png" alt="Potion de soin" title="${escapeHtml(title)}" style="width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.35));" />`
									: `<div style="font-weight:800;">${escapeHtml(it.label)}</div>`;
								return `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.04);padding:10px;border-radius:10px;margin-bottom:6px;gap:8px;">
									<div style="flex:1;display:flex;gap:10px;align-items:flex-start;"><div style="width:40px;display:flex;justify-content:center;">${labelHtml}</div><div><div style="color:#bbb;font-size:12px;margin-top:3px;">Coût: ${escapeHtml(costStr || '—')}</div></div></div><button class="btn" data-house-craft-id="${escapeHtml(it.id)}" ${!affordable ? 'disabled' : ''}>Fabriquer</button></div>`;
							}).join('')}
						</div>
					`).join('');
				} else {
					listEl.innerHTML = filtered.map(it => {
						const affordable = ((it.cost.wood ?? 0) <= haveW) && ((it.cost.herb ?? 0) <= haveH) && ((it.cost.cuir ?? 0) <= haveC) && ((it.cost.fer ?? 0) <= haveF);
						const costStr = `${it.cost.wood ? `${it.cost.wood} bois ` : ''}${it.cost.herb ? `${it.cost.herb} herbes ` : ''}${it.cost.cuir ? `${it.cost.cuir} cuir ` : ''}${it.cost.fer ? `${it.cost.fer} fer ` : ''}`.trim();
						const isPotionSoin = it.id === 'potion_small';
						const title = isPotionSoin ? 'Soigne 50 PV' : '';
						const labelHtml = isPotionSoin
							? `<img src="ImagesRPG/imagesobjets/potionsoin.png" alt="Potion de soin" title="${escapeHtml(title)}" style="width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.35));" />`
							: `<div style="font-weight:800;">${escapeHtml(it.label)}</div>`;
						return `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.04);padding:10px;border-radius:10px;margin-bottom:6px;gap:8px;">
							<div style="flex:1;display:flex;gap:10px;align-items:flex-start;"><div style="width:40px;display:flex;justify-content:center;">${labelHtml}</div><div><div style="color:#bbb;font-size:12px;margin-top:3px;">Coût: ${escapeHtml(costStr || '—')}</div></div></div><button class="btn" data-house-craft-id="${escapeHtml(it.id)}" ${!affordable ? 'disabled' : ''}>Fabriquer</button></div>`;
					}).join('');
				}

				// Wire craft buttons inside list
				(listEl.querySelectorAll('[data-house-craft-id]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
					btn.addEventListener('click', async () => {
						const id = btn.getAttribute('data-house-craft-id') ?? '';
						const entry = items.find((i) => i.id === id);
						if (!entry) return;

						// If already crafting, ignore
						if (craftingItemId) { showTemporaryMessage('Fabrication en cours...'); return; }

						const haveW2 = Math.max(0, Math.floor((hero as any).wood ?? 0));
						const haveH2 = Math.max(0, Math.floor((hero as any).herb ?? 0));
								const haveC2 = Math.max(0, Math.floor((hero as any).cuir ?? 0));
								const haveF2 = Math.max(0, Math.floor((hero as any).fer ?? 0));
								if ((entry.cost.wood ?? 0) > haveW2 || (entry.cost.herb ?? 0) > haveH2 || (entry.cost.cuir ?? 0) > haveC2 || (entry.cost.fer ?? 0) > haveF2) { showTemporaryMessage('Ressources insuffisantes.'); return; }
						craftingItemId = entry.id;
						// Close the modal while crafting happens (per spec)
						closeFabricationModal();

						const isForgeRecipe = entry.minigame === 'forge';
						const isSewingRecipe = entry.minigame === 'sewing';
						const isMemoryRecipe = entry.minigame === 'memory';
						const usesMinigame = Boolean(entry.minigame);

						const addCreatedToRecipient = (created: any, score: number, chosenQuality?: number) => {
							(created as any).fabricationScore = score;
							if (typeof chosenQuality === 'number') (created as any).fabricationQuality = chosenQuality;
							const select = panel.querySelector('#fabricationRecipientSelect') as HTMLSelectElement | null;
							const recipientIdx = select ? Number(select.value) : 0;
							const recipient = partyMembers[Math.max(0, Math.min(partyMembers.length - 1, recipientIdx))] ?? hero;
							recipient.addItem(created);
						};

						if (!usesMinigame) {
							// Direct craft (no minigame): consume materials and create item.
							(hero as any).wood = Math.max(0, haveW2 - (entry.cost.wood ?? 0));
							(hero as any).herb = Math.max(0, haveH2 - (entry.cost.herb ?? 0));
							const created = entry.create();
							addCreatedToRecipient(created, 14);
							try { showTemporaryMessage(`Création effectuée: ${created.name}`, 3200); } catch (e) { /* noop */ }
							craftingItemId = null;
							try { openFabricationModal(); } catch (e) { /* noop */ }
							return;
						}

						if (isMemoryRecipe) {
							const otherResult = await runOtherMinigame({
								recipeLabel: entry.label,
								onCancel: () => {
									craftingItemId = null;
								},
								onCraft: (r) => {
									// 1 paire trouvée => 1 objet créé.
									// IMPORTANT (maison/crafting): le coût est payé UNE SEULE FOIS au début,
									// quel que soit le nombre d'objets créés (paires trouvées).
									const want = Math.max(0, Math.floor(Number(r.pairsFound ?? 0)));
									let craftedCount = 0;
									let lastName = '';

									const curW = Math.max(0, Math.floor((hero as any).wood ?? 0));
									const curH = Math.max(0, Math.floor((hero as any).herb ?? 0));
									const curC = Math.max(0, Math.floor((hero as any).cuir ?? 0));
									const curF = Math.max(0, Math.floor((hero as any).fer ?? 0));
									const costW = Math.max(0, Math.floor(entry.cost.wood ?? 0));
									const costH = Math.max(0, Math.floor(entry.cost.herb ?? 0));
									const costC = Math.max(0, Math.floor(entry.cost.cuir ?? 0));
									const costF = Math.max(0, Math.floor(entry.cost.fer ?? 0));

									const canAffordOnce = costW <= curW && costH <= curH && costC <= curC && costF <= curF;

									if (want > 0 && canAffordOnce) {
										// Consomme le coût une seule fois
										(hero as any).wood = Math.max(0, curW - costW);
										(hero as any).herb = Math.max(0, curH - costH);
										(hero as any).cuir = Math.max(0, curC - costC);
										(hero as any).fer = Math.max(0, curF - costF);

										// Si l'objet est stackable/quantifiable, on crée un stack.
										const probe = entry.create();
										const isStackable = Boolean((probe as any)?.stackable);
										const isConsumable = entry.category === 'consumable';
										if (isStackable || isConsumable) {
											(probe as any).quantity = want;
											addCreatedToRecipient(probe, Math.max(0, Math.floor(Number(r.points ?? r.pairsFound ?? 0))));
											lastName = String((probe as any)?.name ?? entry.label);
											craftedCount = want;
										} else {
											// Sinon, on crée plusieurs objets (sans re-consommer les ressources).
											addCreatedToRecipient(probe, Math.max(0, Math.floor(Number(r.points ?? r.pairsFound ?? 0))));
											lastName = String((probe as any)?.name ?? entry.label);
											craftedCount = 1;
											for (let k = 1; k < want; k++) {
												const created = entry.create();
												addCreatedToRecipient(created, Math.max(0, Math.floor(Number(r.points ?? r.pairsFound ?? 0))));
												craftedCount++;
											}
										}
									}

									if (craftedCount > 0) {
										try { showTemporaryMessage(`Création effectuée: ${lastName} x${craftedCount} (paires: ${r.pairsFound})`, 4200); } catch (e) { /* noop */ }
									} else {
										try { showTemporaryMessage('Aucune paire trouvée: aucun objet créé.', 3200); } catch (e) { /* noop */ }
									}

									craftingItemId = null;
									return { itemName: String(lastName || (entry as any)?.label || 'Objet'), craftedCount };
								},
							});

							if (!otherResult) {
								try { openFabricationModal(); } catch (e) { /* noop */ }
								return;
							}

							try { openFabricationModal(); } catch (e) { /* noop */ }
							return;
						}

						if (isForgeRecipe) {

						const minigameResult = await runForgeMinigame({
							recipeLabel: entry.label,
							onCancel: () => {
								craftingItemId = null;
							},
							onCraft: async (r, probs, chosenQuality) => {
								// Deduct resources and create item only after the minigame.
								(hero as any).wood = Math.max(0, haveW2 - (entry.cost.wood ?? 0));
								(hero as any).herb = Math.max(0, haveH2 - (entry.cost.herb ?? 0));
								const created = entry.create();
								addCreatedToRecipient(created, r.totalScore, chosenQuality);
					try { showTemporaryMessage(`Création effectuée: ${created.name} (score: ${r.totalScore.toFixed(2)}, qualité: ${chosenQuality})`, 4200); } catch (e) { /* noop */ }
								craftingItemId = null;
								return { itemName: String((created as any)?.name ?? 'Objet') };
							},
						});

							// If cancelled, just reopen the fabrication modal.
							if (!minigameResult) {
								try { openFabricationModal(); } catch (e) { /* noop */ }
								return;
							}

							// Return to fabrication modal after the result screen is closed.
							try { openFabricationModal(); } catch (e) { /* noop */ }
							return;
						}

						// Sewing recipe
						const sewingResult = await runSewingMinigame({
							recipeLabel: entry.label,
							onCancel: () => {
								craftingItemId = null;
							},
							onPartialFail: () => {
								(hero as any).wood = Math.max(0, haveW2 - (entry.cost.wood ?? 0));
								(hero as any).herb = Math.max(0, haveH2 - (entry.cost.herb ?? 0));
								try { showTemporaryMessage('Découpe ratée: matériaux perdus.', 3600); } catch (e) { /* noop */ }
								craftingItemId = null;
							},
							onCraft: async (r, probs, chosenQuality) => {
								(hero as any).wood = Math.max(0, haveW2 - (entry.cost.wood ?? 0));
								(hero as any).herb = Math.max(0, haveH2 - (entry.cost.herb ?? 0));
								const created = entry.create();
								addCreatedToRecipient(created, r.totalScore, chosenQuality);
								try { showTemporaryMessage(`Création effectuée: ${created.name} (score: ${r.totalScore.toFixed(2)}, qualité: ${chosenQuality})`, 4200); } catch (e) { /* noop */ }
								craftingItemId = null;
								return { itemName: String((created as any)?.name ?? 'Objet') };
							},
						});

						if (!sewingResult) {
							try { openFabricationModal(); } catch (e) { /* noop */ }
							return;
						}

						try { openFabricationModal(); } catch (e) { /* noop */ }
						return;

					});
				});
			};

			renderList();
			categorySelect?.addEventListener('change', () => renderList());
			affordableChk?.addEventListener('change', () => renderList());
		};

		renderModal();
		fabricationModalEl.appendChild(panel);
		fabricationModalEl.addEventListener('click', (e) => {
			if (e.target === fabricationModalEl) {
				if (craftingTimer) { window.clearTimeout(craftingTimer); craftingTimer = null; }
				closeFabricationModal();
			}
		});
		document.body.appendChild(fabricationModalEl);
	};

	const openInventoryModal = () => {
		if (inventoryModalEl) return;

		inventoryModalEl = document.createElement('div');
		inventoryModalEl.id = 'inventoryModalHouse';
		inventoryModalEl.style.cssText = [
			'position:fixed',
			'inset:0',
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'background:rgba(0,0,0,0.65)',
			'z-index:10000',
			'padding:18px',
		].join(';');

		const panel = document.createElement('div');
		panel.style.cssText = [
			'width:min(860px, 96vw)',
			'max-height: min(84vh, 860px)',
			'overflow:auto',
			'background:#111',
			'border:1px solid rgba(255,255,255,0.10)',
			'border-radius:12px',
			'padding:14px',
			'color:#fff',
		].join(';');

		let selectedMemberIdx = 0;

		const ensureSharedInventory = () => {
			// The project already uses hero.inventory as the main inventory in most UIs.
			// Here we enforce a shared inventory by migrating party inventories into hero.inventory.
			const partyMembers = getPartyMembers();
			if (!(hero as any).inventory) (hero as any).inventory = [];
			for (const m of partyMembers) {
				if (!m || m === (hero as any)) continue;
				const inv = ((m as any).inventory ?? []) as any[];
				if (inv.length) {
					for (const it of inv) {
						(hero as any).addItem?.(it);
					}
					(m as any).inventory = [];
				}
			}
		};

		const unequipToShared = (target: any, slot: string) => {
			const eq = (target?.equipment ?? {}) as Record<string, any>;
			const prev = eq?.[slot];
			if (!prev) return `Aucun équipement en ${slot}.`;
			delete eq[slot];
			target.equipment = eq;
			(hero as any).addItem?.(prev);
			// Ajuste PV et Mana courants si maxima diminuent
			try {
				target.pv = Math.min(target.pv, target.effectiveMaxPv ?? target.maxPv ?? target.pv);
				target.currentMana = Math.min(target.currentMana, target.effectiveMaxMana ?? target.maxMana ?? target.currentMana);
			} catch {
				// noop
			}
			return `${target?.name ?? 'Personnage'} retire ${prev?.name ?? slot} (slot: ${slot})`;
		};

		const equipFromShared = (target: any, invIndex: number) => {
			const shared = (((hero as any).inventory ?? []) as any[]);
			if (invIndex < 0 || invIndex >= shared.length) return 'Objet introuvable.';
			const item = shared[invIndex];
			if (!(item instanceof Equipment)) return `${String(item?.name ?? 'Objet')} ne peut pas être équipé.`;
			const eqItem = item as any;
			const slot = String(eqItem.slot ?? '');
			if (!slot) return 'Slot équipement invalide.';
			// Remove from shared inventory
			shared.splice(invIndex, 1);
			(hero as any).inventory = shared;
			// Unequip previous item from the same slot into shared
			const eq = (target?.equipment ?? {}) as Record<string, any>;
			const previous = eq[slot];
			if (previous) {
				shared.push(previous);
			}
			eq[slot] = eqItem;
			target.equipment = eq;
			// Ajuste PV et Mana courants si l'équipement augmente les maxima
			try {
				if (eqItem.hpBonus && eqItem.hpBonus > 0) {
					target.pv = Math.min((target.pv ?? 0) + eqItem.hpBonus, target.effectiveMaxPv ?? target.maxPv ?? (target.pv ?? 0));
				}
				if (eqItem.manaBonus && eqItem.manaBonus > 0) {
					target.currentMana = Math.min((target.currentMana ?? 0) + eqItem.manaBonus, target.effectiveMaxMana ?? target.maxMana ?? (target.currentMana ?? 0));
				}
			} catch {
				// noop
			}
			return `${target?.name ?? 'Personnage'} équipe ${eqItem?.name ?? 'Équipement'} (slot: ${slot})`;
		};

		const useFromShared = (target: any, invIndex: number) => {
			const shared = (((hero as any).inventory ?? []) as any[]);
			if (invIndex < 0 || invIndex >= shared.length) return 'Objet introuvable.';
			const item = shared[invIndex];
			if (!(item instanceof Consumable)) return `${String(item?.name ?? 'Objet')} ne peut pas être utilisé.`;
			let msg = '';
			try {
				msg = String(item.use?.(target) ?? '');
			} catch {
				msg = 'Impossible d\'utiliser cet objet.';
			}
			// Consumable stack: decrement quantity, remove only if last
			const q = Math.max(1, Math.floor(Number((item as any)?.quantity ?? 1)));
			if (Boolean((item as any)?.stackable) && q > 1) {
				(item as any).quantity = q - 1;
			} else {
				shared.splice(invIndex, 1);
			}
			(hero as any).inventory = shared;
			return msg || `${String(item?.name ?? 'Objet')} utilisé.`;
		};

		const renderModal = () => {
			ensureSharedInventory();
			const partyMembers = getPartyMembers();
			if (!partyMembers.length) selectedMemberIdx = 0;
			selectedMemberIdx = Math.max(0, Math.min(partyMembers.length - 1, Math.floor(selectedMemberIdx || 0)));
			const target = partyMembers[selectedMemberIdx] ?? hero;
			const inv = ((hero as any).inventory ?? []) as any[];
			const eq = (target.equipment ?? {}) as Record<string, any>;

			const renderEquipmentRows = () => {
				const entries = Object.entries(eq).filter(([, v]) => !!v);
				if (!entries.length) return '<div style="color:#bbb;">Aucun équipement équipé.</div>';
				return entries
					.map(([slot, item]) => {
						const name = escapeHtml(String(item?.name ?? slot));
						return `
							<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(255,255,255,0.04);padding:10px;border-radius:10px;margin-bottom:6px;">
								<div style="flex:1;">
									<div style="font-weight:800;">${name}</div>
									<div style="color:#bbb;font-size:12px;margin-top:3px;">Slot: ${escapeHtml(slot)}</div>
								</div>
								<button class="btn" data-house-unequip-slot="${escapeHtml(slot)}">Retirer</button>
							</div>
						`;
					})
					.join('');
			};

			const renderInventoryRows = () => {
				if (!inv.length) return '<div style="color:#bbb;">Inventaire vide.</div>';
				return inv
					.map((item, idx) => {
						const baseName = String(item?.name ?? 'Objet');
						const q = Math.max(1, Math.floor(Number((item as any)?.quantity ?? 1)));
						const showQty = Boolean((item as any)?.stackable) && q > 1;
						const name = escapeHtml(baseName);
						const desc = escapeHtml(String(item?.description ?? ''));
						const isConsumable = item instanceof Consumable;
						const isEquipment = item instanceof Equipment;
						const actions = [
							isConsumable ? `<button class="btn" data-house-use-idx="${idx}">Utiliser</button>` : '',
							isEquipment ? `<button class="btn" data-house-equip-idx="${idx}">Équiper</button>` : '',
						]
							.filter(Boolean)
							.join(' ');
						// Quality badge
						const colorMap = ['#ffffff', '#4caf50', '#2196f3', '#9c27b0', '#ffb300'];
						const nameMap = ['Blanc', 'Vert', 'Bleu', 'Violet', 'Orange/Doré'];
						const qQuality = Number((item as any).fabricationQuality ?? 0);
						let qualityBadgeHtml = '';
						if (qQuality >= 1 && qQuality <= 5) {
							const c = colorMap[Math.max(0, Math.min(colorMap.length - 1, qQuality - 1))];
							const label = nameMap[Math.max(0, Math.min(nameMap.length - 1, qQuality - 1))];
							qualityBadgeHtml = `<span title="Qualité: ${escapeHtml(String(label))}" style="display:inline-block;margin-left:8px;vertical-align:middle;"><span style="width:12px;height:12px;border-radius:2px;background:${c};box-shadow:0 0 6px ${c};display:inline-block;border:1px solid rgba(0,0,0,0.25);"></span></span>`;
						}
						const qtyHtml = showQty ? `<span style="margin-left:8px;opacity:0.9;font-weight:900;">x${q}</span>` : '';
						return `
							<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;background:rgba(255,255,255,0.04);padding:10px;border-radius:10px;margin-bottom:6px;">
								<div style="flex:1;">
									<div style="font-weight:800;">${name}${qualityBadgeHtml}${qtyHtml}</div>
									${desc ? `<div style=\"color:#bbb;font-size:12px;margin-top:3px;\">${desc}</div>` : ''}
								</div>
								<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">${actions || '<span style="color:#777;font-size:12px;">—</span>'}</div>
							</div>
						`;
					})
					.join('');
			};

			panel.innerHTML = `
				<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;">
					<div style="font-weight:900;font-size:18px;display:flex;align-items:center;gap:10px;">
						<span>Inventaire & Équipement</span>
						<img src="ImagesRPG/imagesobjets/coffre.png" alt="Coffre" style="width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.35));" />
					</div>
					<button class="btn" id="inventoryModalCloseBtn">Fermer</button>
				</div>
				<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
					<div style="display:flex;gap:8px;align-items:center;">
						<label style="color:#ddd;">Perso:</label>
						<select id="inventoryMemberSelect">
							${partyMembers.map((p, idx) => `<option value="${idx}" ${idx === selectedMemberIdx ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
						</select>
					</div>
					<div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
						<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">PV: <b>${Math.floor((target as any).pv ?? 0)}</b> / ${Math.floor((target as any).effectiveMaxPv ?? (target as any).maxPv ?? 0)}</div>
						<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">Mana: <b>${Math.floor((target as any).currentMana ?? 0)}</b> / ${Math.floor((target as any).effectiveMaxMana ?? (target as any).maxMana ?? 0)}</div>
						<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:10px;">ATK: <b>${Math.floor((target as any).effectiveAttack ?? (target as any).baseAttack ?? 0)}</b></div>
					</div>
				</div>

				<div style="margin-top:12px;display:grid;grid-template-columns: 1fr 1fr; gap:12px;">
					<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
						<div style="font-weight:900;margin-bottom:10px;">Équipement</div>
						${renderEquipmentRows()}
					</div>
					<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
						<div style="font-weight:900;margin-bottom:10px;">Inventaire</div>
						${renderInventoryRows()}
					</div>
				</div>
			`;

			(panel.querySelector('#inventoryModalCloseBtn') as HTMLButtonElement | null)?.addEventListener('click', () => {
				closeInventoryModal();
			});

			(panel.querySelector('#inventoryMemberSelect') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
				const v = Number((e.target as HTMLSelectElement).value);
				selectedMemberIdx = Number.isFinite(v) ? v : 0;
				renderModal();
			});

			(panel.querySelectorAll('[data-house-unequip-slot]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
				btn.addEventListener('click', () => {
					const slot = btn.getAttribute('data-house-unequip-slot') ?? '';
					if (!slot) return;
					try {
						const msg = unequipToShared(target as any, slot);
						if (msg) showTemporaryMessage(String(msg), 2200);
					} catch {
						showTemporaryMessage('Impossible de retirer cet équipement.');
					}
					renderModal();
				});
			});

			(panel.querySelectorAll('[data-house-use-idx]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
				btn.addEventListener('click', () => {
					const idx = Number(btn.getAttribute('data-house-use-idx'));
					if (!Number.isFinite(idx)) return;
					try {
						const msg = useFromShared(target as any, idx);
						if (msg) showTemporaryMessage(String(msg), 2400);
					} catch {
						showTemporaryMessage('Impossible d\'utiliser cet objet.');
					}
					renderModal();
				});
			});

			(panel.querySelectorAll('[data-house-equip-idx]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
				btn.addEventListener('click', () => {
					const idx = Number(btn.getAttribute('data-house-equip-idx'));
					if (!Number.isFinite(idx)) return;
					try {
						const msg = equipFromShared(target as any, idx);
						if (msg) showTemporaryMessage(String(msg), 2200);
					} catch {
						showTemporaryMessage('Impossible d\'équiper cet objet.');
					}
					renderModal();
				});
			});
		};

		renderModal();
		inventoryModalEl.appendChild(panel);
		inventoryModalEl.addEventListener('click', (e) => {
			if (e.target === inventoryModalEl) closeInventoryModal();
		});
		document.body.appendChild(inventoryModalEl);
	};

	const renderUnitLeaderOnly = (): string => {
		// Only one character is visible as a full sprite.
		// Followers are tiny icons in the same tile (not separate units/tiles).
		return `
			<div class="unit-sprite-wrap unit-team-allies">
				<img class="unit-sprite" src="${escapeHtml(leaderSprite)}" alt="Leader">
				<div style="position:absolute;left:6px;bottom:6px;display:flex;gap:4px;align-items:flex-end;pointer-events:none;">
					${followerSprites
						.map(
							(src) =>
								`<img src="${escapeHtml(src)}" alt="Suiveur" style="width:26px;height:26px;object-fit:contain;opacity:0.92;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.25));">`
						)
						.join('')}
				</div>
			</div>
		`;
	};

	const render = () => {
		app.innerHTML = `
			<div class="tactical-wrap" style="margin-top:-1%;">
				<div class="tactical-hud">
					<div class="tactical-panel" style="display:flex;gap:10px;align-items:center;">
						<div style="font-weight:900;">Maison — Déplacement (plateau 8x8)</div>
						<div style="color:#ddd;font-size:12px;">Clique une case pour te déplacer (case par case).</div>
					<div style="margin-left:auto;color:#ffd700;font-weight:800;">Jour <b id="houseDayVal">${getGameDay(hero)}</b></div>
					</div>
					<div class="tactical-actions">
						<button class="btn" id="movementBackBtn">Retour</button>
					</div>
				</div>
				<div class="tactical-center house-overflow">
					<div class="house-board-wrap">
						<img src="ImagesRPG/imagesfond/maison7.png" class="house-bg" alt="Maison RPG">
						<!-- Important: remove the combat plateau background image so the house background is visible. -->
						<div class="house-grid-wrap">
							<div class="tactical-grid house-grid iso" id="exploreGrid" aria-label="Plateau 8x8">
						${Array.from({ length: GRID_SIZE * GRID_SIZE })
							.map((_, i) => {
								const x = i % GRID_SIZE;
								const y = Math.floor(i / GRID_SIZE);
								const blocked = isBlocked({ x, y });
								const chest = isChest({ x, y });
								const forge = isForge({ x, y });
								const grimoire = isGrimoire({ x, y });
								const questJournal = isQuestJournal({ x, y });
								const sleep = isSleep({ x, y });
								const content = blocked
								? (forge
									? `<img src="ImagesRPG/imagesobjets/craft_icon.svg" alt="Craft" title="Enclume (fabrication)" style="width:86%;height:86%;object-fit:contain;pointer-events:none;margin:auto;display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.35));">`
									: chest
										? `<img src="ImagesRPG/imagesobjets/coffre.png" alt="Coffre" style="width:86%;height:86%;object-fit:contain;pointer-events:none;margin:auto;display:block;">`
										: grimoire
											? `<img src="ImagesRPG/imagesobjets/grimoire_image.png" alt="Grimoire" style="width:86%;height:86%;object-fit:contain;pointer-events:none;margin:auto;display:block;">`
										: questJournal
											? `<img src="ImagesRPG/imagesobjets/journal_quete.png" alt="Journal de quêtes" style="width:86%;height:86%;object-fit:contain;pointer-events:none;margin:auto;display:block;">`
												: sleep
													? `<img src="ImagesRPG/imagesobjets/sommeil.svg" alt="Dormir" title="Dormir (passer au lendemain)" style="width:86%;height:86%;object-fit:contain;pointer-events:none;margin:auto;display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.35));">`
										: '')
									: x === pos.x && y === pos.y
										? renderUnitLeaderOnly()
										: '';
								return `<div class="tile ${blocked ? 'blocked' : ''} ${forge ? 'forge' : ''} ${(chest || grimoire || questJournal || sleep) ? 'interactive' : ''}" data-x="${x}" data-y="${y}"><div class="tile-bg" aria-hidden="true"></div>${content}</div>`;
							})
							.join('')}
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

// Notification helper
	// (use static import at module top)
	document.getElementById('movementBackBtn')?.addEventListener('click', () => {
			stopMovement();
			closeFabricationModal();
			closeInventoryModal();
			closeQuestJournalModal();
			try { window.removeEventListener('tempSpriteChanged', onTempSpriteChangedHouse); } catch (e) { /* noop */ }
			try { window.removeEventListener(GAME_DAY_EVENT, onGameDayAdvance); } catch (e) { /* noop */ }
			options.onBack();
		});

		const grid = document.getElementById('exploreGrid');
		if (!grid) return;

		if (!isoResizeBound) {
			isoResizeBound = true;
			window.addEventListener('resize', () => scheduleIsoLayout());
		}

		// Hover highlighting on the SVG overlay (same pattern as combat plateau).
		grid.addEventListener('mousemove', (e) => {
			const t = (e.target as HTMLElement | null)?.closest?.('.tile[data-x][data-y]') as HTMLElement | null;
			const next = t ? `${t.dataset.x},${t.dataset.y}` : '';
			const cur = String((grid as any).dataset?.isoHoverKey ?? '');
			if (next === cur) return;
			(grid as any).dataset.isoHoverKey = next;
			layoutIsoGrid();
		});
		grid.addEventListener('mouseleave', () => {
			(grid as any).dataset.isoHoverKey = '';
			layoutIsoGrid();
		});

		// Apply iso positioning after the grid is in the DOM.
		scheduleIsoLayout();

		(grid.querySelectorAll('.tile[data-x][data-y]') as NodeListOf<HTMLElement>).forEach((tile) => {
			tile.addEventListener('click', async () => {
				const x = Number(tile.getAttribute('data-x'));
				const y = Number(tile.getAttribute('data-y'));
				if (!Number.isFinite(x) || !Number.isFinite(y)) return;

				const target = { x: clamp(x, 0, GRID_SIZE - 1), y: clamp(y, 0, GRID_SIZE - 1) };
				if (target.x === pos.x && target.y === pos.y) return;

					// Clicking the anvil opens crafting.
					if (isForge(target)) {
						openFabricationModal();
						return;
					}
					// Clicking the chest opens inventory/equipment.
					if (isChest(target)) {
						openInventoryModal();
						return;
					}
					// Clicking the grimoire opens the compétences menu.
					if (isGrimoire(target)) {
						showCompetences();
						return;
					}
					// Clicking the sleep tile advances the market day.
					if (isSleep(target)) {
						try {
							const res = advanceGameDay(hero, { reason: 'sleep' });
							const market = res.market;
							if (market && market.soldCount > 0) {
								showTemporaryMessage(`Jour ${res.day} — Ventes: ${market.soldCount} objet(s) (+${market.soldTotal} or à collecter).`, 4200);
							} else {
								showTemporaryMessage(`Jour ${res.day} — Aucune vente aujourd'hui.`, 2800);
							}
						} catch (e) {
							console.error('[house] advanceGameDay error', e);
							showTemporaryMessage('Impossible de passer au lendemain.', 2600);
						}
						render();
						return;
					}
					// Clicking the quest journal opens the quests modal.
					if (isQuestJournal(target)) {
						openQuestJournalModal();
						return;
					}
					if (isBlocked(target) && !isForge(target)) { showTemporaryMessage('Case occupée.'); return; }
					const path = findPathBFS(pos, target);
					if (!path.length) { showTemporaryMessage('Chemin bloqué.'); return; }
					const gridRect = grid.getBoundingClientRect();
				const fromTile = grid.querySelector(`.tile[data-x="${pos.x}"][data-y="${pos.y}"]`) as HTMLElement | null;
				if (!fromTile) {
					pos = target;
					render();
					(window as any).__houseMovementAnimating = false;
					return;
				}

				const unitEl = fromTile.querySelector('.unit-badge, .unit-sprite-wrap, .unit-sprite')?.closest('div') as HTMLElement | null;
				const fromRect = fromTile.getBoundingClientRect();

				const tilePosPx = (p: { x: number; y: number }) => {
					const t = grid.querySelector(`.tile[data-x="${p.x}"][data-y="${p.y}"]`) as HTMLElement | null;
					if (!t) return null;
					const r = t.getBoundingClientRect();
					return { left: r.left - gridRect.left, top: r.top - gridRect.top };
				};

				const startPx = { left: fromRect.left - gridRect.left, top: fromRect.top - gridRect.top };
				const keyframes: Keyframe[] = [];
				keyframes.push({ transform: `translate(${startPx.left}px, ${startPx.top}px)` });
				for (const p of path) {
					const px = tilePosPx(p);
					if (px) keyframes.push({ transform: `translate(${px.left}px, ${px.top}px)` });
				}

				const duration = Math.max(80, path.length * MOVE_STEP_MS);

				const ghost = document.createElement('div');
				ghost.className = 'tactical-move-ghost';
				ghost.style.width = `${fromRect.width}px`;
				ghost.style.height = `${fromRect.height}px`;
				ghost.style.transform = `translate(${startPx.left}px, ${startPx.top}px)`;

				if (unitEl) {
					const clone = unitEl.cloneNode(true) as HTMLElement;
					clone.style.width = '100%';
					clone.style.height = '100%';
					ghost.appendChild(clone);
					unitEl.style.opacity = '0';
				} else {
					ghost.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${escapeHtml(String((leader as any)?.name ?? 'Leader'))}</div>`;
				}

				grid.appendChild(ghost);

				try {
					// Animate along keyframes
					const anim = ghost.animate(keyframes, { duration, easing: 'linear', fill: 'forwards' });
					// @ts-ignore
					await (anim.finished ?? new Promise<void>((resolve) => anim.addEventListener('finish', () => resolve())));

					pos = target;
					render();
				} finally {
					ghost.remove();
					if (unitEl) unitEl.style.opacity = '';
					(window as any).__houseMovementAnimating = false;
				}
			});
		});
	};

	render();
}
