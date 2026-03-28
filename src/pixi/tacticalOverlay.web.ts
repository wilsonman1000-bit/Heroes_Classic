import type { Application } from "pixi.js";
import { getIdleSpriteSrc, getWalkCycle, type MoveDir } from "../characterSprites.web.js";

type OverlayState = {
	bgLayer: any;
	bgSprite: any;
	bgMask: any;
	bgUrl: string;
	root: any;
	grid: any;
	unitsGfx: any;
	unitsLayer: any;
	labels: any;
	spritesByUnitId: Map<string, any>;
};

type MovingUnitPos = {
	x: number;
	y: number;
	tileW: number;
	tileH: number;
};

const movingPosByUnitId = new Map<string, MovingUnitPos>();
const movingFrameSrcByUnitId = new Map<string, string>();
const moveEndTimeoutByUnitId = new Map<string, number>();
let moveListenerBound = false;

function ensureMoveListenerBound(): void {
	if (moveListenerBound) return;
	moveListenerBound = true;

	// Movement animation emits per-frame positions (in grid-local pixels).
	window.addEventListener('tacticalPixiMove', (ev: any) => {
		const d = ev?.detail as
			| {
					unitId: string;
					x: number;
					y: number;
					tileW: number;
					tileH: number;
					characterClass: string;
					dir: MoveDir;
					frameIndex: number;
					phase: 'tick' | 'end';
			  }
			| undefined;
		if (!d?.unitId) return;
		if (d.phase === 'end') {
			const id = String(d.unitId);
			const prevT = moveEndTimeoutByUnitId.get(id);
			if (prevT) {
				try {
					clearTimeout(prevT);
				} catch {
					// noop
				}
			}
			const t = window.setTimeout(() => {
				movingPosByUnitId.delete(id);
				movingFrameSrcByUnitId.delete(id);
				moveEndTimeoutByUnitId.delete(id);
			}, 80);
			moveEndTimeoutByUnitId.set(id, t as any);

			// Push idle frame immediately to avoid a visible "walk" frame lingering at the end.
			try {
				const app = getApp() as any;
				const overlay = app ? ((app as any).__tacticalOverlay as OverlayState | undefined) : undefined;
				const sprite = overlay?.spritesByUnitId?.get(id);
				const PIXI = (window as any).PIXI;
				if (sprite && PIXI) {
					const idle = getIdleSpriteSrc(String(d.characterClass ?? '').toLowerCase());
					if (idle) {
						const abs = new URL(idle, window.location.href).toString();
						setSpriteSourceAsync(PIXI, sprite, abs);
					}
				}
			} catch {
				// noop
			}
			return;
		}

		// Cancel any pending end cleanup when a new tick arrives.
		{
			const id = String(d.unitId);
			const prevT = moveEndTimeoutByUnitId.get(id);
			if (prevT) {
				try {
					clearTimeout(prevT);
				} catch {
					// noop
				}
				moveEndTimeoutByUnitId.delete(id);
			}
		}
		if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
		movingPosByUnitId.set(String(d.unitId), {
			x: d.x,
			y: d.y,
			tileW: Number.isFinite(d.tileW) ? d.tileW : 0,
			tileH: Number.isFinite(d.tileH) ? d.tileH : 0,
		});

		// Apply immediately if the sprite exists, so the movement feels real-time.
		try {
			const app = getApp() as any;
			const overlay = app ? ((app as any).__tacticalOverlay as OverlayState | undefined) : undefined;
			const sprite = overlay?.spritesByUnitId?.get(String(d.unitId));
			const PIXI = (window as any).PIXI;
			if (sprite) {
				const tileH = Number.isFinite(d.tileH) ? d.tileH : 0;
				sprite.x = d.x;
				sprite.y = d.y + tileH * 0.15;

				if (PIXI) {
					const cls = String(d.characterClass ?? '').toLowerCase();
					const dir = (d.dir ?? 'none') as MoveDir;
					const walk = getWalkCycle(cls, dir);
					const idle = getIdleSpriteSrc(cls);
					const cycle = walk?.cycle?.length ? walk.cycle : idle ? [idle] : [];
					if (cycle.length) {
						const idx = Math.max(0, Math.floor(Number(d.frameIndex ?? 0))) % cycle.length;
						const raw = String(cycle[idx] ?? '').trim();
						if (raw) {
							let abs = raw;
							try {
								abs = new URL(raw, window.location.href).toString();
							} catch {
								// keep raw
							}
							const prev = movingFrameSrcByUnitId.get(String(d.unitId));
							if (prev !== abs) {
								movingFrameSrcByUnitId.set(String(d.unitId), abs);
								setSpriteSourceAsync(PIXI, sprite, abs);
							}
						}
					}
				}
			}
		} catch {
			// noop
		}
	});
}

