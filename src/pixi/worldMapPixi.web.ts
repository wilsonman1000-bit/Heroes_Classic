import type { Application } from "pixi.js";

import type { MapDef, TileDef } from "../world/world.js";
import { ENEMY_DEFS } from "../enemies.js";

type WorldMapPixiInitDetail = {
	containerId: string;
	map: MapDef;
	boardRect?: { left: number; top: number; width: number; height: number };
	hiddenEncounterTokens?: string[];
};

type WorldMapPixiLeaderDetail = {
	containerId: string;
	x: number;
	y: number;
	tileW: number;
	tileH: number;
	characterClass: string;
	dir: string;
	frameIndex: number;
	frameSrc?: string;
	idleSrc: string;
	moving: boolean;
	visible?: boolean;
};

type WorldMapPixiState = {
	app: Application;
	containerId: string;
	root: any;
	bgFull: any;
	bg: any;
	boardShade: any;
	tilesLayer: any;
	gridLines: any;
	hoverGfx: any;
	markersLayer: any;
	leaderSprite: any;
	map: MapDef;
	boardRect?: { left: number; top: number; width: number; height: number };
	hiddenEncounterTokens: Set<string>;
	layout: {
		w: number;
		h: number;
		tileW: number;
		tileH: number;
		stepW: number;
		stepH: number;
		offsetX: number;
		offsetY: number;
		gap: number;
		pad: number;
	};
};

let listenerBound = false;
let state: WorldMapPixiState | null = null;

const textureByUrl = new Map<string, any>();
const texturePromiseByUrl = new Map<string, Promise<any>>();

function enemyImageSrc(enemyId: unknown): string {
	const id = String(enemyId ?? '');
	const def = (ENEMY_DEFS as any)[id];
	const src = String(def?.image ?? '');
	return src || 'ImagesRPG/imagespersonnage/trueennemi.png';
}

function getApp(): Application | undefined {
	return (window as any).__pixiApp as Application | undefined;
}

function ensureAssetsInit(PIXI: any): void {
	try {
		if (PIXI?.Assets?.init) {
			PIXI.Assets.init({ basePath: "" });
		}
	} catch {
		// noop
	}
}

function loadTexture(PIXI: any, url: string): Promise<any> {
	const key = String(url ?? "");
	if (!key) return Promise.reject(new Error("empty texture url"));

	const cached = textureByUrl.get(key);
	if (cached) return Promise.resolve(cached);

	const existingPromise = texturePromiseByUrl.get(key);
	if (existingPromise) return existingPromise;

	const p = Promise.resolve()
		.then(() => {
			ensureAssetsInit(PIXI);
			if (!PIXI?.Assets?.load) return PIXI.Texture.from(key);
			return PIXI.Assets.load(key);
		})
		.then((tex: any) => {
			textureByUrl.set(key, tex);
			texturePromiseByUrl.delete(key);
			return tex;
		})
		.catch((e) => {
			texturePromiseByUrl.delete(key);
			throw e;
		});

	texturePromiseByUrl.set(key, p);
	return p;
}

function setSpriteSourceAsync(PIXI: any, sprite: any, url: string, onReady?: (tex: any) => void): void {
	const target = String(url ?? "");
	if (!target || !sprite) return;

	const cached = textureByUrl.get(target);
	if (cached) {
		try {
			sprite.texture = cached;
		} catch {
			// ignore
		}
		if (onReady) {
			try {
				Promise.resolve().then(() => onReady(cached));
			} catch {
				// ignore
			}
		}
		return;
	}

	void loadTexture(PIXI, target)
		.then((tex) => {
			try {
				sprite.texture = tex;
			} catch {
				// ignore
			}
			if (onReady) {
				try {
					onReady(tex);
				} catch {
					// ignore
				}
			}
		})
		.catch(() => {
			// ignore
		});
}

function clamp(n: number, a: number, b: number): number {
	return Math.max(a, Math.min(b, n));
}

function getCanvasRect(app: Application): { left: number; top: number; width: number; height: number } {
	try {
		const canvas = ((app as any).canvas ?? (app as any).view) as any;
		if (canvas?.getBoundingClientRect) {
			const r = canvas.getBoundingClientRect();
			return {
				left: Number(r.left ?? 0),
				top: Number(r.top ?? 0),
				width: Number(r.width ?? 0),
				height: Number(r.height ?? 0),
			};
		}
	} catch {
		// ignore
	}
	return { left: 0, top: 0, width: 0, height: 0 };
}

