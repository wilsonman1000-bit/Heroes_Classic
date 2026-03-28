import { escapeHtml } from '../utils.web.js';
import { ensureTacticalStyles } from '../tactical/styles.web.js';
import { showTemporaryMessage } from '../uiNotifications.js';
import { showTacticalSkirmish } from '../tacticalCombat.web.js';
import { getPartyMembers } from '../party.web.js';
import { getIdleSpriteSrc, getMoveDir, getWalkAnimMinDurationMs, getWalkCycle, startWalkSpriteAnimation } from '../characterSprites.web.js';
import { showMaisonDeplacement } from '../movement/houseMovement.web.js';
import { showAuberge, showBoutique } from '../village/villageMain.web.js';
import { showMarche } from '../market/market.web.js';
import { Campfire, Consumable, Equipment } from '../item.js';
import { renderItemIconHtml } from '../itemIcons.web.js';
import { showTalentTree } from '../talents/talentTree.web.js';
import { ENEMY_DEFS } from '../enemies.js';
import { key, type MapDef, type MapPos, type TileDef, type WorldManager } from './world.js';
import { mountPixiCanvas, unmountBattleCanvas } from '../pixi/pixiBootstrap.web.js';
import { ensureWorldMapPixiListenerBound } from '../pixi/worldMapPixi.web.js';
import { startDialogue } from '../dialogue/dialogueManager.web.js';
import type { DialogueContext, DialogueScript } from '../dialogue/dialogueTypes.js';
import { advanceGameTimeHours, GAME_TIME_EVENT, getGameTime } from '../daySystem.web.js';

export type MapRendererOptions = {
	world: WorldManager;
	onBack: () => void;
	start?: { mapId: string; entry: MapPos };
	fadeMs?: number;
	layout?: {
		isoScale?: number;
		tileAspect?: number;
		bgScale?: number; // optional multiplier for background texture size (1.0 = native)
		/** Optional horizontal translate applied to the background image (percent number or string, e.g. -4 or '-4%'). */
		bgTranslateX?: string | number;
		/** Optional vertical translate applied to the background image (percent number or string, e.g. -4 or '-4%'). */
		bgTranslateY?: string | number;
		/** Optional horizontal translate applied to the whole board wrapper (e.g. '0%', '5%'). */
		boardTranslateX?: string | number;
		/** Optional vertical translate applied to the whole board wrapper (e.g. '0%', '-20%'). Overrides the default CSS translateY. */
		boardTranslateY?: string | number;
		/** Optional global board scale multiplier (per-map meta.boardScale overrides this) */
		boardScale?: number;
	};
	movement?: {
		stepMs?: number;
		allowEnterBlockedDestination?: boolean;
	};
};

const GRID_ID = 'plateauWorldGrid';

const DEFAULT_RANDOM_ENCOUNTER_CHANCE = 0.05;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ensureRendererStyles() {
	const id = 'map-renderer-styles';
	const existing = document.getElementById(id) as HTMLStyleElement | null;
	const s = existing ?? document.createElement('style');
	if (!existing) s.id = id;
	s.innerHTML = `
		.worldmap-fade { position:fixed; inset:0; background:#000; opacity:0; pointer-events:none; transition: opacity 240ms ease; z-index:9999; }
		.worldmap-fade.on { opacity:1; }

		/* Dedicated fullscreen Pixi container for world maps (mounted into <body>) */
		#worldPixiScreen {
			position: fixed;
			inset: 0;
			width: 100vw;
			height: 100vh;
			z-index: 1;
			pointer-events: auto;
		}
		#worldPixiScreen canvas { width:100%; height:100%; display:block; }

		/* (Legacy) Pixi overlay inside world grid (leader sprite) */
		.tactical-grid.plateau-grid .plateau-pixi-layer { display:none; }
		/* Keep the DOM leader clickable but invisible when Pixi leader is enabled */
		.tactical-grid.plateau-grid.pixi-leader .unit-sprite-wrap[data-open-hub="1"] { opacity: 0; }
		/* Full Pixi board: hide DOM tiles and svg overlay */
		.tactical-grid.plateau-grid.pixi-board .tile { display: none; }
		.tactical-grid.plateau-grid.pixi-board .iso-grid-overlay { display: none; }
		.tactical-grid.plateau-grid.pixi-board .unit-sprite-wrap[data-open-hub="1"] { pointer-events: none; }

		/* Keep the overflowing iso board above side panels so edge tiles stay clickable */
		.plateau-board-wrap { position: relative; display: inline-block; overflow: visible; transform: translateY(10%); z-index: 500; }
		/* IMPORTANT: a transformed ancestor breaks position:fixed sizing in some browsers.
		   When Pixi board is enabled, we must remove the transform so the fullscreen canvas truly uses the viewport. */
		.plateau-board-wrap.pixi-board-wrap { transform: none; margin-top: 2vh; }
		.plateau-board-wrap.pixi-board-wrap::after { display: none; }
		.plateau-board-wrap.pixi-board-wrap .plateau-bg { display: none; }
		/* Diamond overlay under the grid (gap darkening) */
		.plateau-board-wrap::after {
			content:'';
			position:absolute;
			left:50%;
			/* center the diamond overlay */
			top:50%;
			width:100%;
			height:100%;
			/* Avoid >100% / negative clip-path coords (can clamp to vertical edges).
			   Widen using scaleX so left/right stays visible. */
			/* Slightly larger overlay (closer to combat sizing) */
			transform: translate(-50%, -50%) scaleX(1.4626) scaleY(1.05633);
			transform-origin: center;
			/* 90% opacity (almost black) */
			background: rgba(0,0,0,0.90);
			clip-path: polygon(50% 5%, 100% 50%, 50% 95%, 0% 50%);
			-webkit-clip-path: polygon(50% 5%, 100% 50%, 50% 95%, 0% 50%);
			pointer-events:none;
			z-index: 1;
		}
		/* Allow maps to disable the decorative overlay (e.g. village maps) */
		.plateau-board-wrap.no-board-overlay::after { display: none; }
		.plateau-board-wrap .plateau-bg {
			position:absolute;
			left:50%;
			top:50%;
			width:100%;
			height:100%;
			object-fit:contain;
			transform: translate(-50%, -50%) scale(var(--plateauBgScale, 1));
			transform-origin: center;
			z-index:0;
			filter: brightness(0.75);
			background:#000;
			pointer-events:none;
		}
		.tactical-grid.plateau-grid {
			/* Movement mode: keep full board size (old 0.9 made the board feel too small). */
			width: calc(var(--boardSize) * 1.2 * var(--boardScale, 1));
			height: calc(var(--boardSize) * 1.2 * var(--boardScale, 1));
			background-image: none !important;
			background: transparent !important;
			position: relative;
			z-index: 2;
		}
		.tactical-center.plateau-overflow { overflow: visible; }

		/* Ensure CSS UI stays above the fullscreen Pixi canvas */
		.tactical-wrap { position: relative; z-index: 2; }
		.tactical-wrap .tactical-hud { position: relative; z-index: 2000; }
		.tactical-wrap .tactical-side { position: relative; z-index: 1200; }
		.tactical-wrap .tactical-center { position: relative; z-index: 1000; }
		/* World Pixi-board mode: DOM becomes an overlay UI only.
		   Make the whole wrapper click-through so the fullscreen Pixi canvas receives tile/leader clicks,
		   then re-enable pointer events on actual UI panels. */
		.tactical-wrap.pixi-world-ui { pointer-events: none; }
		.tactical-wrap.pixi-world-ui * { pointer-events: none; }
		.tactical-wrap.pixi-world-ui .tactical-hud,
		.tactical-wrap.pixi-world-ui .tactical-hud *,
		.tactical-wrap.pixi-world-ui .tactical-side,
		.tactical-wrap.pixi-world-ui .tactical-side * {
			pointer-events: auto;
		}

		/* Integrated terrain tiles: each tile shows a cutout of the background image */
		.tactical-grid.plateau-grid.iso .iso-grid-overlay { opacity: 0; pointer-events: none; }
		.tactical-grid.plateau-grid .tile { position: absolute; }
		.tactical-grid.plateau-grid .tile-bg {
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
		.tactical-grid.plateau-grid .tile > :not(.tile-bg) { position: relative; z-index: 1; }
		.tactical-grid.plateau-grid .tile:hover .tile-bg { filter: brightness(1.07) saturate(1.05); }
		.tactical-grid.plateau-grid .tile.interactive .tile-bg { box-shadow: inset 0 0 0 1px rgba(255, 215, 0, 0.16); }
		.tactical-grid.plateau-grid .tile.blocked .tile-bg { filter: saturate(0.92) brightness(0.98); }

		/* Sprite sizing for exploration */
		.tactical-grid.plateau-grid .unit-sprite { width: 129% !important; height: 145% !important; }
		.tactical-grid.plateau-grid .unit-sprite-wrap { align-items: center; justify-content: center; }

		.plateau-marker { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:22px; text-shadow:0 4px 10px rgba(0,0,0,0.55); pointer-events:none; }
		.plateau-marker.exit.east::after { content:'➡'; }
		.plateau-marker.exit.west::after { content:'⬅'; }
		.plateau-marker.exit.north::after { content:'⬆'; }
		.plateau-marker.exit.south::after { content:'⬇'; }
		.plateau-marker.npc::after { content:'💬'; }
		.plateau-marker.house::after { content:'🏠'; }
		.plateau-marker.inn::after { content:'🍻'; }
		.plateau-marker.market::after { content:'🛒'; }
		.plateau-marker.shop::after { content:'🏪'; }
		/* Combat marker uses an image instead of an emoji */
		.plateau-marker.combat::after { content:''; }
		.plateau-marker.combat .plateau-marker-enemy {
			width: 110%;
			height: 110%;
			object-fit: contain;
			display:block;
			filter: drop-shadow(0 16px 26px rgba(0,0,0,0.55));
			border-radius: 8px;
			transform: translateY(-3%);
		}
	`;
	if (!s.parentNode) document.head.appendChild(s);
}

function enemyImageSrc(enemyId: unknown): string {
	const id = String(enemyId ?? '');
	const def = (ENEMY_DEFS as any)[id];
	const src = String(def?.image ?? '');
	return src || 'ImagesRPG/imagespersonnage/trueennemi.png';
}