// In iso view, the DOM grid can overflow its own bounds.
// We render Pixi on a slightly larger canvas (see CSS) and offset the stage root to keep coordinates aligned.
const PIXI_CANVAS_PAD = 800;

// Mask margin so the board background is never clipped.
// User request: mask should cover "all screen".
const PIXI_BG_MASK_MARGIN = 4000;

// Extra scale applied to the board background image in Pixi.
// Keep at 1.0 by default: the combat background is scaled to the viewport;
// extra scaling tends to feel "too zoomed".
const PIXI_BOARD_BG_EXTRA_SCALE = 1.0;

let assetsInitDone = false;
const texturePromiseByUrl = new Map<string, Promise<any>>();
const textureByUrl = new Map<string, any>();

function ensureAssetsInit(PIXI: any): void {
	if (assetsInitDone) return;
	assetsInitDone = true;
	try {
		// Safe no-op if not needed; Pixi v8 Assets exists.
		if (PIXI?.Assets?.init) {
			PIXI.Assets.init({
				basePath: '',
			});
		}
	} catch (e) {
		// Non-fatal
		console.warn('[pixi] Assets.init failed (non-fatal)', e);
	}
}

function loadTexture(PIXI: any, url: string): Promise<any> {
	const key = String(url);
	const ready = textureByUrl.get(key);
	if (ready) return Promise.resolve(ready);
	const existing = texturePromiseByUrl.get(key);
	if (existing) return existing;
	const p = (async () => {
		ensureAssetsInit(PIXI);
		if (!PIXI?.Assets?.load) {
			// Fallback: Texture.from (may still async-load depending on Pixi build)
			return PIXI.Texture.from(key);
		}
		return PIXI.Assets.load(key);
	})()
		.then((asset: any) => {
			try {
				textureByUrl.set(key, asset);
			} catch {
				// noop
			}
			return asset;
		})
		.catch((e) => {
		texturePromiseByUrl.delete(key);
		throw e;
	});
	texturePromiseByUrl.set(key, p);
	return p;
}

function setSpriteSourceAsync(PIXI: any, sprite: any, url: string): void {
	const target = String(url);
	if (!target) return;
	const prev = String(sprite.__src ?? '');
	if (prev === target && sprite.__srcApplied) return;

	// If already cached/resolved, apply synchronously to avoid a 1-frame WHITE flash.
	const ready = textureByUrl.get(target);
	if (ready) {
		sprite.__src = target;
		sprite.__srcApplied = true;
		sprite.__everApplied = true;
		try {
			sprite.texture = ready;
		} catch {
			try {
				const tex = ready?.baseTexture || ready?.texture || ready;
				sprite.texture = tex;
			} catch {
				// noop
			}
		}
		return;
	}

	sprite.__src = target;
	sprite.__srcApplied = false;
	// Keep current texture while loading (avoid visible flashes at action boundaries).

	void loadTexture(PIXI, target)
		.then((asset: any) => {
			// Ignore if sprite has changed source since the request.
			if (String(sprite.__src ?? '') !== target) return;
			try {
				textureByUrl.set(target, asset);
			} catch {
				// noop
			}
			const tex = asset?.baseTexture || asset?.texture || asset;
			// If Assets returns a Texture, use it directly.
			try {
				sprite.texture = asset;
			} catch {
				try {
					sprite.texture = tex;
				} catch {
					// noop
				}
			}
			sprite.__srcApplied = true;
			sprite.__everApplied = true;
		})
		.catch((e: any) => {
			const key = `__loadFail:${target}`;
			if (!(window as any)[key]) {
				(window as any)[key] = true;
				console.error('[pixi] texture load failed', target, e);
			}
		});
}