function getCanvasToRendererScale(app: Application): { sx: number; sy: number } {
	const canvasRect = getCanvasRect(app);
	const appW = Math.max(1, Number(((app.renderer as any)?.screen?.width ?? (app.renderer as any)?.width ?? 1)));
	const appH = Math.max(1, Number(((app.renderer as any)?.screen?.height ?? (app.renderer as any)?.height ?? 1)));
	const cssW = Math.max(1, Number(canvasRect.width ?? 1));
	const cssH = Math.max(1, Number(canvasRect.height ?? 1));
	// With autoDensity/resolution, renderer units may differ from CSS px.
	// Use measured ratios so DOM rects (CSS px) convert correctly to Pixi coords.
	return {
		sx: appW / cssW,
		sy: appH / cssH,
	};
}

function toPx(v: string | number | undefined, total: number): number {
	if (v === undefined) return 0;
	if (typeof v === "number") return (total * v) / 100;
	const s = String(v).trim();
	if (!s) return 0;
	if (s.endsWith("%")) {
		const n = Number.parseFloat(s.slice(0, -1));
		return Number.isFinite(n) ? (total * n) / 100 : 0;
	}
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? (total * n) / 100 : 0;
}

function computeIsoLayout(containerW: number, containerH: number, cols: number, rows: number, map: MapDef): WorldMapPixiState["layout"] {
	const meta = ((map as any)?.meta ?? {}) as any;
	// World maps default smaller so tiles remain readable.
	// Slightly smaller by default so the board sits better within the background artwork.
	const SCALE = clamp(Number(meta?.isoScale ?? 0.85), 0.6, 2.2);
	const ASPECT = clamp(Number(meta?.tileAspect ?? 0.68), 0.35, 0.9);
	const pad = 10;
	const gap = Math.max(0, Math.floor(Number(meta?.tileGap ?? 2)));

	const baseTileW = Math.max(26, (containerW - pad * 2 - gap * (cols - 1)) / Math.max(4, cols));
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
	const boardOrigin = String(meta?.boardOrigin ?? 'center');
	const offsetX = boardOrigin === 'topleft'
		? (pad + tileW / 2 - minX)
		: ((containerW - fullW) / 2 + tileW / 2 - minX);
	const offsetY = boardOrigin === 'topleft'
		? (pad + tileH / 2 - minY)
		: ((containerH - fullH) / 2 + tileH / 2 - minY);

	return { w: cols, h: rows, tileW, tileH, stepW, stepH, offsetX, offsetY, gap, pad };
}

function tileCenter(layout: WorldMapPixiState["layout"], x: number, y: number): { cx: number; cy: number } {
	const cx = layout.offsetX + (x - y) * layout.stepW;
	const cy = layout.offsetY + (x + y) * layout.stepH;
	return { cx, cy };
}