function scheduleIsoLayout(
	app: HTMLElement,
	gridEl: HTMLElement,
	cols: number,
	rows: number,
	layout?: { isoScale?: number; tileAspect?: number; bgScale?: number; bgTranslateX?: string | number; bgTranslateY?: string | number },
	map?: MapDef,
) {
	// Prefer per-map isoScale override if provided, otherwise fall back to layout default.
	// World maps: default slightly smaller so the board fits better within the background artwork.
	const SCALE = Math.max(0.6, Math.min(2.2, Number(map?.meta?.isoScale ?? layout?.isoScale ?? 0.85)));
	const ASPECT = Math.max(0.35, Math.min(0.9, Number(layout?.tileAspect ?? 0.68)));

	const layoutIsoGrid = () => {
		if (!gridEl.classList.contains('iso')) return;
		const rect = gridEl.getBoundingClientRect();
		const gridW = rect.width;
		const gridH = rect.height;
		if (gridW < 80 || gridH < 80) return;

		// Match combat: pad=10, gap=6 (so the "holes" between tiles look identical)
		const pad = 10;
		// World maps: use a very small gap by default so tile borders are barely visible.
		// You can override per map via `map.meta.tileGap` (e.g. 0, 1, 2, 6...).
		const gap = Math.max(0, Math.floor(Number(map?.meta?.tileGap ?? 2)));

		const baseTileW = Math.max(26, (gridW - pad * 2 - gap * (cols - 1)) / Math.max(4, cols));
		const tileW = Math.max(28, Math.floor(baseTileW * SCALE));
		const tileH = Math.max(16, Math.floor(tileW * ASPECT));
		const halfW = tileW / 2;
		const halfH = tileH / 2;

		const isoGapX = Math.max(0, Math.floor(gap * 1.0));
		const isoGapY = Math.max(0, Math.floor(gap * 0.65));
		const stepW = halfW + isoGapX;
		const stepH = halfH + isoGapY;

		gridEl.style.setProperty('--isoTileW', `${tileW}px`);
		gridEl.style.setProperty('--isoTileH', `${tileH}px`);

		// Background cutout alignment (LOCKED): compute in local coordinates.
		// We render a local <img.plateau-bg> inside the same wrapper as the grid.
		// Per-map override should win over the global layout default.
		const BG_SCALE_BASE = Number(map?.meta?.bgScale ?? layout?.bgScale ?? 1.5);
		// Requested: enlarge the background artwork by +20%
		const BG_SCALE = Math.max(0.5, Math.min(3, BG_SCALE_BASE * 1.2));
		const bgTranslateX = map?.meta?.bgTranslateX ?? layout?.bgTranslateX;
		const bgTranslateY = map?.meta?.bgTranslateY ?? layout?.bgTranslateY;
		const toPct = (v: string | number | undefined): { str: string; pct: number } => {
			if (v === undefined) return { str: '0%', pct: 0 };
			if (typeof v === 'number') return { str: `${v}%`, pct: v };
			const s = String(v).trim();
			if (!s) return { str: '0%', pct: 0 };
			const n = Number.parseFloat(s);
			if (!Number.isFinite(n)) return { str: '0%', pct: 0 };
			return { str: s.includes('%') ? s : `${n}%`, pct: n };
		};
		const bgTx = toPct(bgTranslateX);
		const bgTy = toPct(bgTranslateY);
		const wrap = gridEl.closest('.plateau-board-wrap') as HTMLElement | null;
		const bgEl = wrap?.querySelector('img.plateau-bg') as HTMLImageElement | null;
		const bgSrc = bgEl?.getAttribute('src') ?? '';
		if (wrap) wrap.style.setProperty('--plateauBgScale', String(BG_SCALE));
		// Apply directly as well (more robust than relying only on CSS var + cascade).
		// IMPORTANT: CSS translate(% ) is relative to the element itself (image box), which makes the offset
		// depend on the image aspect ratio/resolution. We want the translation relative to the grid.
		let bgTranslatePxX = 0;
		let bgTranslatePxY = 0;
		if (gridW > 0 && gridH > 0) {
			bgTranslatePxX = (gridW * bgTx.pct) / 100;
			bgTranslatePxY = (gridH * bgTy.pct) / 100;
		}
		if (bgEl) {
			bgEl.style.transform = `translate(-50%, -50%) translate(${Math.round(bgTranslatePxX)}px, ${Math.round(bgTranslatePxY)}px) scale(${BG_SCALE})`;
		}

		// object-fit: contain math (then optionally scaled by BG_SCALE)
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
			bgOffsetY = (gridH - bgDrawH) / 2;
			// Keep tile background cutouts aligned with a translated background image.
			bgOffsetX += bgTranslatePxX;
			bgOffsetY += bgTranslatePxY;
			gridEl.style.setProperty('--houseBgImage', bgSrc ? `url(\"${bgSrc}\")` : 'none');
			gridEl.style.setProperty('--houseBgSize', `${Math.round(bgDrawW)}px ${Math.round(bgDrawH)}px`);
		} else {
			gridEl.style.setProperty('--houseBgImage', bgSrc ? `url(\"${bgSrc}\")` : 'none');
			gridEl.style.setProperty('--houseBgSize', 'auto');
		}

		const minX = -(rows - 1) * stepW;
		const maxX = (cols - 1) * stepW;
		const minY = 0;
		const maxY = (cols + rows - 2) * stepH;
		const fullW = maxX - minX + tileW;
		const fullH = maxY - minY + tileH;
		const offsetX = (gridW - fullW) / 2 + tileW / 2 - minX;
		const offsetY = (gridH - fullH) / 2 + tileH / 2 - minY;

		const tiles = gridEl.querySelectorAll<HTMLElement>('.tile[data-x][data-y]');

		let overlay = gridEl.querySelector('svg.iso-grid-overlay') as SVGSVGElement | null;
		if (!overlay) {
			overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
			overlay.classList.add('iso-grid-overlay');
			gridEl.insertBefore(overlay, gridEl.firstChild);
		}
		overlay.setAttribute('viewBox', `0 0 ${gridW} ${gridH}`);
		overlay.setAttribute('preserveAspectRatio', 'none');

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
			el.style.zIndex = String(Math.floor((x + y) * 100 + x));

			if (bgDrawW > 10 && bgDrawH > 10) {
				// Background top-left is at (bgOffsetX, bgOffsetY) in grid local space.
				// We want tile center (cx, cy) to show the matching background pixel at tile-bg center.
				const desiredBgPosX = bgOffsetX - cx + tileW / 2;
				const desiredBgPosY = bgOffsetY - cy + tileH / 2;
				el.style.setProperty('--houseBgPosX', `${Math.round(desiredBgPosX)}px`);
				el.style.setProperty('--houseBgPosY', `${Math.round(desiredBgPosY)}px`);
			} else {
				el.style.setProperty('--houseBgPosX', '0px');
				el.style.setProperty('--houseBgPosY', '0px');
			}

			polyParts.push(`<polygon class="iso-tile" points="${polygonFor(cx, cy)}"></polygon>`);
		}
		overlay.innerHTML = polyParts.join('');
	};

	requestAnimationFrame(() => {
		layoutIsoGrid();
		setTimeout(() => layoutIsoGrid(), 80);
	});

	// If the background image loads after first layout, realign once it's ready.
	const wrap = gridEl.closest('.plateau-board-wrap') as HTMLElement | null;
	const bgEl = wrap?.querySelector('img.plateau-bg') as HTMLImageElement | null;
	if (bgEl && !bgEl.complete) {
		bgEl.addEventListener('load', () => {
			requestAnimationFrame(() => {
				layoutIsoGrid();
				setTimeout(() => layoutIsoGrid(), 80);
			});
		}, { once: true });
		bgEl.addEventListener('error', () => {
			showTemporaryMessage(`Image de fond introuvable: ${bgEl.getAttribute('src') ?? ''}`, 3200);
		}, { once: true });
	} else if (bgEl && bgEl.complete && (bgEl.naturalWidth ?? 0) === 0) {
		// Some browsers mark failed images as complete=true with naturalWidth=0.
		showTemporaryMessage(`Image de fond introuvable: ${bgEl.getAttribute('src') ?? ''}`, 3200);
	}
}

function leaderSpriteSrc(): string {
	const party = getPartyMembers().slice(0, 1);
	const leader = party[0];
	const cls = String((leader as any)?.characterClass ?? '').toLowerCase();
	const stun = Math.max(0, Math.floor(Number((leader as any)?.stunTurns ?? 0)));
	const temp = String((leader as any)?.__tempSprite ?? '');
	if (temp) return temp;
	if (cls === 'guerrier' && stun > 0) return './ImagesRPG/imagespersonnage/perso_guerrier_mort.png';
	if (cls === 'mage') return './ImagesRPG/imagespersonnage/mage.png';
	if (cls === 'voleur') return './ImagesRPG/imagespersonnage/voleur.png';
	if (cls === 'guerrier') return getIdleSpriteSrc(cls) ?? './ImagesRPG/imagespersonnage/true_perso_guerrier.png';
	return './ImagesRPG/imagespersonnage/trueplayer.png';
}

function renderLeader(): string {
	const src = leaderSpriteSrc();
	return `
		<div class="unit-sprite-wrap unit-team-allies" data-open-hub="1" title="Menu" style="cursor:pointer;pointer-events:auto;">
			<img class="unit-sprite" src="${escapeHtml(src)}" alt="Leader">
		</div>
	`;
}

function getTile(map: MapDef, tiles: Map<string, TileDef>, x: number, y: number): TileDef | null {
	if (x < 0 || y < 0 || x >= map.w || y >= map.h) return null;
	return tiles.get(`${x},${y}`) ?? null;
}