function getApp(): Application | undefined {
	return (window as any).__pixiApp as Application | undefined;
}

function getOrCreateOverlay(app: any): OverlayState {
	const PIXI = (window as any).PIXI;
	if (!PIXI) throw new Error("window.PIXI missing");

	let overlay: OverlayState | undefined = (app as any).__tacticalOverlay;
	if (overlay) return overlay;

	const root = new PIXI.Container();
	root.name = "tacticalOverlayRoot";
	root.sortableChildren = true;

	const bgLayer = new PIXI.Container();
	bgLayer.name = 'tacticalOverlayBgLayer';
	bgLayer.zIndex = 0;
	const bgSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
	bgSprite.name = 'tacticalOverlayBgSprite';
	bgSprite.anchor.set(0.5, 0.5);
	bgSprite.alpha = 1;
	const bgMask = new PIXI.Graphics();
	bgMask.name = 'tacticalOverlayBgMask';
	bgSprite.mask = bgMask;
	bgLayer.addChild(bgSprite);
	bgLayer.addChild(bgMask);

	const grid = new PIXI.Graphics();
	grid.name = "tacticalOverlayGrid";
	grid.zIndex = 1;

	const unitsGfx = new PIXI.Graphics();
	unitsGfx.name = "tacticalOverlayUnitsGfx";
	unitsGfx.zIndex = 2;

	const unitsLayer = new PIXI.Container();
	unitsLayer.name = "tacticalOverlayUnitsLayer";
	unitsLayer.sortableChildren = true;
	unitsLayer.zIndex = 3;

	const labels = new PIXI.Container();
	labels.name = "tacticalOverlayLabels";
	labels.zIndex = 4;

	root.addChild(bgLayer);
	root.addChild(grid);
	root.addChild(unitsGfx);
	root.addChild(unitsLayer);
	root.addChild(labels);
	app.stage.addChild(root);

	overlay = { bgLayer, bgSprite, bgMask, bgUrl: '', root, grid, unitsGfx, unitsLayer, labels, spritesByUnitId: new Map() };
	(app as any).__tacticalOverlay = overlay;
	return overlay;
}

