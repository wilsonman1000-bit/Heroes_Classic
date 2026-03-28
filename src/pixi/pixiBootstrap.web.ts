import * as Pixi from "pixi.js";
import type { Application } from "pixi.js";

// Ensure legacy code paths relying on `window.PIXI` keep working once we bundle.
try {
	const g: any = globalThis as any;
	if (!g.PIXI) g.PIXI = Pixi;
} catch {
	// noop
}

declare global {
	interface Window {
		PIXI?: any;
		__pixiApp?: Application;
		__pixiMountSeq?: number;
		__pixi?: {
			mountBattleCanvas: () => void;
			mountPixiCanvas: (containerId: string) => void;
			unmountBattleCanvas: () => void;
		};
	}
}

async function createApp(container: HTMLElement): Promise<Application> {
	const PIXI = window.PIXI;
	if (!PIXI) {
		throw new Error(
			"PixiJS n'est pas chargé. (En prod, il doit être bundlé; en dev, vérifie que Pixi est disponible)",
		);
	}

	// PixiJS v8: Application init is async.
	const app: Application = new PIXI.Application();
	await app.init({
		resizeTo: container,
		background: 0x000000,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min(window.devicePixelRatio || 1, 2),
	});

	// Helps reduce sub-pixel shimmering on thin strokes/sprites.
	try {
		(app.renderer as any).roundPixels = true;
	} catch {
		// noop
	}

	const canvas = (app as any).canvas ?? (app as any).view;
	if (!canvas) {
		throw new Error("Pixi Application n'a pas fourni de canvas/view.");
	}
	container.appendChild(canvas as Node);

	return app;
}

export function mountBattleCanvas(): void {
	mountPixiCanvas("battle-container");
}

export function mountPixiCanvas(containerId: string): void {
	const seq = ((window.__pixiMountSeq ?? 0) + 1) | 0;
	window.__pixiMountSeq = seq;

	const container = document.getElementById(containerId);
	if (!container) return;

	// If already mounted into this container, keep it.
	const existing = window.__pixiApp as any;
	if (existing) {
		try {
			const canvas = existing.canvas ?? existing.view;
			if (canvas) {
				if (!container.contains(canvas as Node)) {
					container.innerHTML = "";
					container.appendChild(canvas as Node);
					// Notify listeners that Pixi is mounted/reattached.
					try { window.dispatchEvent(new Event('pixiMounted')); } catch (e) { /* noop */ }
				}
				return;
			}
		} catch (e) {
			// If anything looks inconsistent, recreate.
		}
		unmountBattleCanvas();
	}

	// Dedicated layer containers: it's safe to wipe.
	container.innerHTML = "";

	void (async () => {
		try {
			const app = await createApp(container);
			// Ignore stale mounts (ex: UI re-rendered while init awaited)
			if ((window.__pixiMountSeq ?? 0) !== seq) {
				try {
					app.destroy(true);
				} catch (e) {
					// noop
				}
				return;
			}
			window.__pixiApp = app;
			try { window.dispatchEvent(new Event('pixiMounted')); } catch (e) { /* noop */ }
		} catch (e) {
			console.error("[pixi] mount failed", e);
		}
	})();
}

export function unmountBattleCanvas(): void {
	const app = window.__pixiApp;
	if (!app) return;

	try {
		// Pixi v8 typings: keep destroy call simple and stable.
		app.destroy(true);
	} finally {
		// exactOptionalPropertyTypes: remove the property instead of assigning undefined
		delete window.__pixiApp;
	}
}

export function exposePixiDebugApi(): void {
	window.__pixi = {
		mountBattleCanvas,
		mountPixiCanvas,
		unmountBattleCanvas,
	};
}