function ensureState(
	PIXI: any,
	app: Application,
	containerId: string,
	map: MapDef,
	boardRect?: { left: number; top: number; width: number; height: number },
	hiddenEncounterTokens?: string[]
): WorldMapPixiState {
	const w = Math.max(1, Math.floor((app.renderer as any)?.screen?.width ?? (app.renderer as any)?.width ?? 1));
	const h = Math.max(1, Math.floor((app.renderer as any)?.screen?.height ?? (app.renderer as any)?.height ?? 1));

	if (state && state.app === app && state.containerId === containerId && state.map === map) {
		if (boardRect) state.boardRect = boardRect;
		else delete (state as any).boardRect;
		state.hiddenEncounterTokens = new Set((hiddenEncounterTokens ?? []).map(String));
		// Layout is recomputed in drawBoard() because it depends on boardRect.
		return state;
	}

	// Reset stage for world map.
	try {
		(app.stage as any).removeChildren();
	} catch {
		// ignore
	}

	const root = new PIXI.Container();
	(app.stage as any).addChild(root);

	// Fullscreen backdrop (same texture as bg), sits behind everything.
	const bgFull = new PIXI.Sprite(PIXI.Texture.WHITE);
	bgFull.anchor.set(0.5, 0.5);
	bgFull.tint = 0xffffff;
	bgFull.alpha = 0.0;
	bgFull.x = w / 2;
	bgFull.y = h / 2;
	bgFull.width = w;
	bgFull.height = h;
	root.addChild(bgFull);

	const bg = new PIXI.Sprite(PIXI.Texture.WHITE);
	bg.anchor.set(0.5, 0.5);
	bg.tint = 0x000000;
	bg.alpha = 0.0;
	bg.x = w / 2;
	bg.y = h / 2;
	bg.width = w;
	bg.height = h;
	root.addChild(bg);

	const boardShade = new PIXI.Graphics();
	root.addChild(boardShade);

	const tilesLayer = new PIXI.Container();
	try { tilesLayer.sortableChildren = true; } catch { /* ignore */ }
	root.addChild(tilesLayer);

	const gridLines = new PIXI.Graphics();
	root.addChild(gridLines);

	const hoverGfx = new PIXI.Graphics();
	root.addChild(hoverGfx);

	const markersLayer = new PIXI.Container();
	try { markersLayer.sortableChildren = true; } catch { /* ignore */ }
	root.addChild(markersLayer);

	const leaderSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
	// Bottom-center feels more "feet on tile" and avoids floating.
	leaderSprite.anchor.set(0.5, 1);
	leaderSprite.visible = false;
	try {
		leaderSprite.eventMode = "static";
		leaderSprite.cursor = "pointer";
		leaderSprite.on("pointertap", () => {
			try {
				window.dispatchEvent(new CustomEvent("worldLeaderClick"));
			} catch {
				// ignore
			}
		});
	} catch {
		// ignore
	}
	root.addChild(leaderSprite);

	const s: WorldMapPixiState = {
		app,
		containerId,
		root,
		bgFull,
		bg,
		boardShade,
		tilesLayer,
		gridLines,
		hoverGfx,
		markersLayer,
		leaderSprite,
		map,
		...(boardRect ? { boardRect } : {}),
		hiddenEncounterTokens: new Set((hiddenEncounterTokens ?? []).map(String)),
		layout: computeIsoLayout(w, h, map.w, map.h, map),
	};

	state = s;

	return s;
}

