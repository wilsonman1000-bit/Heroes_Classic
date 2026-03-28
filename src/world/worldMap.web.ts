import type { MapId, MapPos } from './world.js';
import { WorldManager } from './world.js';
import { showPlateauMapRenderer } from './mapRenderer.web.js';
import { DEFAULT_FOREST_ENTRY, FOREST_MAPS } from './maps.js';

export type WorldMapOptions = {
	onBack: () => void;
	startMapId?: MapId;
	startEntry?: MapPos;
};

export function showForestWorldMaps(options: WorldMapOptions): void {
	const world = new WorldManager();
	world.registerMaps(FOREST_MAPS);

	const mapId = (options.startMapId ?? 'forest_1') as MapId;
	const entry = options.startEntry ?? DEFAULT_FOREST_ENTRY;

	showPlateauMapRenderer({
		world,
		onBack: options.onBack,
		start: { mapId, entry },
		movement: { stepMs: 220 },
		// Layout intentionally omitted: we centralize world-map rendering defaults
		// inside the renderer and per-map meta (only for exceptional cases).
	});
	
}