export function showPlateauMapRenderer(opts: MapRendererOptions): void {
	ensureTacticalStyles();
	ensureRendererStyles();

	const app = document.getElementById('app');
	if (!app) return;

	const fadeMs = Math.max(0, Math.floor(opts.fadeMs ?? 240));

	const fade = document.createElement('div');
	fade.className = 'worldmap-fade';
	fade.style.transitionDuration = `${fadeMs}ms`;
	document.body.appendChild(fade);

	let moveTimer: number | null = null;
	let moveQueue: MapPos[] = [];
	let animating = false;
	let gameTimeHandler: ((ev: any) => void) | null = null;
	const PIXI_CONTAINER_ID = 'worldPixiScreen';
	let worldPixiScreenEl: HTMLDivElement | null = null;
	let pixiMountedHandler: (() => void) | null = null;
	let pixiTileClickHandler: ((ev: any) => void) | null = null;
	let pixiLeaderClickHandler: ((ev: any) => void) | null = null;
	let pixiResizeHandler: (() => void) | null = null;

	// Important: the world map uses a fullscreen Pixi canvas mounted in <body>.
	// If we navigate to another screen (market/house/talent tree/etc) without removing it,
	// it will sit on top of the DOM and steal all pointer events.
	const teardownWorldPixiOverlay = () => {
		if (pixiMountedHandler) {
			try { window.removeEventListener('pixiMounted', pixiMountedHandler as any); } catch { /* noop */ }
			pixiMountedHandler = null;
		}
		if (pixiTileClickHandler) {
			try { window.removeEventListener('worldTileClick', pixiTileClickHandler as any); } catch { /* noop */ }
			pixiTileClickHandler = null;
		}
		if (pixiLeaderClickHandler) {
			try { window.removeEventListener('worldLeaderClick', pixiLeaderClickHandler as any); } catch { /* noop */ }
			pixiLeaderClickHandler = null;
		}
		if (pixiResizeHandler) {
			try { window.removeEventListener('resize', pixiResizeHandler as any); } catch { /* noop */ }
			pixiResizeHandler = null;
		}

		// Remove CSS classes that change pointer-events behavior.
		try {
			const grid = document.getElementById(GRID_ID) as HTMLElement | null;
			grid?.classList.remove('pixi-board', 'pixi-leader');
			const tacticalWrap = grid?.closest('.tactical-wrap') as HTMLElement | null;
			tacticalWrap?.classList.remove('pixi-world-ui');
			const wrap = grid?.closest('.plateau-board-wrap') as HTMLElement | null;
			wrap?.classList.remove('pixi-board-wrap');
			const centerCol = grid?.closest('.tactical-center') as HTMLElement | null;
			centerCol?.classList.remove('pixi-board-center');
		} catch {
			// noop
		}

		try { unmountBattleCanvas(); } catch { /* noop */ }
		if (worldPixiScreenEl) {
			try { worldPixiScreenEl.remove(); } catch { /* noop */ }
			worldPixiScreenEl = null;
		}
	};

	const ensureWorldPixiScreen = (): HTMLDivElement | null => {
		const existing = document.getElementById(PIXI_CONTAINER_ID) as HTMLDivElement | null;
		if (existing) {
			worldPixiScreenEl = existing;
			return existing;
		}
		const el = document.createElement('div');
		el.id = PIXI_CONTAINER_ID;
		el.setAttribute('aria-hidden', 'true');
		// Primary styling comes from ensureRendererStyles(), keep inline fallback anyway.
		el.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:auto;';
		document.body.appendChild(el);
		worldPixiScreenEl = el;
		return el;
	};

	let inventoryModalEl: HTMLDivElement | null = null;
	let inventorySelectedMemberIdx = 0;
	let inventoryOnClose: (() => void) | null = null;

	let hubModalEl: HTMLDivElement | null = null;

	const closeInventoryModal = (closeOpts: { silent?: boolean } = {}) => {
		if (!inventoryModalEl) return;
		inventoryModalEl.remove();
		inventoryModalEl = null;
		const cb = inventoryOnClose;
		inventoryOnClose = null;
		if (!closeOpts.silent) cb?.();
	};

	const closeHubModal = () => {
		if (!hubModalEl) return;
		hubModalEl.remove();
		hubModalEl = null;
	};

	const openHubModal = () => {
		if (hubModalEl) return;
		if (inventoryModalEl) return;
		if (animating) return;

		hubModalEl = document.createElement('div');
		hubModalEl.id = 'worldModalHub';
		hubModalEl.style.cssText = [
			'position:fixed',
			'inset:0',
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'background:rgba(0,0,0,0.68)',
			'z-index:10000',
			'padding:18px',
		].join(';');

		const panel = document.createElement('div');
		panel.style.cssText = [
			'position:relative',
			'width:min(560px, 92vw)',
			'height:min(560px, 92vw)',
			'max-width:560px',
			'max-height:560px',
			'border-radius:18px',
			'background: radial-gradient(circle at 50% 40%, rgba(255,255,255,0.08), rgba(0,0,0,0.25) 60%), rgba(0,0,0,0.30)',
			'border:1px solid rgba(255,255,255,0.12)',
			'box-shadow:0 18px 48px rgba(0,0,0,0.55)',
			'overflow:hidden',
		].join(';');

		const btnBase = [
			'position:absolute',
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'gap:10px',
			'padding:14px 14px',
			'border-radius:16px',
			'border:1px solid rgba(255,255,255,0.14)',
			'background:rgba(0,0,0,0.55)',
			'color:#fff',
			'font-weight:900',
			'cursor:pointer',
			'user-select:none',
			'box-shadow:0 12px 26px rgba(0,0,0,0.40)',
		].join(';');

		panel.innerHTML = `
			<div style="position:absolute;left:14px;top:12px;right:14px;text-align:center;color:rgba(255,255,255,0.95);font-weight:900;letter-spacing:0.4px;">
				Menu
			</div>

			<button class="btn" data-hub-action="inventory" style="${btnBase};left:16px;top:50%;transform:translateY(-50%);width:40%;height:22%;">
				<span style="font-size:18px;">📦</span>
				<span>Inventaire</span>
			</button>

			<button class="btn" data-hub-action="talents" style="${btnBase};right:16px;top:50%;transform:translateY(-50%);width:40%;height:22%;">
				<span style="font-size:18px;">🌳</span>
				<span>Arbre de talents</span>
			</button>

			<button class="btn" data-hub-action="character" style="${btnBase};left:50%;top:56px;transform:translateX(-50%);width:56%;height:20%;">
				<span style="font-size:18px;">👤</span>
				<span>Personnage</span>
			</button>

			<button class="btn" data-hub-action="other" style="${btnBase};left:50%;bottom:16px;transform:translateX(-50%);width:56%;height:20%;">
				<span style="font-size:18px;">📜</span>
				<span>Autre</span>
				<span style="opacity:0.75;font-weight:800;">(bientôt)</span>
			</button>

			<button class="btn" data-hub-action="back" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:132px;height:132px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.62);color:#fff;font-weight:900;box-shadow:0 16px 34px rgba(0,0,0,0.50);cursor:pointer;">
				<div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
					<div style="font-size:22px;line-height:1;">⟲</div>
					<div>Retour</div>
				</div>
			</button>
		`;

		hubModalEl.appendChild(panel);
		document.body.appendChild(hubModalEl);

		panel.querySelectorAll('[data-hub-action]').forEach((el) => {
			(el as HTMLElement).addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const action = String((el as HTMLElement).getAttribute('data-hub-action') ?? '');
				if (action === 'back') {
					closeHubModal();
					return;
				}
				if (action === 'inventory') {
					closeHubModal();
					openInventoryModal({ onClose: () => openHubModal() });
					return;
				}
				if (action === 'talents') {
					closeHubModal();
					teardownWorldPixiOverlay();
					showTalentTree({
						selectedIdx: 0,
						onBack: () => {
							render();
							requestAnimationFrame(() => openHubModal());
						},
					});
					return;
				}
				if (action === 'character') {
					closeHubModal();
					// Open the new personnage modal (with dropdown) from the hub.
					void import('../personnages.web.js').then((m: any) => {
						try {
							m.openPersonnageModalFromMap?.({ startIndex: 0 });
						} catch {
							showTemporaryMessage('Impossible d\'ouvrir la fiche.', 1600);
						}
					});
					return;
				}
				if (action === 'other') {
					showTemporaryMessage('Bientôt disponible.', 1600);
					return;
				}
			});
		});

		hubModalEl.addEventListener('click', (e) => {
			if (e.target === hubModalEl) closeHubModal();
		});

		// ESC closes
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape') {
				closeHubModal();
				window.removeEventListener('keydown', onKey);
			}
		};
		window.addEventListener('keydown', onKey);
	};

	const openInventoryModal = (invOpts: { onClose?: () => void } = {}) => {
		if (inventoryModalEl) return;
		let selectedInvIdx: number | null = null;
		const hero = getPartyMembers()[0] as any;
		if (!hero) {
			showTemporaryMessage('Aucun personnage.', 1600);
			return;
		}
		inventoryOnClose = invOpts.onClose ?? null;

		inventoryModalEl = document.createElement('div');
		inventoryModalEl.id = 'inventoryModalWorldMap';
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

		const ensureSharedInventory = () => {
			// En exploration, on force un inventaire partagé (hero.inventory).
			const partyMembers = getPartyMembers();
			if (!(hero as any).inventory) (hero as any).inventory = [];
			for (const m of partyMembers) {
				if (!m || m === hero) continue;
				const inv = (((m as any).inventory ?? []) as any[]);
				if (inv.length) {
					for (const it of inv) (hero as any).addItem?.(it);
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
			if (previous) shared.push(previous);
			eq[slot] = eqItem;
			target.equipment = eq;
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
			const isCampfire = item instanceof Campfire || String((item as any)?.id ?? '') === 'feu_de_camp';
			if (!(item instanceof Consumable) && !isCampfire) return `${String(item?.name ?? 'Objet')} ne peut pas être utilisé.`;

			// Campfire: allow usage on the world map to rest the whole party.
			if (isCampfire) {
				const party = getPartyMembers();
				for (const p of party) {
					if (!p) continue;
					try {
						// Campfire is considered a "full rest": it restores lost max HP from the
						// adventure wound system, then refills PV/mana.
						(p as any).__adventureMaxHpPenalty = 0;
						if (typeof (p as any).syncDerivedStatsFromCharacteristics === 'function') {
							(p as any).syncDerivedStatsFromCharacteristics({ fillResources: true });
						} else {
							const maxPv = Math.max(0, Math.floor(Number((p as any).effectiveMaxPv ?? (p as any).maxPv ?? (p as any).pv ?? 0)));
							const maxMana = Math.max(0, Math.floor(Number((p as any).effectiveMaxMana ?? (p as any).maxMana ?? (p as any).currentMana ?? 0)));
							(p as any).pv = maxPv;
							(p as any).currentMana = maxMana;
						}
					} catch {
						// ignore per member
					}
				}
				// Consume the campfire (non-stackable)
				shared.splice(invIndex, 1);
				(hero as any).inventory = shared;
				return 'Feu de camp: le groupe récupère tous ses PV et son mana.';
			}
			let msg = '';
			try {
				msg = String(item.use?.(target) ?? '');
			} catch {
				msg = "Impossible d'utiliser cet objet.";
			}
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
			const refreshAlliesPanel = () => {
				const alliesPanelEl = document.getElementById('worldAlliesPanel');
				if (!alliesPanelEl) return;
				try {
					alliesPanelEl.innerHTML = renderWorldAlliesPanel();
				} catch {
					// ignore
				}
			};

			ensureSharedInventory();
			const partyMembers = getPartyMembers();
			if (!partyMembers.length) inventorySelectedMemberIdx = 0;
			inventorySelectedMemberIdx = Math.max(0, Math.min(partyMembers.length - 1, Math.floor(inventorySelectedMemberIdx || 0)));
			const target = partyMembers[inventorySelectedMemberIdx] ?? hero;
			const inv = ((hero as any).inventory ?? []) as any[];
			const eq = (target?.equipment ?? {}) as Record<string, any>;

			const renderEquipmentRows = () => {
				const entries = Object.entries(eq).filter(([, v]) => !!v);
				if (!entries.length) return '<div style="color:#bbb;">Aucun équipement équipé.</div>';
				return entries
					.map(([slot, item]) => {
						const icon = renderItemIconHtml(item, { size: 51 });
						return `
							<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:rgba(255,255,255,0.04);padding:10px;border-radius:10px;margin-bottom:6px;">
								<div style="flex:1;display:flex;align-items:center;gap:10px;">
									${icon}
									<div style="color:#bbb;font-size:12px;">Slot: ${escapeHtml(String(slot))}</div>
								</div>
								<button class="btn" data-world-unequip-slot="${escapeHtml(String(slot))}">Retirer</button>
							</div>
						`;
					})
					.join('');
			};

			const renderInventoryRows = () => {
				if (!inv.length) return '<div style="color:#bbb;">Inventaire vide.</div>';
				return inv
					.map((item, idx) => {
						const isSelected = selectedInvIdx === idx;
						const q = Math.max(1, Math.floor(Number((item as any)?.quantity ?? 1)));
						const showQty = Boolean((item as any)?.stackable) && q > 1;
						const icon = renderItemIconHtml(item, { size: 51 });
						const isConsumable = item instanceof Consumable;
						const isCampfire = item instanceof Campfire || String((item as any)?.id ?? '') === 'feu_de_camp';
						const canUse = isConsumable || isCampfire;
						const isEquipment = item instanceof Equipment;
						const actions = isSelected
							? [
								canUse ? `<button class="btn" data-world-use-idx="${idx}">Utiliser</button>` : '',
								isEquipment ? `<button class="btn" data-world-equip-idx="${idx}">Équiper</button>` : '',
							]
								.filter(Boolean)
								.join(' ')
							: '';
						const qtyHtml = showQty ? `<span style="margin-left:2px;opacity:0.9;font-weight:900;">x${q}</span>` : '';
						return `
							<div data-world-inv-row="${idx}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;background:${isSelected ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)'};padding:10px;border-radius:10px;margin-bottom:6px;cursor:pointer;user-select:none;${isSelected ? 'outline:1px solid rgba(255,235,59,0.35);' : ''}">
								<div style="flex:1;">
									<div style="display:flex;align-items:center;gap:8px;">${icon}${qtyHtml}</div>
								</div>
								<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;min-width:180px;">${actions}</div>
							</div>
						`;
					})
					.join('');
			};

			const closeLabel = inventoryOnClose ? 'Retour' : 'Fermer';
			panel.innerHTML = `
				<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;">
					<div style="font-weight:900;font-size:18px;display:flex;align-items:center;gap:10px;">
						<span>Inventaire & Équipement</span>
					</div>
					<button class="btn" id="inventoryModalCloseBtn">${closeLabel}</button>
				</div>
				<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
					<div style="display:flex;gap:8px;align-items:center;">
						<label style="color:#ddd;">Perso:</label>
						<select id="inventoryMemberSelect">
							${partyMembers
								.map((p, idx) => `<option value="${idx}" ${idx === inventorySelectedMemberIdx ? 'selected' : ''}>${escapeHtml(String((p as any)?.name ?? `Perso ${idx + 1}`))}</option>`)
								.join('')}
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
					<div id="worldInventoryBlock" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
						<div style="font-weight:900;margin-bottom:10px;">Inventaire</div>
						${renderInventoryRows()}
					</div>
				</div>
			`;

			(panel.querySelector('#inventoryModalCloseBtn') as HTMLButtonElement | null)?.addEventListener('click', () => closeInventoryModal());

			(panel.querySelector('#inventoryMemberSelect') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
				const v = Number((e.target as HTMLSelectElement).value);
				inventorySelectedMemberIdx = Number.isFinite(v) ? v : 0;
				renderModal();
			});

			(panel.querySelectorAll('[data-world-unequip-slot]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
				btn.addEventListener('click', () => {
					const slot = btn.getAttribute('data-world-unequip-slot') ?? '';
					if (!slot) return;
					try {
						const msg = unequipToShared(target as any, slot);
						if (msg) showTemporaryMessage(String(msg), 2200);
					} catch {
						showTemporaryMessage('Impossible de retirer cet équipement.');
					}
					renderModal();
					refreshAlliesPanel();
				});
			});

			(panel.querySelectorAll('[data-world-use-idx]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
				btn.addEventListener('click', () => {
					selectedInvIdx = null;
					const idx = Number(btn.getAttribute('data-world-use-idx'));
					if (!Number.isFinite(idx)) return;
					try {
						const msg = useFromShared(target as any, idx);
						if (msg) showTemporaryMessage(String(msg), 2400);
					} catch {
						showTemporaryMessage("Impossible d'utiliser cet objet.");
					}
					renderModal();
					refreshAlliesPanel();
				});
			});

			(panel.querySelectorAll('[data-world-equip-idx]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
				btn.addEventListener('click', () => {
					selectedInvIdx = null;
					const idx = Number(btn.getAttribute('data-world-equip-idx'));
					if (!Number.isFinite(idx)) return;
					try {
						const msg = equipFromShared(target as any, idx);
						if (msg) showTemporaryMessage(String(msg), 2200);
					} catch {
						showTemporaryMessage("Impossible d'équiper cet objet.");
					}
					renderModal();
					refreshAlliesPanel();
				});
			});

			// Sélection inventaire (clic pour afficher boutons) + clic droit/clic vide pour désélectionner
			(panel.querySelectorAll('[data-world-inv-row]') as NodeListOf<HTMLElement>).forEach((row) => {
				row.addEventListener('click', (ev) => {
					const t = ev.target as HTMLElement | null;
					if (t?.closest('button')) return;
					const idx = Number(row.getAttribute('data-world-inv-row'));
					selectedInvIdx = Number.isFinite(idx) ? idx : null;
					renderModal();
				});
				row.addEventListener('contextmenu', (ev) => {
					ev.preventDefault();
					selectedInvIdx = null;
					renderModal();
				});
			});

			// Click in empty space of the inventory block => deselect
			(panel.querySelector('#worldInventoryBlock') as HTMLElement | null)?.addEventListener('click', (ev) => {
				const t = ev.target as HTMLElement | null;
				if (!t) return;
				if (t.closest('[data-world-inv-row]') || t.closest('button')) return;
				selectedInvIdx = null;
				renderModal();
			});
		};

		renderModal();
		inventoryModalEl.appendChild(panel);
		inventoryModalEl.addEventListener('click', (e) => {
			if (e.target === inventoryModalEl) closeInventoryModal();
		});
		document.body.appendChild(inventoryModalEl);
	};

	const stopMovement = () => {
		if (moveTimer != null) {
			window.clearInterval(moveTimer);
			moveTimer = null;
		}
		moveQueue = [];
		animating = false;
	};

	const startWorldNpcDialogue = (npc: { id: string; title: string; text: string; questStartId?: string }) => {
		const qm = (window as any).game?.questManager;
		const script: DialogueScript = {
			id: `world_npc:${String(npc.id ?? npc.title ?? 'npc')}`,
			start: 'start',
			nodes: {
				start: {
					id: 'start',
					speaker: String(npc.title ?? 'PNJ'),
					side: 'left',
					text: String(npc.text ?? ''),
					onEnter: (ctx) => {
						try {
							ctx.questManager?.emit?.({ type: 'talk_npc', npcId: String(npc.id ?? npc.title ?? 'npc') });
						} catch {
							// noop
						}
					},
					choices: (ctx) => {
						const choices: any[] = [];
						const qid = String(npc.questStartId ?? '').trim();
						if (qid) {
							const has = Boolean(ctx.questManager?.getProgress?.(qid));
							choices.push({
								text: has ? 'Quête déjà acceptée' : 'Accepter la quête',
								enabled: () => !has,
								onSelect: (ctx2: DialogueContext) => {
									try {
										const res = ctx2.questManager?.start?.(qid);
										if (res && (res as any).ok === false) {
											ctx2.notify?.(String((res as any).error ?? 'Quête verrouillée.'), 3800);
										} else {
											ctx2.notify?.('Quête acceptée.', 2800);
										}
									} catch {
										ctx2.notify?.('Impossible de démarrer la quête.', 2800);
									}
								},
							});
						}
						choices.push({ text: 'Fermer' });
						return choices;
					},
				},
			},
		};

		startDialogue(script, {
			questManager: qm,
			notify: (m: string, ms?: number) => showTemporaryMessage(m, ms ?? 3000),
		});
	};

	// Build a tile index for the current map (fast UI lookups)
	const tileIndexFor = (): Map<string, TileDef> => {
		const map = opts.world.currentMap;
		const m = new Map<string, TileDef>();
		for (const t of map.tiles ?? []) m.set(key(t), t);
		return m;
	};

	let tileIndex = tileIndexFor();

	// World-map encounters: if you win a fight on a tile, the enemy should disappear
	// until the next day.
	const encounterTokenFor = (mapId: unknown, x: number, y: number) => `encounter:${String(mapId)}:${x},${y}`;
	const getHeroForWorld = (): any => (getPartyMembers()[0] as any) ?? (window as any).game?.hero;
	const getHeroDay = (): number => {
		const hero = getHeroForWorld();
		const raw = Number((hero as any)?.day ?? (hero as any)?.marketDay ?? 1);
		const v = Math.floor(Number.isFinite(raw) ? raw : 1);
		return Math.max(1, v);
	};
	const getEncounterDefeatsStore = (hero: any): Record<string, Record<string, number>> => {
		if (!hero) return {};
		if (!(hero as any).__worldEncounterDefeats) (hero as any).__worldEncounterDefeats = {};
		return (hero as any).__worldEncounterDefeats as Record<string, Record<string, number>>;
	};
	const isEncounterDefeatedToday = (mapId: unknown, x: number, y: number): boolean => {
		const hero = getHeroForWorld();
		if (!hero) return false;
		const day = getHeroDay();
		const store = getEncounterDefeatsStore(hero);
		const token = encounterTokenFor(mapId, x, y);
		return Number(store?.[String(mapId)]?.[token]) === day;
	};
	const markEncounterDefeatedToday = (mapId: unknown, x: number, y: number): void => {
		const hero = getHeroForWorld();
		if (!hero) return;
		const day = getHeroDay();
		const store = getEncounterDefeatsStore(hero);
		const mid = String(mapId);
		if (!store[mid]) store[mid] = {};
		const token = encounterTokenFor(mapId, x, y);
		store[mid][token] = day;
	};
	const listHiddenEncounterTokensForMap = (mapId: unknown): string[] => {
		const hero = getHeroForWorld();
		if (!hero) return [];
		const day = getHeroDay();
		const store = getEncounterDefeatsStore(hero);
		const m = store?.[String(mapId)] ?? {};
		return Object.keys(m).filter((token) => Number((m as any)[token]) === day);
	};

	const formatHudTime = (): string => {
		const hero = getHeroForWorld();
		if (!hero) return 'Jour 1 — 00h';
		const t = getGameTime(hero);
		const hh = String(t.hour ?? 0).padStart(2, '0');
		return `Jour ${Math.max(1, Math.floor(Number(t.day ?? 1)))} — ${hh}h`;
	};
	const updateHudTime = (): void => {
		const el = document.getElementById('worldTimeHud');
		if (!el) return;
		el.textContent = formatHudTime();
	};
	const bindGameTimeListener = (): void => {
		if (gameTimeHandler) {
			try { window.removeEventListener(GAME_TIME_EVENT, gameTimeHandler as any); } catch { /* noop */ }
			gameTimeHandler = null;
		}
		gameTimeHandler = () => updateHudTime();
		try { window.addEventListener(GAME_TIME_EVENT, gameTimeHandler as any); } catch { /* noop */ }
	};

	// Random encounters: roll a chance on each tile step.
	// The encounter is picked from an enemy group already present on the map (i.e. an existing encounter tile).
	// Enemies can opt out by setting `canAmbush: false` in ENEMY_DEFS.
	const randomEncounterCandidatesForMap = (map: MapDef): TileDef[] => {
		const candidates: TileDef[] = [];
		for (const t of map.tiles ?? []) {
			if (!t?.encounter) continue;
			if (!(t.encounter.enemyId || t.encounter.enemyCount || t.encounter.enemyLevel)) continue;
			if (isEncounterDefeatedToday(map.id, t.x, t.y)) continue;
			const id = String(t.encounter.enemyId ?? 'gobelin');
			const def = (ENEMY_DEFS as any)[id];
			if (!def) continue;
			if (def.canAmbush === false) continue;
			candidates.push(t);
		}
		return candidates;
	};

	const randomEncounterChanceForMap = (map: MapDef): number => {
		const enabled = (map.meta as any)?.randomEncounters;
		if (enabled === false) return 0;
		// Default behavior: enable only on maps that define encounterLevel (avoid village, etc.)
		const hasEncounterLevel = map.meta?.encounterLevel !== undefined;
		if (!hasEncounterLevel && enabled !== true) return 0;

		const raw = Number((map.meta as any)?.randomEncounterChance);
		const v = Number.isFinite(raw) ? raw : DEFAULT_RANDOM_ENCOUNTER_CHANCE;
		return Math.max(0, Math.min(1, v));
	};

	const maybeTriggerRandomEncounterOnStep = async (tile: TileDef | null): Promise<boolean> => {
		// Don't ambush on interactive tiles (exit/NPC/event/manual encounter).
		if (tile?.exit || tile?.npc || tile?.eventId || tile?.encounter) return false;

		const map = opts.world.currentMap;
		const chance = randomEncounterChanceForMap(map);
		if (chance <= 0) return false;
		const candidates = randomEncounterCandidatesForMap(map);
		if (!candidates.length) return false;
		if (Math.random() >= chance) return false;

		// Choose one existing encounter tile to "attack" the player.
		// If the encounter is `once` and already consumed, reroll a few times.
		let chosen: TileDef | null = null;
		const remaining = candidates.slice();
		for (let i = 0; i < 6 && remaining.length; i++) {
			const idx = Math.max(0, Math.min(remaining.length - 1, Math.floor(Math.random() * remaining.length)));
			const picked = remaining.splice(idx, 1)[0] ?? null;
			if (!picked?.encounter) continue;
			if (picked.encounter.once) {
				const onceToken = `encounter:${opts.world.currentMapId}:${picked.x},${picked.y}`;
				if (!opts.world.consumeOnce(opts.world.currentMapId, onceToken)) continue;
			}
			chosen = picked;
			break;
		}
		if (!chosen?.encounter) return false;

		const enemyId = chosen.encounter.enemyId ?? 'gobelin';
		const enemyCount = chosen.encounter.enemyCount ?? 3;

		const hero = getHeroForWorld();
		const heroLevel = Math.max(1, Math.floor(Number((hero as any)?.level ?? 1)));
		const mapDefaultLevelRaw = Number(map?.meta?.encounterLevel);
		const mapDefaultLevel = Number.isFinite(mapDefaultLevelRaw) ? Math.max(1, Math.floor(mapDefaultLevelRaw)) : undefined;
		const encounterLevelRaw = chosen.encounter.enemyLevel !== undefined ? chosen.encounter.enemyLevel : (mapDefaultLevel ?? heroLevel);
		const encounterLevel = Math.max(1, Math.floor(Number(encounterLevelRaw ?? 1)));

		stopMovement();
		teardownWorldPixiOverlay();
		const mapBgSrc = map?.backgroundSrc;

		showTacticalSkirmish({
			onBack: () => render(),
			onFlee: () => render(),
			onReturnAfterCombat: () => render(),
			onCombatEnd: (outcome) => {
				if (outcome !== 'won') return;
				markEncounterDefeatedToday(opts.world.currentMapId, chosen!.x, chosen!.y);
			},
			...(mapBgSrc ? { backgroundSrc: String(mapBgSrc) } : {}),
			enemyId: enemyId as any,
			enemyCount: enemyCount,
			enemyLevel: encounterLevel,
		});
		return true;
	};

	const resolveTile = async (tile: TileDef | null) => {
		if (!tile) return;

		// Exit triggers
		if (tile.exit) {
			stopMovement();
			fade.classList.add('on');
			await sleep(fadeMs);
			opts.world.goto(tile.exit.to, tile.exit.entry);
			try {
				const hero = getHeroForWorld();
				if (hero) advanceGameTimeHours(hero, 1, { reason: 'travel_map' });
			} catch {
				// ignore
			}
			tileIndex = tileIndexFor();
			render();
			await sleep(Math.max(0, Math.floor(fadeMs * 0.75)));
			fade.classList.remove('on');
			return;
		}

		// NPC
		if (tile.npc) {
			stopMovement();
			startWorldNpcDialogue(tile.npc);
			return;
		}

		// Encounter
		if (tile.encounter && (tile.encounter.enemyId || tile.encounter.enemyCount || tile.encounter.enemyLevel)) {
			// If this encounter was already won today, don't trigger it again.
			if (isEncounterDefeatedToday(opts.world.currentMapId, tile.x, tile.y)) return;

			stopMovement();
			teardownWorldPixiOverlay();
			const onceToken = `encounter:${opts.world.currentMapId}:${tile.x},${tile.y}`;
			if (tile.encounter.once && !opts.world.consumeOnce(opts.world.currentMapId, onceToken)) return;

			const mapBgSrc = opts.world.currentMap?.backgroundSrc;

			// Encounter level priority:
			// 1) tile.encounter.enemyLevel (per encounter override)
			// 2) map.meta.encounterLevel (per map default)
			// 3) hero.level (legacy fallback)
			const hero = getHeroForWorld();
			const heroLevel = Math.max(1, Math.floor(Number((hero as any)?.level ?? 1)));
			const mapDefaultLevelRaw = Number(opts.world.currentMap?.meta?.encounterLevel);
			const mapDefaultLevel = Number.isFinite(mapDefaultLevelRaw) ? Math.max(1, Math.floor(mapDefaultLevelRaw)) : undefined;
			const encounterLevelRaw = tile.encounter.enemyLevel !== undefined ? tile.encounter.enemyLevel : (mapDefaultLevel ?? heroLevel);
			const encounterLevel = Math.max(1, Math.floor(Number(encounterLevelRaw ?? 1)));

			// IMPORTANT: showTacticalSkirmish is synchronous (UI swap). Do not call render() right after,
			// otherwise it would overwrite the combat screen immediately.
			showTacticalSkirmish({
				onBack: () => render(),
				onFlee: () => render(),
				onReturnAfterCombat: () => render(),
				onCombatEnd: (outcome) => {
					if (outcome !== 'won') return;
					markEncounterDefeatedToday(opts.world.currentMapId, tile.x, tile.y);
				},
				...(mapBgSrc ? { backgroundSrc: String(mapBgSrc) } : {}),
				enemyId: tile.encounter.enemyId ?? 'gobelin',
				enemyCount: tile.encounter.enemyCount ?? 3,
				enemyLevel: encounterLevel,
			});
			return;
		}

		if (tile.eventId) {
			stopMovement();
			teardownWorldPixiOverlay();
			if (tile.eventId === 'maison') {
				showMaisonDeplacement({ onBack: () => render() });
				return;
			}
			if (tile.eventId === 'auberge') {
				showAuberge({ onBack: () => render() });
				return;
			}
			if (tile.eventId === 'marche') {
				const hero = getPartyMembers()[0] as any;
				if (!hero) {
					showTemporaryMessage('Aucun personnage.', 1600);
					return;
				}
				showMarche({ hero, onBack: () => render() });
				return;
			}
			if (tile.eventId === 'boutique') {
				showBoutique({ onBack: () => render() });
				return;
			}
			showTemporaryMessage(`Événement: ${tile.eventId}`, 1600);
		}
	};

	const renderWorldAlliesPanel = (): string => {
		const party = getPartyMembers();
		if (!party.length) return '<div style="color:#bbb;">(Équipe vide)</div>';

		return party
			.map((m: any, idx: number) => {
				const name = escapeHtml(String(m?.name ?? `Allié ${idx + 1}`));
				const maxPv = Math.max(1, Math.floor(Number(m?.effectiveMaxPv ?? m?.maxPv ?? 1)));
				const pv = Math.max(0, Math.floor(Number(m?.pv ?? 0)));
				const maxMana = Math.max(0, Math.floor(Number(m?.effectiveMaxMana ?? m?.maxMana ?? 0)));
				const mana = Math.max(0, Math.floor(Number(m?.currentMana ?? 0)));
				const hpPct = maxPv > 0 ? Math.max(0, Math.min(100, (pv / maxPv) * 100)) : 0;
				const manaPct = maxMana > 0 ? Math.max(0, Math.min(100, (mana / maxMana) * 100)) : 0;
				const cls = escapeHtml(String(m?.characterClass ?? ''));
				const level = Math.max(1, Math.floor(Number(m?.level ?? 1)));

				return `
					<div style="padding:10px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
						<div class="hp-label" style="margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
							<span><b>${name}</b> <span style="opacity:0.8;font-size:0.9em;">(niv ${level}${cls ? ` ${cls}` : ''})</span></span>
						</div>
						<div class="hp-bar-container"><div class="hp-bar player" style="width:${hpPct}%;"></div><div class="bar-label">${pv}/${maxPv}</div></div>
						${maxMana > 0 ? `<div class="mana-bar-container"><div class="mana-bar" style="width:${manaPct}%;"></div><div class="bar-label">${mana}/${maxMana}</div></div>` : ''}
					</div>
				`;
			})
			.join('');
	};

	const render = () => {
		const map = opts.world.currentMap;
		const pos = opts.world.playerPos;
		const randomEncounterChance = randomEncounterChanceForMap(map);
		const randomEncounterChancePct = Math.round(Math.max(0, Math.min(1, randomEncounterChance)) * 100);
		const hudTime = formatHudTime();

		// Pixi board mode: when available, avoid generating the heavy DOM tile grid.
		// The DOM stays as an overlay UI (HUD + side panels) only.
		const pixiLayer = Boolean((window as any).PIXI) ? ensureWorldPixiScreen() : null;
		const wantPixiBoard = Boolean((window as any).PIXI) && Boolean(pixiLayer);

		// Optional board translate overrides (percent number or string like '0%').
		// Prefer per-map overrides (`map.meta.boardTranslateX/Y`) if provided.
		const boardTranslateX = map.meta?.boardTranslateX ?? opts.layout?.boardTranslateX;
		const boardTranslateY = map.meta?.boardTranslateY ?? opts.layout?.boardTranslateY;
		let boardTranslateXStr = '';
		let boardTranslateYStr = '';
		if (boardTranslateX !== undefined) {
			boardTranslateXStr = typeof boardTranslateX === 'number' ? `${boardTranslateX}%` : String(boardTranslateX);
		}
		if (boardTranslateY !== undefined) {
			boardTranslateYStr = typeof boardTranslateY === 'number' ? `${boardTranslateY}%` : String(boardTranslateY);
		}
		const boardScale = map.meta?.boardScale ?? opts.layout?.boardScale;
		const cssParts: string[] = [];
		// If either axis is provided, set translate(x, y). Default missing axis to 0%.
		if (boardTranslateXStr || boardTranslateYStr) {
			const tx = boardTranslateXStr || '0%';
			const ty = boardTranslateYStr || '0%';
			cssParts.push(`transform: translate(${tx}, ${ty})`);
		}
		if (boardScale !== undefined) cssParts.push(`--boardScale: ${boardScale}`);
		const boardStyle = cssParts.length ? ` style="${cssParts.join('; ')};"` : '';
		// World maps: disable the decorative dark underlay by default.
		// (Combat has its own renderer/styles; this file only affects world maps.)
		const disableOverlay = map.meta?.disableOverlay ?? true;
		const noOverlayClass = disableOverlay ? ' no-board-overlay' : '';

		app.innerHTML = `
			<div class="tactical-wrap">
				<div class="tactical-hud">
					<div class="tactical-panel" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
						<div style="display:flex;flex-direction:column;gap:2px;">
							<div id="worldTimeHud" style="font-size:12px;opacity:0.78;">${escapeHtml(hudTime)}</div>
							<div style="font-weight:900;">${escapeHtml(String(map.meta?.displayName ?? map.name))}</div>
							<div style="font-size:12px;opacity:0.78;">Attaques aléatoires: <b>${randomEncounterChancePct}%</b></div>
						</div>
						<div style="margin-left:auto;display:flex;gap:10px;align-items:center;">
							<button class="btn" id="plateauBackBtn">Retour</button>
						</div>
					</div>
				</div>

				<div class="tactical-main">
					<div class="tactical-side">
						<div class="tactical-panel team-panel" id="worldAlliesPanel">${renderWorldAlliesPanel()}</div>
					</div>

					<div class="tactical-center plateau-overflow">
						<div class="plateau-board-wrap${noOverlayClass}"${boardStyle}>
							<img src="${escapeHtml(String(map.backgroundSrc ?? ''))}" class="plateau-bg" alt="${escapeHtml(map.name)}">
							<div class="tactical-grid plateau-grid iso" id="${GRID_ID}" aria-label="Carte">
								${wantPixiBoard
									? ''
									: Array.from({ length: map.w * map.h })
										.map((_, i) => {
											const x = i % map.w;
											const y = Math.floor(i / map.w);
											const t = getTile(map, tileIndex, x, y);
											const isBlocked = Boolean(t?.blocked);
											const hasExit = Boolean(t?.exit);
											const hasNpc = Boolean(t?.npc);
											const hasCombat = Boolean(t?.encounter) && !isEncounterDefeatedToday(map.id, x, y);
											const isInteractive = hasExit || hasNpc || hasCombat || Boolean(t?.eventId);

											const marker = hasExit
												? `<div class="plateau-marker exit ${escapeHtml(String(t?.exit?.dir ?? ''))}" title="${escapeHtml(String(t?.exit?.label ?? 'Sortie'))}"></div>`
												: hasNpc
													? `<div class="plateau-marker npc" title="Parler"></div>`
													: t?.eventId === 'maison'
														? `<div class="plateau-marker house" title="Maison"></div>`
														: t?.eventId === 'auberge'
															? `<div class="plateau-marker inn" title="Auberge"></div>`
															: t?.eventId === 'marche'
																? `<div class="plateau-marker market" title="Marché"></div>`
															: t?.eventId === 'boutique'
																? `<div class="plateau-marker shop" title="Boutique"></div>`
															: hasCombat
																? (() => {
																	const eid = t?.encounter?.enemyId ?? 'gobelin';
																	const imgSrc = enemyImageSrc(eid);
																	return `<div class="plateau-marker combat" title="Combat"><img class="plateau-marker-enemy" src="${escapeHtml(String(imgSrc))}" alt="${escapeHtml(String(eid))}"></div>`;
																})()
																: '';

											const content = x === pos.x && y === pos.y ? renderLeader() : marker;

											return `<div class="tile ${isBlocked ? 'blocked' : ''} ${isInteractive ? 'interactive' : ''}" data-x="${x}" data-y="${y}"><div class="tile-bg" aria-hidden="true"></div>${content}</div>`;
										})
										.join('')}
							</div>
						</div>
					</div>

					<div class="tactical-side tactical-side-right"></div>
				</div>
			</div>
		`;

		(document.getElementById('plateauBackBtn') as HTMLButtonElement | null)?.addEventListener('click', () => {
			stopMovement();
			closeInventoryModal({ silent: true });
			closeHubModal();
			if (gameTimeHandler) {
				try { window.removeEventListener(GAME_TIME_EVENT, gameTimeHandler as any); } catch { /* noop */ }
				gameTimeHandler = null;
			}
			if (pixiMountedHandler) {
				try { window.removeEventListener('pixiMounted', pixiMountedHandler as any); } catch { /* noop */ }
				pixiMountedHandler = null;
			}
			if (pixiTileClickHandler) {
				try { window.removeEventListener('worldTileClick', pixiTileClickHandler as any); } catch { /* noop */ }
				pixiTileClickHandler = null;
			}
			if (pixiLeaderClickHandler) {
				try { window.removeEventListener('worldLeaderClick', pixiLeaderClickHandler as any); } catch { /* noop */ }
				pixiLeaderClickHandler = null;
			}
			if (pixiResizeHandler) {
				try { window.removeEventListener('resize', pixiResizeHandler as any); } catch { /* noop */ }
				pixiResizeHandler = null;
			}
			try { unmountBattleCanvas(); } catch { /* noop */ }
			if (worldPixiScreenEl) {
				try { worldPixiScreenEl.remove(); } catch { /* noop */ }
				worldPixiScreenEl = null;
			}
			fade.remove();
			opts.onBack();
		});

		bindGameTimeListener();
		updateHudTime();

		const grid = document.getElementById(GRID_ID) as HTMLElement | null;
		if (!grid) return;

		scheduleIsoLayout(app, grid, map.w, map.h, opts.layout, map);

		// Pixi board mode (keeps UI DOM, renders the board + markers + leader in Pixi).
		// Pixi canvas is fullscreen, but the *board* must match the DOM grid position.
		// By default we render the board fullscreen (so side panels/HUD can overlay without pushing the board).
		// If you ever need strict DOM-grid alignment again, reintroduce grid.getBoundingClientRect() here.
		const getPixiBoardRect = () => {
			const vw = Math.max(1, Math.floor(Number(window.innerWidth ?? 1)));
			const vh = Math.max(1, Math.floor(Number(window.innerHeight ?? 1)));
			const rawScale = Number(map?.meta?.pixiBoardScale ?? map?.meta?.boardScale ?? opts.layout?.boardScale ?? 0.6);
			const scale = Math.max(0.35, Math.min(1.0, Number.isFinite(rawScale) ? rawScale : 0.6));
			const w = Math.max(1, Math.floor(vw * scale));
			const h = Math.max(1, Math.floor(vh * scale));
			const left = Math.floor((vw - w) / 2);
			const top = Math.floor((vh - h) / 2);
			return { left, top, width: w, height: h };
		};
		if (wantPixiBoard) {
			const tacticalWrap = grid.closest('.tactical-wrap') as HTMLElement | null;
			tacticalWrap?.classList.add('pixi-world-ui');
			const wrap = grid.closest('.plateau-board-wrap') as HTMLElement | null;
			wrap?.classList.add('pixi-board-wrap');
			const centerCol = grid.closest('.tactical-center') as HTMLElement | null;
			centerCol?.classList.add('pixi-board-center');
			grid.classList.add('pixi-board');
			grid.classList.add('pixi-leader');
			ensureWorldMapPixiListenerBound();
			mountPixiCanvas(PIXI_CONTAINER_ID);
			if (pixiResizeHandler) {
				try { window.removeEventListener('resize', pixiResizeHandler as any); } catch { /* noop */ }
				pixiResizeHandler = null;
			}
			pixiResizeHandler = () => {
				try {
					const r = getPixiBoardRect();
					window.dispatchEvent(new CustomEvent('worldPixiInit', {
						detail: {
							containerId: PIXI_CONTAINER_ID,
							map,
							boardRect: { left: r.left, top: r.top, width: r.width, height: r.height },
							hiddenEncounterTokens: listHiddenEncounterTokensForMap(map.id),
						},
					}));
				} catch {
					// ignore
				}
			};
			try { window.addEventListener('resize', pixiResizeHandler as any); } catch { /* noop */ }
			try {
				const r = getPixiBoardRect();
				window.dispatchEvent(new CustomEvent('worldPixiInit', {
					detail: {
						containerId: PIXI_CONTAINER_ID,
						map,
						boardRect: { left: r.left, top: r.top, width: r.width, height: r.height },
						hiddenEncounterTokens: listHiddenEncounterTokensForMap(map.id),
					},
				}));
			} catch {
				// ignore
			}
		}

		const dispatchPixiLeader = (payload: {
			x: number;
			y: number;
			tileW: number;
			tileH: number;
			characterClass: string;
			dir: ReturnType<typeof getMoveDir>;
			frameIndex: number;
			frameSrc?: string;
			idleSrc: string;
			moving: boolean;
			visible?: boolean;
		}) => {
			try {
				window.dispatchEvent(new CustomEvent('worldPixiLeader', { detail: { containerId: PIXI_CONTAINER_ID, ...payload } }));
			} catch {
				// ignore
			}
		};

		const markerHtmlForPos = (x: number, y: number): string => {
			const t = getTile(map, tileIndex, x, y);
			const hasExit = Boolean(t?.exit);
			const hasNpc = Boolean(t?.npc);
			const hasCombat = Boolean(t?.encounter) && !isEncounterDefeatedToday(map.id, x, y);
			if (hasExit) {
				return `<div class="plateau-marker exit ${escapeHtml(String(t?.exit?.dir ?? ''))}" title="${escapeHtml(String(t?.exit?.label ?? 'Sortie'))}"></div>`;
			}
			if (hasNpc) return `<div class="plateau-marker npc" title="Parler"></div>`;
			if (t?.eventId === 'maison') return `<div class="plateau-marker house" title="Maison"></div>`;
			if (t?.eventId === 'auberge') return `<div class="plateau-marker inn" title="Auberge"></div>`;
			if (t?.eventId === 'marche') return `<div class="plateau-marker market" title="Marché"></div>`;
			if (t?.eventId === 'boutique') return `<div class="plateau-marker shop" title="Boutique"></div>`;
			if (hasCombat) {
				const eid = t?.encounter?.enemyId ?? 'gobelin';
				const imgSrc = enemyImageSrc(eid);
				return `<div class="plateau-marker combat" title="Combat"><img class="plateau-marker-enemy" src="${escapeHtml(String(imgSrc))}" alt="${escapeHtml(String(eid))}"></div>`;
			}
			return '';
		};

		const moveLeaderDom = (from: { x: number; y: number }, to: { x: number; y: number }) => {
			const fromTileEl = grid.querySelector(`.tile[data-x="${from.x}"][data-y="${from.y}"]`) as HTMLElement | null;
			const toTileEl = grid.querySelector(`.tile[data-x="${to.x}"][data-y="${to.y}"]`) as HTMLElement | null;
			if (!fromTileEl || !toTileEl) return;

			let leaderEl = fromTileEl.querySelector('[data-open-hub="1"]') as HTMLElement | null;
			if (!leaderEl) {
				// Fallback: find any leader element and reuse it.
				leaderEl = grid.querySelector('[data-open-hub="1"]') as HTMLElement | null;
			}
			if (!leaderEl) return;

			// Remove any marker from destination (the player standing there replaces it).
			toTileEl.querySelectorAll('.plateau-marker').forEach((n) => n.remove());
			// Remove any marker from source too, then restore correct marker.
			fromTileEl.querySelectorAll('.plateau-marker').forEach((n) => n.remove());

			try {
				toTileEl.appendChild(leaderEl);
			} catch {
				// ignore
			}

			const markerHtml = markerHtmlForPos(from.x, from.y);
			if (markerHtml) {
				try {
					fromTileEl.insertAdjacentHTML('beforeend', markerHtml);
				} catch {
					// ignore
				}
			}
		};

		const computeIsoLayoutLocal = () => {
			const rect = wantPixiBoard
				? (getPixiBoardRect() as any)
				: grid.getBoundingClientRect();
			const gridW = rect.width;
			const gridH = rect.height;
			const cols = map.w;
			const rows = map.h;
			// Keep in sync with scheduleIsoLayout().
			const meta: any = (map as any)?.meta ?? {};
			const SCALE = Math.max(0.6, Math.min(2.2, Number(meta?.isoScale ?? opts.layout?.isoScale ?? 0.85)));
			const ASPECT = Math.max(0.35, Math.min(0.9, Number(meta?.tileAspect ?? opts.layout?.tileAspect ?? 0.68)));
			const pad = 10;
			const gap = Math.max(0, Math.floor(Number(meta?.tileGap ?? 2)));

			const baseTileW = Math.max(26, (gridW - pad * 2 - gap * (cols - 1)) / Math.max(4, cols));
			const tileW = Math.max(28, Math.floor(baseTileW * SCALE));
			const tileH = Math.max(16, Math.floor(tileW * ASPECT));
			const halfW = tileW / 2;
			const halfH = tileH / 2;

			const isoGapX = Math.max(0, Math.floor(gap * 1.0));
			const isoGapY = Math.max(0, Math.floor(gap * 0.65));
			const stepW = halfW + isoGapX;
			const stepH = halfH + isoGapY;

			const minX = -(rows - 1) * stepW;
			const maxX = (cols - 1) * stepW;
			const minY = 0;
			const maxY = (cols + rows - 2) * stepH;
			const fullW = maxX - minX + tileW;
			const fullH = maxY - minY + tileH;
			const wantTopLeft = wantPixiBoard && String(meta?.boardOrigin ?? '') === 'topleft';
			const offsetX = wantTopLeft ? (pad + tileW / 2 - minX) : ((gridW - fullW) / 2 + tileW / 2 - minX);
			const offsetY = wantTopLeft ? (pad + tileH / 2 - minY) : ((gridH - fullH) / 2 + tileH / 2 - minY);

			return { tileW, tileH, stepW, stepH, offsetX, offsetY };
		};

		const tilePosPxIso = (p: { x: number; y: number }) => {
			const L = computeIsoLayoutLocal();
			const gridRect = wantPixiBoard ? (getPixiBoardRect() as any) : grid.getBoundingClientRect();
			const cx = L.offsetX + (p.x - p.y) * L.stepW;
			const cy = L.offsetY + (p.x + p.y) * L.stepH;
			// Pixi layer is fullscreen: coordinates are in screen space.
			return { left: gridRect.left + (cx - L.tileW / 2), top: gridRect.top + (cy - L.tileH / 2), w: L.tileW, h: L.tileH };
		};

		const syncPixiLeaderIdle = () => {
			if (!wantPixiBoard) return;
			if (!(window as any).__pixiApp) return;

			const p = opts.world.playerPos;
			const px = tilePosPxIso(p);
			const leader = getPartyMembers().slice(0, 1)[0] as any;
			const cls = String(leader?.characterClass ?? '').toLowerCase();
			const idleSrc = leaderSpriteSrc();
			dispatchPixiLeader({
				x: px.left,
				y: px.top,
				tileW: px.w,
				tileH: px.h,
				characterClass: cls,
				dir: 'none' as any,
				frameIndex: 0,
				idleSrc,
				moving: false,
				visible: true,
			});
		};

		if (pixiMountedHandler) {
			try { window.removeEventListener('pixiMounted', pixiMountedHandler as any); } catch { /* noop */ }
			pixiMountedHandler = null;
		}
		if (wantPixiBoard) {
			pixiMountedHandler = () => {
				try {
					const r = getPixiBoardRect();
					window.dispatchEvent(new CustomEvent('worldPixiInit', {
						detail: {
							containerId: PIXI_CONTAINER_ID,
							map,
							boardRect: { left: r.left, top: r.top, width: r.width, height: r.height },
							hiddenEncounterTokens: listHiddenEncounterTokensForMap(map.id),
						},
					}));
				} catch { /* noop */ }
				syncPixiLeaderIdle();
			};
			try { window.addEventListener('pixiMounted', pixiMountedHandler as any); } catch { /* noop */ }
			setTimeout(() => syncPixiLeaderIdle(), 0);
		}

		if (!wantPixiBoard) {
			// Clicking the leader sprite opens the hub modal (DOM mode).
			(grid.querySelectorAll('[data-open-hub="1"]') as NodeListOf<HTMLElement>).forEach((el) => {
				el.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (animating) return;
					openHubModal();
				});
			});
		} else {
			// Pixi mode: leader click comes from Pixi.
			if (pixiLeaderClickHandler) {
				try { window.removeEventListener('worldLeaderClick', pixiLeaderClickHandler as any); } catch { /* noop */ }
				pixiLeaderClickHandler = null;
			}
			pixiLeaderClickHandler = () => {
				if (animating) return;
				openHubModal();
			};
			try { window.addEventListener('worldLeaderClick', pixiLeaderClickHandler as any); } catch { /* noop */ }
		}

		const startMoveTo = (tx: number, ty: number) => {
			if (animating) return;
			if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;

			const path = opts.world.computePath({ x: tx, y: ty }, { allowEnterBlockedDestination: Boolean(opts.movement?.allowEnterBlockedDestination) });
				if (!path.length) {
					showTemporaryMessage('Chemin bloqué.', 1600);
					return;
				}

				moveQueue = path;
				animating = true;

				// Requested: 2x faster movement between tiles.
				const MOVE_SPEED_MULT = 2;
				const baseStepMsRaw = Number(opts.movement?.stepMs ?? map.meta?.moveStepMs ?? 220);
				const baseStepMs = Math.max(30, Math.floor(Number.isFinite(baseStepMsRaw) ? baseStepMsRaw : 220));
				const stepMs = Math.max(20, Math.floor(baseStepMs / MOVE_SPEED_MULT));

				if (moveTimer != null) window.clearInterval(moveTimer);
				moveTimer = null;

				// Animate movement and apply world steps sequentially.
				(async () => {
					const canUsePixiForMove = wantPixiBoard && Boolean((window as any).__pixiApp);
					const gridRect = grid.getBoundingClientRect();
					const fromTile = wantPixiBoard ? null : (grid.querySelector(`.tile[data-x="${opts.world.playerPos.x}"][data-y="${opts.world.playerPos.y}"]`) as HTMLElement | null);
					const unitEl = fromTile ? (fromTile.querySelector('.unit-badge, .unit-sprite-wrap, .unit-sprite')?.closest('div') as HTMLElement | null) : null;
					const fromRect = fromTile ? fromTile.getBoundingClientRect() : null;

					const tilePosPx = (p: { x: number; y: number }) => {
						if (wantPixiBoard) return tilePosPxIso(p);
						const t = grid.querySelector(`.tile[data-x="${p.x}"][data-y="${p.y}"]`) as HTMLElement | null;
						if (!t) return null;
						const r = t.getBoundingClientRect();
						return { left: r.left - gridRect.left, top: r.top - gridRect.top, w: r.width, h: r.height };
					};

					const leader = getPartyMembers().slice(0, 1)[0] as any;
					const cls = String(leader?.characterClass ?? '').toLowerCase();
					const idleSrc = leaderSpriteSrc();
					const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

					if (canUsePixiForMove) {
						try {
							if (unitEl) unitEl.style.opacity = '0';
							let prev = { x: opts.world.playerPos.x, y: opts.world.playerPos.y };
							for (const next of path) {
								if (!animating) return;
								const fromPx = tilePosPx(prev);
								const toPx = tilePosPx(next);
								if (!fromPx || !toPx) {
									const ok = opts.world.tryStepTo(next);
									if (!ok) {
										showTemporaryMessage('Bloqué.', 1200);
										return;
									}
									const steppedTile = opts.world.getTileAt(opts.world.playerPos);
									if (await maybeTriggerRandomEncounterOnStep(steppedTile)) return;
									prev = next;
									continue;
								}

								let segMs = Math.max(60, Math.floor(stepMs));
								const dir = getMoveDir(prev, next);
								const minWalkMs = getWalkAnimMinDurationMs(cls, dir);
								const minWalkMsScaled = minWalkMs > 0 ? Math.max(0, Math.floor(minWalkMs / MOVE_SPEED_MULT)) : 0;
								if (minWalkMsScaled > 0) segMs = Math.max(segMs, minWalkMsScaled);

								const walk = getWalkCycle(cls, dir);
								const cycle = walk?.cycle;
								const frameMs = Math.max(40, Math.floor(Number(walk?.frameMs ?? 250) / MOVE_SPEED_MULT));
								const start = performance.now();
								while (true) {
									if (!animating) return;
									const now = performance.now();
									const t = Math.min(segMs, Math.max(0, now - start));
									const a = segMs > 0 ? Math.min(1, t / segMs) : 1;
									const x = lerp(fromPx.left, toPx.left, a);
									const y = lerp(fromPx.top, toPx.top, a);
									const frameIndex = Math.floor(t / frameMs);
									const frameSrc = cycle?.length ? String(cycle[frameIndex % cycle.length] ?? idleSrc) : idleSrc;
									dispatchPixiLeader({
										x,
										y,
										tileW: fromPx.w,
										tileH: fromPx.h,
										characterClass: cls,
										dir,
										frameIndex,
										frameSrc,
										idleSrc,
										moving: true,
										visible: true,
									});
									if (a >= 1) break;
									await raf();
								}

								const ok = opts.world.tryStepTo(next);
								if (!ok) {
									showTemporaryMessage('Bloqué.', 1200);
									return;
								}
								const steppedTile = opts.world.getTileAt(opts.world.playerPos);
								if (await maybeTriggerRandomEncounterOnStep(steppedTile)) return;
								prev = next;
							}

							syncPixiLeaderIdle();

							const finalTile = opts.world.getTileAt(opts.world.playerPos);
							if (finalTile?.exit || finalTile?.npc || finalTile?.encounter || finalTile?.eventId) {
								await resolveTile(finalTile);
								return;
							}
						} finally {
							try { if (unitEl) unitEl.style.opacity = ''; } catch { /* ignore */ }
							animating = false;
						}
						return;
					}

					// DOM-only movement requires tiles to exist.
					if (!fromTile || !fromRect) {
							for (const p of path) {
								const ok = opts.world.tryStepTo(p);
								if (!ok) continue;
								const steppedTile = opts.world.getTileAt(opts.world.playerPos);
								if (await maybeTriggerRandomEncounterOnStep(steppedTile)) return;
							}
						render();
						animating = false;
						return;
					}

					// Fallback (no Pixi ready): use the original DOM ghost animation.
					const startPx = { left: fromRect.left - gridRect.left, top: fromRect.top - gridRect.top };
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
						ghost.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${escapeHtml(String((getPartyMembers()[0] as any)?.name ?? 'Leader'))}</div>`;
					}

					let activeDir: ReturnType<typeof getMoveDir> = 'none' as any;
					let activeAnim: { stop: () => void } | null = null;

					grid.appendChild(ghost);
					try {
						let prev = { x: opts.world.playerPos.x, y: opts.world.playerPos.y };
						for (const next of path) {
							const fromPx = tilePosPx(prev);
							const toPx = tilePosPx(next);
							if (!fromPx || !toPx) {
								const ok = opts.world.tryStepTo(next);
								if (!ok) {
									showTemporaryMessage('Bloqué.', 1200);
									return;
								}
								const steppedTile = opts.world.getTileAt(opts.world.playerPos);
								if (await maybeTriggerRandomEncounterOnStep(steppedTile)) return;
								prev = next;
								continue;
							}

							let segMs = Math.max(60, Math.floor(stepMs));
							const dir = getMoveDir(prev, next);
							const minWalkMs = getWalkAnimMinDurationMs(cls, dir);
							const minWalkMsScaled = minWalkMs > 0 ? Math.max(0, Math.floor(minWalkMs / MOVE_SPEED_MULT)) : 0;
							if (minWalkMsScaled > 0) segMs = Math.max(segMs, minWalkMsScaled);

							if (dir !== activeDir) {
								activeAnim?.stop();
								activeAnim = null;
								activeDir = dir;
								if (minWalkMsScaled > 0) {
									activeAnim = startWalkSpriteAnimation({ container: ghost, characterClass: cls, dir });
								}
							}
							const anim = ghost.animate(
								[
									{ transform: `translate(${fromPx.left}px, ${fromPx.top}px)` },
									{ transform: `translate(${toPx.left}px, ${toPx.top}px)` },
								],
								{ duration: segMs, easing: 'linear', fill: 'forwards' }
							);

							// @ts-ignore
							await (anim.finished ?? new Promise<void>((resolve) => anim.addEventListener('finish', () => resolve())));

							const ok = opts.world.tryStepTo(next);
							if (!ok) {
								try { anim.cancel(); } catch { /* ignore */ }
								showTemporaryMessage('Bloqué.', 1200);
								return;
							}
							const steppedTile = opts.world.getTileAt(opts.world.playerPos);
							if (await maybeTriggerRandomEncounterOnStep(steppedTile)) return;
							prev = next;
						}

						render();

						const finalTile = opts.world.getTileAt(opts.world.playerPos);
						if (finalTile?.exit || finalTile?.npc || finalTile?.encounter || finalTile?.eventId) {
							await resolveTile(finalTile);
							return;
						}
					} finally {
						activeAnim?.stop();
						ghost.remove();
						if (unitEl) unitEl.style.opacity = '';
						try { syncPixiLeaderIdle(); } catch { /* ignore */ }
						animating = false;
					}
				})();
		};

		if (!wantPixiBoard) {
			(grid.querySelectorAll('.tile[data-x][data-y]') as NodeListOf<HTMLElement>).forEach((tile) => {
				tile.addEventListener('click', () => {
					const tx = Number(tile.dataset.x);
					const ty = Number(tile.dataset.y);
					startMoveTo(tx, ty);
				});
			});
		} else {
			if (pixiTileClickHandler) {
				try { window.removeEventListener('worldTileClick', pixiTileClickHandler as any); } catch { /* noop */ }
				pixiTileClickHandler = null;
			}
			pixiTileClickHandler = (ev: any) => {
				const d = (ev as CustomEvent<any>)?.detail;
				const tx = Number(d?.x);
				const ty = Number(d?.y);
				startMoveTo(tx, ty);
			};
			try { window.addEventListener('worldTileClick', pixiTileClickHandler as any); } catch { /* noop */ }
		}
	};

	// Optional start map placement
	if (opts.start) {
		try {
			opts.world.goto(opts.start.mapId as any, opts.start.entry);
			tileIndex = tileIndexFor();
		} catch {
			// ignore
		}
	}

	render();
}