function drawBoard(PIXI: any, s: WorldMapPixiState): void {
	const appW = Math.max(1, Math.floor((s.app.renderer as any)?.screen?.width ?? (s.app.renderer as any)?.width ?? 1));
	const appH = Math.max(1, Math.floor((s.app.renderer as any)?.screen?.height ?? (s.app.renderer as any)?.height ?? 1));
	const map = s.map;
	// boardRect comes from DOM getBoundingClientRect() (viewport coords). Convert to canvas-local coords.
	const canvasRect = getCanvasRect(s.app);
	const { sx, sy } = getCanvasToRendererScale(s.app);
	const boardRectAbs = s.boardRect ?? { left: 0, top: 0, width: appW, height: appH };
	const boardRect = {
		left: (Number(boardRectAbs.left ?? 0) - Number(canvasRect.left ?? 0)) * sx,
		top: (Number(boardRectAbs.top ?? 0) - Number(canvasRect.top ?? 0)) * sy,
		width: Number(boardRectAbs.width ?? appW) * sx,
		height: Number(boardRectAbs.height ?? appH) * sy,
	};
	const rectW = Math.max(1, Math.floor(boardRect.width));
	const rectH = Math.max(1, Math.floor(boardRect.height));
	const layout = computeIsoLayout(Math.max(1, boardRect.width), Math.max(1, boardRect.height), map.w, map.h, map);
	s.layout = layout;

	// Background (match DOM scheduleIsoLayout(): object-fit contain, then apply meta.bgScale + meta.bgTranslateX/Y)
	const bgSrc = String(map.backgroundSrc ?? "");
	if (bgSrc) {
		// Avoid rendering the 1x1 placeholder texture scaled to the whole screen.
		if (!textureByUrl.get(bgSrc)) {
			s.bg.alpha = 0;
			s.bgFull.alpha = 0;
			void loadTexture(PIXI, bgSrc).then(() => {
				if (state && state.bg === s.bg) {
					try { drawBoard(PIXI, s); } catch { /* ignore */ }
				}
			}).catch(() => { /* ignore */ });
		} else {
			setSpriteSourceAsync(PIXI, s.bg, bgSrc);
			// Keep the fullscreen backdrop disabled by default to match DOM rendering.
			s.bgFull.alpha = 0;

			// DOM defaults (+20% requested): keep the artwork slightly larger than the board.
			const BG_SCALE_BASE = Number((map as any)?.meta?.bgScale ?? 1.5);
			const BG_SCALE = clamp(BG_SCALE_BASE * 1.2, 0.5, 3);
			const txPx = toPx((map as any)?.meta?.bgTranslateX, rectW);
			const tyPx = toPx((map as any)?.meta?.bgTranslateY, rectH);

			const tex = s.bg.texture;
			const natW = Math.max(1, Number(tex?.width ?? 1));
			const natH = Math.max(1, Number(tex?.height ?? 1));
			if (natW > 4 && natH > 4) {
				const boardOrigin = String(((map as any)?.meta?.boardOrigin ?? 'center'));
				const fitScale = Math.min(rectW / natW, rectH / natH);
				const scale = fitScale * BG_SCALE;
				const bgDrawW = natW * scale;
				const bgDrawH = natH * scale;
				let bgOffsetX = boardOrigin === 'topleft' ? 0 : (rectW - bgDrawW) / 2;
				let bgOffsetY = boardOrigin === 'topleft' ? 0 : (rectH - bgDrawH) / 2;
				bgOffsetX += txPx;
				bgOffsetY += tyPx;

				s.bg.alpha = 1;
				// DOM uses CSS brightness(0.75). Approx with tint.
				s.bg.tint = 0xbfbfbf;
				s.bg.width = bgDrawW;
				s.bg.height = bgDrawH;
				s.bg.x = boardRect.left + bgOffsetX + bgDrawW / 2;
				s.bg.y = boardRect.top + bgOffsetY + bgDrawH / 2;

				// Tiles: diamond cutouts sampling the same background (matches DOM .tile-bg background-position math)
				s.tilesLayer.removeChildren();
				s.gridLines.clear();
				s.hoverGfx.clear();
				// Keep grid lines extremely subtle; DOM hides them in integrated-terrain mode.
				s.gridLines.lineStyle({ width: 1, color: 0xffffff, alpha: 0.12 });

				const tileIndex = new Map<string, TileDef>();
				for (const t of map.tiles ?? []) tileIndex.set(`${t.x},${t.y}`, t);

				const halfW = layout.tileW / 2;
				const halfH = layout.tileH / 2;

				const drawHover = (cx: number, cy: number) => {
					try {
						s.hoverGfx.clear();
						s.hoverGfx.beginFill(0xffffff, 0.16);
						s.hoverGfx.lineStyle({ width: 2, color: 0xffffff, alpha: 0.55, cap: 'round', join: 'round' });
						s.hoverGfx.moveTo(cx, cy - halfH);
						s.hoverGfx.lineTo(cx + halfW, cy);
						s.hoverGfx.lineTo(cx, cy + halfH);
						s.hoverGfx.lineTo(cx - halfW, cy);
						s.hoverGfx.closePath();
						s.hoverGfx.endFill();
					} catch {
						// ignore
					}
				};
				const clearHover = () => {
					try { s.hoverGfx.clear(); } catch { /* ignore */ }
				};
				for (let y = 0; y < map.h; y++) {
					for (let x = 0; x < map.w; x++) {
						const t = tileIndex.get(`${x},${y}`);
						const local = tileCenter(layout, x, y);
						const cx = boardRect.left + local.cx;
						const cy = boardRect.top + local.cy;

						const desiredBgPosX = bgOffsetX - local.cx + layout.tileW / 2;
						const desiredBgPosY = bgOffsetY - local.cy + layout.tileH / 2;

						const tileWrap = new PIXI.Container();
						tileWrap.x = cx;
						tileWrap.y = cy;
						tileWrap.zIndex = Math.floor((x + y) * 100 + x);

						const tiling = new PIXI.TilingSprite({ texture: tex, width: layout.tileW, height: layout.tileH });
						tiling.x = -layout.tileW / 2;
						tiling.y = -layout.tileH / 2;
						try { tiling.tileScale.set(scale, scale); } catch { /* ignore */ }
						try { tiling.tilePosition.set(Math.round(desiredBgPosX), Math.round(desiredBgPosY)); } catch { /* ignore */ }
						tileWrap.addChild(tiling);

						const mask = new PIXI.Graphics();
						mask.beginFill(0xffffff, 1);
						mask.moveTo(0, -halfH);
						mask.lineTo(halfW, 0);
						mask.lineTo(0, halfH);
						mask.lineTo(-halfW, 0);
						mask.closePath();
						mask.endFill();
						tileWrap.addChild(mask);
						try { tiling.mask = mask; } catch { /* ignore */ }

						// Blocked tiles: match DOM's desaturation/dim feel (approx).
						if (Boolean((t as any)?.blocked)) {
							const shade = new PIXI.Graphics();
							shade.beginFill(0x000000, 0.18);
							shade.moveTo(0, -halfH);
							shade.lineTo(halfW, 0);
							shade.lineTo(0, halfH);
							shade.lineTo(-halfW, 0);
							shade.closePath();
							shade.endFill();
							tileWrap.addChild(shade);
						}

						// Interaction
						try {
							// IMPORTANT: default hit testing uses a rectangle (tileW x tileH),
							// which lets clicks land "outside" the diamond. Restrict to the diamond polygon.
							try {
								tileWrap.hitArea = new PIXI.Polygon([0, -halfH, halfW, 0, 0, halfH, -halfW, 0]);
							} catch {
								// ignore
							}
							tileWrap.eventMode = "static";
							tileWrap.cursor = "pointer";
							tileWrap.on("pointerover", () => drawHover(cx, cy));
							tileWrap.on("pointerout", () => clearHover());
							tileWrap.on("pointertap", () => {
								try { window.dispatchEvent(new CustomEvent("worldTileClick", { detail: { x, y } })); } catch { /* ignore */ }
							});
						} catch {
							// ignore
						}

						s.tilesLayer.addChild(tileWrap);

						// Very subtle outline (helps readability with gaps)
						s.gridLines.moveTo(cx, cy - halfH);
						s.gridLines.lineTo(cx + halfW, cy);
						s.gridLines.lineTo(cx, cy + halfH);
						s.gridLines.lineTo(cx - halfW, cy);
						s.gridLines.lineTo(cx, cy - halfH);
					}
				}
			} else {
				s.bg.alpha = 0;
				s.bgFull.alpha = 0;
			}
		}
	} else {
		s.bg.alpha = 0;
		s.bgFull.alpha = 0;
	}

	// Board shade (diamond overlay under tiles)
	s.boardShade.clear();
	const noOverlay = Boolean(((map as any)?.meta as any)?.noBoardOverlay);
	if (!noOverlay) {
		// Size the diamond to the actual isometric board extents (matches DOM plateau feel).
		s.boardShade.beginFill(0x000000, 0.12);
		const topC = tileCenter(layout, 0, 0);
		const rightC = tileCenter(layout, map.w - 1, 0);
		const bottomC = tileCenter(layout, map.w - 1, map.h - 1);
		const leftC = tileCenter(layout, 0, map.h - 1);
		const top = { x: boardRect.left + topC.cx, y: boardRect.top + topC.cy - layout.tileH / 2 };
		const right = { x: boardRect.left + rightC.cx + layout.tileW / 2, y: boardRect.top + rightC.cy };
		const bottom = { x: boardRect.left + bottomC.cx, y: boardRect.top + bottomC.cy + layout.tileH / 2 };
		const left = { x: boardRect.left + leftC.cx - layout.tileW / 2, y: boardRect.top + leftC.cy };
		s.boardShade.moveTo(top.x, top.y);
		s.boardShade.lineTo(right.x, right.y);
		s.boardShade.lineTo(bottom.x, bottom.y);
		s.boardShade.lineTo(left.x, left.y);
		s.boardShade.closePath();
		s.boardShade.endFill();
	}

	// Tiles are rendered above when background is available (DOM-matching cutouts).

	// Markers
	s.markersLayer.removeChildren();
	for (const t of map.tiles ?? []) {
		const encounterToken = `encounter:${String(map.id)}:${t.x},${t.y}`;
		const encounterHidden = Boolean(t.encounter) && Boolean(s.hiddenEncounterTokens?.has(encounterToken));
		const local = tileCenter(layout, t.x, t.y);
		const cx = boardRect.left + local.cx;
		const cy = boardRect.top + local.cy;
		const interactive = Boolean(t.exit || t.npc || (!encounterHidden && t.encounter) || t.eventId);
		if (!interactive) continue;

		if (t.encounter && !encounterHidden) {
			const enemyId = String((t.encounter as any)?.enemyId ?? "");
			const src = enemyImageSrc(enemyId);

			// Render the enemy image inside the tile.
			const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
			sprite.anchor.set(0.5, 0.68);
			sprite.x = cx;
			// Slightly above center, closer to the DOM marker look.
			sprite.y = cy - layout.tileH * 0.06;
			sprite.alpha = 0;

			const desiredW = Math.max(8, layout.tileW * 0.95);
			const desiredH = Math.max(8, layout.tileH * 1.05);
			const applySize = (tex?: any) => {
				const t2 = tex ?? sprite.texture;
				const natW = Math.max(1, Number(t2?.width ?? 1));
				const natH = Math.max(1, Number(t2?.height ?? 1));
				if (natW <= 1 || natH <= 1) return;
				const kW = desiredW / natW;
				const kH = desiredH / natH;
				const k = Math.max(0.01, Math.min(kW, kH));
				try { sprite.scale.set(k, k); } catch { /* ignore */ }
			};

			applySize();
			setSpriteSourceAsync(PIXI, sprite, src, (tex) => {
				applySize(tex);
				try { sprite.alpha = 1; } catch { /* ignore */ }
			});
			s.markersLayer.addChild(sprite);
			continue;
		}

		let glyph = "";
		if (t.exit) glyph = "↗";
		else if (t.npc) glyph = "💬";
		else if (t.eventId === "maison") glyph = "🏠";
		else if (t.eventId === "auberge") glyph = "🍻";
		else if (t.eventId === "marche") glyph = "🛒";
		else if (t.eventId === "boutique") glyph = "🏪";

		if (!glyph) continue;
		const text = new PIXI.Text({ text: glyph, style: { fontSize: Math.max(12, Math.floor(layout.tileH * 0.55)), fill: 0xffffff } });
		text.anchor.set(0.5, 0.6);
		text.x = cx;
		text.y = cy;
		s.markersLayer.addChild(text);
	}
}