function parseCssUrl(cssUrl: string): string {
	const raw = String(cssUrl ?? '').trim();
	if (!raw) return '';
	// url("...") / url('...') / url(...)
	const m = raw.match(/url\((['"]?)(.*?)\1\)/i);
	const inner = (m?.[2] ?? raw).trim();
	if (!inner) return '';
	try {
		return new URL(inner, window.location.href).toString();
	} catch {
		return inner;
	}
}

function parseCssNumber(v: string, fallback: number): number {
	const n = Number.parseFloat(String(v ?? '').trim());
	return Number.isFinite(n) ? n : fallback;
}

function syncBoardBackgroundFromDom(PIXI: any, overlay: OverlayState, gridEl: HTMLElement): void {
	const boardPanel = gridEl.closest('.tactical-board-panel') as HTMLElement | null;
	if (!boardPanel) return;

	const cs = getComputedStyle(boardPanel);
	const imgVar = cs.getPropertyValue('--tacticalBoardBgImage');
	const url = parseCssUrl(imgVar);
	const bgScaleEff = parseCssNumber(cs.getPropertyValue('--boardBgScaleEff'), 1);

	const w = gridEl.clientWidth || gridEl.getBoundingClientRect().width;
	const h = gridEl.clientHeight || gridEl.getBoundingClientRect().height;
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 1 || h <= 1) return;

	// Scale against the viewport (not against the padded Pixi layer), otherwise the image
	// feels overly zoomed because `.tactical-pixi-layer` is intentionally larger than the grid.
	const viewportW = Math.max(1, Math.floor(Number(window.innerWidth ?? 1)));
	const viewportH = Math.max(1, Math.floor(Number(window.innerHeight ?? 1)));
	let viewportCx = w / 2;
	let viewportCy = h / 2;
	try {
		const gr = gridEl.getBoundingClientRect();
		// Convert viewport center (CSS px) into grid-local coordinates.
		viewportCx = viewportW / 2 - Number(gr.left ?? 0);
		viewportCy = viewportH / 2 - Number(gr.top ?? 0);
		if (!Number.isFinite(viewportCx)) viewportCx = w / 2;
		if (!Number.isFinite(viewportCy)) viewportCy = h / 2;
	} catch {
		// noop
	}

	// Full canvas mask: we want the background visible everywhere under the tiles,
	// including the padded area around the DOM grid (the Pixi layer is larger than the grid).
	const cx = w / 2;
	const cy = h / 2;
	try {
		overlay.bgMask.clear();
		overlay.bgMask
			.rect(
				-PIXI_CANVAS_PAD - PIXI_BG_MASK_MARGIN,
				-PIXI_CANVAS_PAD - PIXI_BG_MASK_MARGIN,
				w + 2 * (PIXI_CANVAS_PAD + PIXI_BG_MASK_MARGIN),
				h + 2 * (PIXI_CANVAS_PAD + PIXI_BG_MASK_MARGIN),
			)
			.fill({ color: 0xffffff, alpha: 1 });
	} catch {
		// noop
	}

	// Center the background on the viewport center.
	overlay.bgSprite.x = viewportCx;
	overlay.bgSprite.y = viewportCy;

	if (url && url !== overlay.bgUrl) {
		overlay.bgUrl = url;
		setSpriteSourceAsync(PIXI, overlay.bgSprite, url);
	}

	// Scale to fit the viewport ("contain") so it reads like the map background without heavy zoom.
	const texW = overlay.bgSprite.texture?.width ?? 0;
	const texH = overlay.bgSprite.texture?.height ?? 0;
	if (texW > 0 && texH > 0) {
		const contain = Math.min(viewportW / texW, viewportH / texH);
		// When scaling to viewport, the CSS board-scale (default 1.5) becomes too strong.
		const eff = Math.min(1.0, Math.max(0.5, Number.isFinite(bgScaleEff) ? bgScaleEff : 1));
		const s = contain * eff * PIXI_BOARD_BG_EXTRA_SCALE;
		overlay.bgSprite.scale.set(s, s);
	} else {
		// Texture not ready yet.
		overlay.bgSprite.scale.set(1, 1);
	}
}

function tileCenterInGrid(tile: HTMLElement, gridEl: HTMLElement): { x: number; y: number } | null {
	// Best case (iso): layoutIsoGrid sets el.style.left/top to the tile center.
	const left = Number.parseFloat(String(tile.style.left ?? ""));
	const top = Number.parseFloat(String(tile.style.top ?? ""));
	if (Number.isFinite(left) && Number.isFinite(top)) return { x: left, y: top };

	// Fallback: compute from DOM rects (works for non-iso too).
	const tr = tile.getBoundingClientRect();
	const gr = gridEl.getBoundingClientRect();
	const x = (tr.left + tr.right) / 2 - gr.left;
	const y = (tr.top + tr.bottom) / 2 - gr.top;
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x, y };
}

function drawIsoDiamond(
	g: any,
	cx: number,
	cy: number,
	tileW: number,
	tileH: number,
	style: {
		strokeAlpha: number;
		fillAlpha: number;
		strokeColor: number;
		fillColor: number;
		strokeWidth: number;
	},
): void {
	const halfW = tileW / 2;
	const halfH = tileH / 2;
	const pts = [
		cx,
		cy - halfH,
		cx + halfW,
		cy,
		cx,
		cy + halfH,
		cx - halfW,
		cy,
	];
	if (style.fillAlpha > 0) {
		g.poly(pts).fill({ color: style.fillColor, alpha: style.fillAlpha });
	}
	if (style.strokeAlpha > 0) {
		g.poly(pts).stroke({
			width: style.strokeWidth,
			color: style.strokeColor,
			alpha: style.strokeAlpha,
			cap: 'round',
			join: 'round',
		});
	}
}

function strokeSegment(
	g: any,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	style: { color: number; alpha: number; width: number },
): void {
	try {
		g.moveTo(x1, y1);
		g.lineTo(x2, y2);
		g.stroke({
			width: style.width,
			color: style.color,
			alpha: style.alpha,
			cap: 'round',
			join: 'round',
		});
	} catch {
		// noop
	}
}

function strokeSegmentInside(
	g: any,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	cx: number,
	cy: number,
	style: { color: number; alpha: number; width: number },
): void {
	// Pixi strokes are centered on the path: half the width goes "outside".
	// For the outer border, that gets clipped at the canvas edge.
	// So we shift the segment inward (towards the tile center) by width/2.
	const vx = x2 - x1;
	const vy = y2 - y1;
	const len = Math.hypot(vx, vy);
	if (!Number.isFinite(len) || len <= 1e-6) return;

	// Two perpendicular normals.
	let n1x = -vy;
	let n1y = vx;
	let n2x = vy;
	let n2y = -vx;
	const n1l = Math.hypot(n1x, n1y) || 1;
	const n2l = Math.hypot(n2x, n2y) || 1;
	n1x /= n1l;
	n1y /= n1l;
	n2x /= n2l;
	n2y /= n2l;

	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;
	const toCx = cx - mx;
	const toCy = cy - my;
	const dot1 = n1x * toCx + n1y * toCy;
	const dot2 = n2x * toCx + n2y * toCy;
	const nx = dot1 >= dot2 ? n1x : n2x;
	const ny = dot1 >= dot2 ? n1y : n2y;
	const shift = style.width / 2;

	strokeSegment(g, x1 + nx * shift, y1 + ny * shift, x2 + nx * shift, y2 + ny * shift, style);
}

let overlayRenderScheduled = false;

export function renderTacticalOverlayFromDom(): void {
	// Throttle to 1 render per animation frame. The tactical screen often calls this
	// multiple times (layout pass + post-layout pass), which can cause a tiny hitch.
	if (overlayRenderScheduled) return;
	overlayRenderScheduled = true;
	requestAnimationFrame(() => {
		overlayRenderScheduled = false;
		try {
			renderTacticalOverlayFromDomNow();
		} catch (e) {
			// Keep failures non-fatal
			console.error('[pixi] overlay render failed', e);
		}
	});
}

function renderTacticalOverlayFromDomNow(): void {
	ensureMoveListenerBound();
	const app = getApp() as any;
	const PIXI = (window as any).PIXI;
	if (!app || !PIXI) return;

	const gridEl = document.getElementById("tacticalGrid") as HTMLElement | null;
	if (!gridEl) return;

	const overlay = getOrCreateOverlay(app);
	// Keep root aligned with our padded canvas (CSS makes the canvas bigger than the grid).
	try {
		overlay.root.position.set(PIXI_CANVAS_PAD, PIXI_CANVAS_PAD);
	} catch {
		// noop
	}
	const gridG = overlay.grid;
	const unitsG = overlay.unitsGfx;
	const unitsLayer = overlay.unitsLayer;
	const labelsC = overlay.labels;

	gridG.clear();
	unitsG.clear();
	labelsC.removeChildren();

	// Render the board background in Pixi (sprite + diamond mask) so the image never "moves" via CSS hacks.
	try {
		syncBoardBackgroundFromDom(PIXI, overlay, gridEl);
	} catch {
		// noop
	}

	const tiles = Array.from(gridEl.querySelectorAll<HTMLElement>(".tile[data-x][data-y]"));
	if (!tiles.length) return;

	// Avoid expensive getComputedStyle per tile: tiles are uniform.
	let tileW = 60;
	let tileH = 30;
	try {
		const first = tiles[0];
		if (first) {
			const cs0 = getComputedStyle(first);
			tileW = Number.parseFloat(cs0.width) || tileW;
			tileH = Number.parseFloat(cs0.height) || tileH;
		}
	} catch {
		// noop
	}

	// Subtle tile grid (Pixi) so tiles remain readable without strong white lines.
	// This replaces the previous DOM SVG overlay when pixi-units is enabled.
	// “Léger remplissage” = une teinte sombre très transparente dans chaque case.
	// Ça rend les cases lisibles sans donner un look "grille blanche".
	const gridStyle = {
		strokeAlpha: 0.7,
		fillAlpha: 0,
		// Near-black reads cleaner than pure black on diagonals
		strokeColor: 0x111111,
		fillColor: 0x000000,
		// Integer width tends to look less "saccadé" than sub-pixel widths
		strokeWidth: 1,
	};

	// Build tile set so we can detect which edges are on the outside perimeter.
	const tileSet = new Set<string>();
	for (const tile of tiles) {
		const x = Number(tile.dataset.x);
		const y = Number(tile.dataset.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		tileSet.add(`${x},${y}`);
	}
	if (!tileSet.size) return;

	// Draw all tiles with the normal thin grid style.
	for (const tile of tiles) {
		const c = tileCenterInGrid(tile, gridEl);
		if (!c) continue;
		drawIsoDiamond(gridG, c.x, c.y, tileW, tileH, gridStyle);
	}

	// Draw ONLY the outer border edges, very thick (no thick lines inside the board).
	const outerStyle = {
		color: 0x000000,
		alpha: 0.95,
		width: 6,
	};
	for (const tile of tiles) {
		const x = Number(tile.dataset.x);
		const y = Number(tile.dataset.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		const c = tileCenterInGrid(tile, gridEl);
		if (!c) continue;
		const halfW = tileW / 2;
		const halfH = tileH / 2;
		const topX = c.x;
		const topY = c.y - halfH;
		const rightX = c.x + halfW;
		const rightY = c.y;
		const bottomX = c.x;
		const bottomY = c.y + halfH;
		const leftX = c.x - halfW;
		const leftY = c.y;

		// Neighbor mapping for iso diamonds (based on how the iso grid is laid out):
		// - (x-1,y) touches the top-left edge
		// - (x,y-1) touches the top-right edge
		// - (x+1,y) touches the right-bottom edge
		// - (x,y+1) touches the bottom-left edge
		const missingTopLeft = !tileSet.has(`${x - 1},${y}`);
		const missingTopRight = !tileSet.has(`${x},${y - 1}`);
		const missingRightBottom = !tileSet.has(`${x + 1},${y}`);
		const missingBottomLeft = !tileSet.has(`${x},${y + 1}`);

		// Draw only edges that have no neighbor: this yields the true external contour (no thick inner lines).
		if (missingTopLeft) strokeSegmentInside(gridG, leftX, leftY, topX, topY, c.x, c.y, outerStyle);
		if (missingTopRight) strokeSegmentInside(gridG, topX, topY, rightX, rightY, c.x, c.y, outerStyle);
		if (missingRightBottom) strokeSegmentInside(gridG, rightX, rightY, bottomX, bottomY, c.x, c.y, outerStyle);
		if (missingBottomLeft) strokeSegmentInside(gridG, bottomX, bottomY, leftX, leftY, c.x, c.y, outerStyle);
	}

	// Draw units based on the tile dataset.
	const unitTiles = Array.from(gridEl.querySelectorAll<HTMLElement>(".tile[data-unit-id]"))
		.filter((t) => String(t.dataset.unitId ?? "").trim().length > 0);

	const aliveUnitIds = new Set<string>();

	for (const tile of unitTiles) {
		const unitId = String(tile.dataset.unitId ?? "");
		aliveUnitIds.add(unitId);

		const moving = movingPosByUnitId.get(unitId);
		const c = moving ? { x: moving.x, y: moving.y } : tileCenterInGrid(tile, gridEl);
		if (!c) continue;

		// When moving, the movement event pipeline drives the frame/texture.
		// Only pick DOM src when not moving.
		let src = '';
		if (!moving) {
			const img = tile.querySelector('img.unit-sprite') as HTMLImageElement | null;
			const rawSrc = img?.currentSrc || img?.src || '';
			src = rawSrc
				? new URL(String(rawSrc), window.location.href).toString()
				: new URL('./ImagesRPG/imagespersonnage/trueplayer.png', window.location.href).toString();
			if (!rawSrc) {
				const key = `__missingSrc:${unitId}`;
				if (!(window as any)[key]) {
					(window as any)[key] = true;
					console.warn('[pixi] missing DOM sprite src for unit', { unitId });
				}
			}
		}

		// Approx tile size
		const cs = getComputedStyle(tile);
		const tileW = Number.parseFloat(cs.width) || 60;
		const tileH = Number.parseFloat(cs.height) || 30;

		let sprite = overlay.spritesByUnitId.get(unitId);
		if (!sprite) {
			sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
			sprite.anchor.set(0.5, 1);
			sprite.alpha = 1;
			sprite.__src = '';
			sprite.__srcApplied = false;
			sprite.__everApplied = false;
			sprite.__lastScale = null;
			overlay.spritesByUnitId.set(unitId, sprite);
			unitsLayer.addChild(sprite);
		}
		if (!unitsLayer.children.includes(sprite)) unitsLayer.addChild(sprite);
		if (src) setSpriteSourceAsync(PIXI, sprite, src);

		// Position: stand a bit above the tile center.
		sprite.x = c.x;
		sprite.y = c.y + tileH * 0.15;

		// Scale to a readable height (keep aspect ratio).
		// User feedback: sprites were ~2x too big.
		const desiredH = Math.max(24, tileH * 1.15);
		const th = sprite.texture?.height ?? 0;
		if (th > 0) {
			const s = desiredH / th;
			sprite.scale.set(s, s);
			sprite.__lastScale = s;
		} else {
			// Texture not ready yet; keep last known scale (prevents 1-frame shrink).
			const last = Number(sprite.__lastScale);
			if (Number.isFinite(last) && last > 0) {
				sprite.scale.set(last, last);
			} else {
				sprite.scale.set(0.4, 0.4);
			}
		}

		// Avoid flicker/dimming when swapping textures mid-turn: only dim before the first successful load.
		if (!sprite.__srcApplied && !sprite.__everApplied) sprite.alpha = 0.6;
		else sprite.alpha = 1;

		// Sort order: follow DOM painter ordering.
		const z = Number.parseInt(String(tile.style.zIndex || '0'), 10);
		sprite.zIndex = Number.isFinite(z) ? z + 1000 : 1000;

		// Debug labels removed.
	}

	// Cleanup sprites for units no longer present.
	for (const [unitId, sprite] of Array.from(overlay.spritesByUnitId.entries())) {
		if (aliveUnitIds.has(unitId)) continue;
		try {
			overlay.spritesByUnitId.delete(unitId);
			sprite?.destroy?.();
		} catch (e) {
			// noop
		}
	}
}
