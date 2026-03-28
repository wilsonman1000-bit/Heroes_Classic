import type { Application } from "pixi.js";

import { getWalkCycle, type MoveDir } from "../characterSprites.web.js";

type WorldPixiLeaderDetail = {
	containerId: string;
	x: number;
	y: number;
	tileW: number;
	tileH: number;
	characterClass: string;
	dir: MoveDir;
	frameIndex: number;
	idleSrc: string;
	moving: boolean;
	visible?: boolean;
};

type WorldLeaderOverlay = {
	app: Application;
	containerId: string;
	root: any;
	sprite: any;
};

let listenerBound = false;
let overlay: WorldLeaderOverlay | null = null;

const textureByUrl = new Map<string, any>();
const texturePromiseByUrl = new Map<string, Promise<any>>();

function getApp(): Application | undefined {
	return (window as any).__pixiApp as Application | undefined;
}

function ensureAssetsInit(PIXI: any): void {
	try {
		if (PIXI?.Assets?.init) {
			PIXI.Assets.init({
				basePath: "",
			});
		}
	} catch {
		// non-fatal
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
				try { onReady(tex); } catch { /* ignore */ }
			}
		})
		.catch(() => {
			// ignore texture failures (fallback: keep previous texture)
		});
}

function ensureOverlay(PIXI: any, app: Application, containerId: string): WorldLeaderOverlay {
	if (overlay && overlay.app === app && overlay.containerId === containerId) return overlay;

	// New app or different container: reset.
	overlay = null;
	try {
		(app.stage as any).removeChildren();
	} catch {
		// ignore
	}

	const root = new PIXI.Container();
	const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
	try {
		// Bottom-center anchor so the character "stands" on the tile.
		sprite.anchor.set(0.5, 1);
	} catch {
		// ignore
	}
	root.addChild(sprite);
	app.stage.addChild(root);

	overlay = { app, containerId, root, sprite };
	return overlay;
}

function resolveLeaderFrame(detail: WorldPixiLeaderDetail): string {
	if (!detail.moving) return String(detail.idleSrc ?? "");

	const walk = getWalkCycle(detail.characterClass, detail.dir);
	if (!walk?.cycle?.length) return String(detail.idleSrc ?? "");

	const idx = Math.max(0, Math.floor(Number(detail.frameIndex ?? 0))) % walk.cycle.length;
	return String(walk.cycle[idx] ?? detail.idleSrc ?? "");
}

export function ensureWorldLeaderPixiListenerBound(): void {
	if (listenerBound) return;
	listenerBound = true;

	window.addEventListener("worldPixiLeader", (ev: any) => {
		const detail = (ev as CustomEvent<WorldPixiLeaderDetail>)?.detail;
		if (!detail) return;

		const app = getApp();
		const PIXI = (window as any).PIXI;
		if (!app || !PIXI) return;

		const o = ensureOverlay(PIXI, app, String(detail.containerId));
		if (!o?.sprite) return;

		const visible = detail.visible !== false;
		o.sprite.visible = visible;
		if (!visible) return;

		const tileW = Math.max(1, Number(detail.tileW ?? 0));
		const tileH = Math.max(1, Number(detail.tileH ?? 0));

		// Global tuning factor for how large the leader appears on a tile.
		// 0.7 was too large (~+40%).
		const WORLD_LEADER_SCALE = 0.5;

		// Stand on the tile center, with a slight downward offset (matches tactical overlay feel).
		const cx = Number(detail.x ?? 0) + tileW / 2;
		const cy = Number(detail.y ?? 0) + tileH / 2;
		o.sprite.x = Math.round(cx);
		o.sprite.y = Math.round(cy + tileH * 0.15);

		// Match DOM intent (129% x 145%) but KEEP aspect ratio (Pixi has no object-fit).
		// We target a desired on-screen height and scale uniformly from the texture height.
		const desiredH = Math.max(10, tileH * 1.45 * WORLD_LEADER_SCALE);
		const texH = Number(o.sprite?.texture?.height ?? 0);
		if (texH > 0) {
			const s = desiredH / texH;
			try {
				o.sprite.scale.set(s, s);
				o.sprite.__lastScale = s;
			} catch {
				// ignore
			}
		} else {
			const last = Number(o.sprite?.__lastScale ?? 0);
			if (Number.isFinite(last) && last > 0) {
				try { o.sprite.scale.set(last, last); } catch { /* ignore */ }
			} else {
				try { o.sprite.scale.set(WORLD_LEADER_SCALE, WORLD_LEADER_SCALE); } catch { /* ignore */ }
			}
		}

		const src = resolveLeaderFrame(detail);
		if (src) {
			setSpriteSourceAsync(PIXI, o.sprite, src, () => {
				// Re-apply uniform scaling once the texture dimensions are known.
				try {
					const th = Number(o.sprite?.texture?.height ?? 0);
					if (th > 0) {
						const s = desiredH / th;
						o.sprite.scale.set(s, s);
						o.sprite.__lastScale = s;
					}
				} catch {
					// ignore
				}
			});
		}
	});
}