function applyLeader(PIXI: any, s: WorldMapPixiState, detail: WorldMapPixiLeaderDetail): void {
	const visible = detail.visible !== false;
	s.leaderSprite.visible = visible;
	if (!visible) return;

	// leader detail x/y are in DOM viewport coordinates (same source as boardRect). Convert to canvas-local.
	const canvasRect = getCanvasRect(s.app);
	const { sx, sy } = getCanvasToRendererScale(s.app);
	const baseX = (Number(detail.x ?? 0) - Number(canvasRect.left ?? 0)) * sx;
	const baseY = (Number(detail.y ?? 0) - Number(canvasRect.top ?? 0)) * sy;
	const tileW = Math.max(1, Number(detail.tileW ?? 1) * sx);
	const tileH = Math.max(1, Number(detail.tileH ?? 1) * sy);

	s.leaderSprite.x = Math.round(baseX + tileW / 2);
	// Place feet slightly below the tile center for nicer grounding.
	s.leaderSprite.y = Math.round(baseY + tileH / 2 + tileH * 0.15);

	const frameSrc = String(detail.frameSrc ?? "");
	const src = frameSrc || String(detail.idleSrc ?? "");

	// Match the historical DOM exploration sizing (.unit-sprite { width:129%; height:145% })
	// but preserve aspect ratio.
	const desiredH = Math.max(8, tileH * 1.0);
	const applySize = (tex?: any) => {
		const t = tex ?? s.leaderSprite.texture;
		const natH = Math.max(1, Number(t?.height ?? 1));
		if (natH <= 1) return;
		const k = desiredH / natH;
		try { s.leaderSprite.scale.set(k, k); } catch { /* ignore */ }
	};
	applySize();
	if (src) setSpriteSourceAsync(PIXI, s.leaderSprite, src, (tex) => applySize(tex));
}

export function ensureWorldMapPixiListenerBound(): void {
	if (listenerBound) return;
	listenerBound = true;

	window.addEventListener("worldPixiInit", (ev: any) => {
		const detail = (ev as CustomEvent<WorldMapPixiInitDetail>)?.detail;
		if (!detail) return;

		const app = getApp();
		const PIXI = (window as any).PIXI;
		if (!app || !PIXI) return;

		const s = ensureState(PIXI, app, String(detail.containerId), detail.map, detail.boardRect, detail.hiddenEncounterTokens);
		drawBoard(PIXI, s);
	});

	window.addEventListener("worldPixiLeader", (ev: any) => {
		const detail = (ev as CustomEvent<WorldMapPixiLeaderDetail>)?.detail;
		if (!detail) return;

		const app = getApp();
		const PIXI = (window as any).PIXI;
		if (!app || !PIXI) return;
		if (!state || state.app !== app || state.containerId !== String(detail.containerId)) return;

		applyLeader(PIXI, state, detail);
	});

	// Keep board stable on resize.
	let resizeRaf = 0;
	window.addEventListener('resize', () => {
		if (!state) return;
		if (resizeRaf) return;
		resizeRaf = requestAnimationFrame(() => {
			resizeRaf = 0;
			try {
				const PIXI = (window as any).PIXI;
				if (!PIXI) return;
				const s = state;
				if (!s) return;
				drawBoard(PIXI, s);
			} catch {
				// ignore
			}
		});
	});
}
