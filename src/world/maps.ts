import type { MapDef, MapDir, MapId, MapPos, TileDef } from './world.js';

export type ForestMapId = 'forest_1' | 'forest_2' | 'forest_3' | (string & {});

type GridPos = { x: number; y: number };

const midIndex = (size: number): number => Math.max(0, Math.floor((Math.max(1, size) - 1) / 2));

const findMapByGrid = (maps: MapDef[], pos: GridPos): MapDef | undefined =>
	maps.find((m) => m.meta?.grid?.x === pos.x && m.meta?.grid?.y === pos.y);

const ensureExitTile = (map: MapDef, at: { x: number; y: number }, exit: { dir: MapDir; to: MapId; entry: MapPos; label?: string }): void => {
	map.tiles ??= [];
	const existing = map.tiles.find((t) => t.x === at.x && t.y === at.y);
	if (existing?.exit) return; // don't override a manually placed exit
	if (existing) {
		existing.exit = exit;
		return;
	}
	map.tiles.push({ x: at.x, y: at.y, exit } satisfies TileDef);
};

const applyGridExits = (maps: MapDef[]): MapDef[] => {
	for (const map of maps) {
		const g = map.meta?.grid;
		if (!g) continue;

		const west = findMapByGrid(maps, { x: g.x - 1, y: g.y });
		const east = findMapByGrid(maps, { x: g.x + 1, y: g.y });
		// Inverted Y axis: y+1 is "up" (north), y-1 is "down" (south)
		const north = findMapByGrid(maps, { x: g.x, y: g.y + 1 });
		const south = findMapByGrid(maps, { x: g.x, y: g.y - 1 });

		const mx = midIndex(map.w);
		const my = midIndex(map.h);

		if (west) {
			ensureExitTile(map, { x: 0, y: my }, { dir: 'west', to: west.id, entry: { x: west.w - 1, y: midIndex(west.h) }, label: 'Retour (ouest)' });
		}
		if (east) {
			ensureExitTile(map, { x: map.w - 1, y: my }, { dir: 'east', to: east.id, entry: { x: 0, y: midIndex(east.h) }, label: 'Vers (est)' });
		}
		if (north) {
			ensureExitTile(map, { x: mx, y: 0 }, { dir: 'north', to: north.id, entry: { x: midIndex(north.w), y: north.h - 1 }, label: 'Vers (nord)' });
			// Special case: move the north exit for the village map to x=0,y=0
			if (map.id === 'village_y0x1') {
				const original = map.tiles?.find((t) => t.x === mx && t.y === 0 && t.exit && t.exit.dir === 'north');
				if (original && original.exit) {
					const exit = original.exit;
					// remove the exit from the original tile
					delete (original as any).exit;
					// place the exit at x=0,y=0
					const dest = map.tiles?.find((t) => t.x === 0 && t.y === 0);
					if (dest) {
						dest.exit = exit;
					} else {
						map.tiles = map.tiles ?? [];
						map.tiles.push({ x: 0, y: 0, exit } satisfies TileDef);
					}
				}
			}
		}
		if (south) {
			ensureExitTile(map, { x: mx, y: map.h - 1 }, { dir: 'south', to: south.id, entry: { x: midIndex(south.w), y: 0 }, label: 'Vers (sud)' });
		}
	}

	return maps;
};

export const FOREST_MAPS: MapDef[] = applyGridExits([
	{
		id: 'forest_1',
		name: 'Forêt — Clairière',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_combat2.jpeg',
		meta: { grid: { x: 1, y: 1 }, encounterLevel: 1 },
		tiles: [
			{
				x: 8,
				y: 3,
				exit: { dir: 'east' satisfies MapDir, to: 'forest_2', entry: { x: 0, y: 3 }, label: 'Vers la forêt (est)' },
			},
			{
				x: 3,
				y: 3,
				npc: {
					id: 'forest_oldman',
					title: 'Vieux chasseur',
					text: "Je garde l'entrée. Si tu t'aventures plus loin, prépare-toi à combattre.",
				},
			},
			{
				x: 5,
				y: 5,
				encounter: { enemyId: 'gobelin', enemyCount: 3 },
			},
			{
				x: 1,
				y: 1,
				encounter: { enemyId: 'sergent_gobelin', enemyCount: 1 },
			},
			// Added encounters
			{
				x: 2,
				y: 6,
				encounter: { enemyId: 'gobelin', enemyCount: 2 },
			},
			{
				x: 6,
				y: 2,
				encounter: { enemyId: 'loup', enemyCount: 1 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'village_y0x1',
		name: 'Boaraven',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/village1.jpeg',
		meta: {
			grid: { x: 1, y: 0 },
			// Display title override for HUD
			displayName: 'Baronnie libre de Boaraven',
		},
		tiles: [
			{ x: 6, y: 0, eventId: 'marche' },
			{ x: 8, y: 1, eventId: 'maison' },
			{ x: 4, y: 8, eventId: 'auberge' },
			{ x: 8, y: 6, eventId: 'boutique' },
		] satisfies TileDef[],
	},
	{
		id: 'forest_2',
		name: 'Forêt — Sentier',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/map1.1.png',
		meta: { grid: { x: 2, y: 1 }, encounterLevel: 2 },
		tiles: [
			{
				x: 0,
				y: 3,
				exit: { dir: 'west' satisfies MapDir, to: 'forest_1', entry: { x: 8, y: 3 }, label: 'Retour (ouest)' },
			},
			{
				x: 8,
				y: 3,
				exit: { dir: 'east' satisfies MapDir, to: 'forest_3', entry: { x: 0, y: 3 }, label: 'Vers la forêt (est)' },
			},
			{
				x: 2,
				y: 6,
				encounter: { enemyId: 'gobelin', enemyCount: 4 },
			},
			{
				x: 4,
				y: 2,
				encounter: { enemyId: 'loup', enemyCount: 3 },
			},
			// Added encounters
			{
				x: 3,
				y: 5,
				encounter: { enemyId: 'gobelin', enemyCount: 2 },
			},
			{
				x: 1,
				y: 1,
				encounter: { enemyId: 'sergent_gobelin', enemyCount: 1 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'forest_3',
		name: 'Forêt — Ruines',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_combat4.png',
		meta: { grid: { x: 3, y: 1 }, encounterLevel: 3 },
		tiles: [
			{
				x: 0,
				y: 3,
				exit: { dir: 'west' satisfies MapDir, to: 'forest_2', entry: { x: 8, y: 3 }, label: 'Retour (ouest)' },
			},
			{
				x: 4,
				y: 2,
				npc: {
					id: 'forest_ruins_scout',
					title: 'Éclaireuse',
					text: 'Des traces récentes... quelque chose rôde dans les ruines.',
				},
			},
			{
				x: 6,
				y: 6,
				encounter: { enemyId: 'gobelin', enemyCount: 5, enemyLevel: 2 },
			},
			{
				x: 2,
				y: 5,
				encounter: { enemyId: 'loup', enemyCount: 4 },
			},
			{
				x: 1,
				y: 1,
				encounter: { enemyId: 'sergent_gobelin', enemyCount: 1 },
			},
			// Added encounters
			{
				x: 5,
				y: 3,
				encounter: { enemyId: 'gobelin', enemyCount: 3 },
			},
			{
				x: 3,
				y: 6,
				encounter: { enemyId: 'loup', enemyCount: 2 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'forest_y2x1',
		name: 'Forêt — (x1, y2)',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_map2.1.jpeg',
		meta: { grid: { x: 1, y: 2 }, encounterLevel: 2 },
		tiles: [
			{
				x: 2,
				y: 2,
				encounter: { enemyId: 'gobelin', enemyCount: 3 },
			},
			{
				x: 5,
				y: 5,
				encounter: { enemyId: 'loup', enemyCount: 2 },
			},
			{
				x: 6,
				y: 1,
				encounter: { enemyId: 'gobelin', enemyCount: 2 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'forest_y2x2',
		name: 'Forêt — (x2, y2)',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_map2.2.jpeg',
		meta: { grid: { x: 2, y: 2 }, encounterLevel: 3 },
		tiles: [
			{
				x: 1,
				y: 6,
				encounter: { enemyId: 'loup', enemyCount: 3 },
			},
			{
				x: 4,
				y: 4,
				encounter: { enemyId: 'gobelin', enemyCount: 3 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'forest_y2x3',
		name: 'Forêt — (x3, y2)',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_map2.3.jpeg',
		meta: { grid: { x: 3, y: 2 }, encounterLevel: 4 },
		tiles: [
			{
				x: 2,
				y: 3,
				encounter: { enemyId: 'gobelin', enemyCount: 2 },
			},
			{
				x: 6,
				y: 5,
				encounter: { enemyId: 'loup', enemyCount: 2 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'forest_y3x1',
		name: 'Forêt — (x1, y3)',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_map3.1.jpeg',
		meta: { grid: { x: 1, y: 3 }, encounterLevel: 3 },
		tiles: [
			{
				x: 1,
				y: 1,
				encounter: { enemyId: 'chef_gobelin', enemyCount: 2 },
			},
			{
				x: 3,
				y: 3,
				encounter: { enemyId: 'gobelin', enemyCount: 2 },
			},
			{
				x: 5,
				y: 2,
				encounter: { enemyId: 'loup', enemyCount: 1 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'forest_y3x2',
		name: 'Forêt — (x2, y3)',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_map3.2.jpeg',
		meta: { grid: { x: 2, y: 3 }, encounterLevel: 4 },
		tiles: [
			{
				x: 2,
				y: 6,
				encounter: { enemyId: 'gobelin', enemyCount: 3 },
			},
			{
				x: 4,
				y: 1,
				encounter: { enemyId: 'loup', enemyCount: 2 },
			},
		] satisfies TileDef[],
	},
	{
		id: 'forest_y3x3',
		name: 'Forêt — (x3, y3)',
		w: 9,
		h: 9,
		backgroundSrc: 'ImagesRPG/imagesfond/image_map3.3.jpeg',
		meta: { grid: { x: 3, y: 3 }, encounterLevel: 5 },
		tiles: [
			{
				x: 3,
				y: 5,
				encounter: { enemyId: 'gobelin', enemyCount: 3 },
			},
			{
				x: 6,
				y: 6,
				encounter: { enemyId: 'loup', enemyCount: 3 },
			},
		] satisfies TileDef[],
	},
]);

export function getForestMap(id: MapId): MapDef {
	const found = FOREST_MAPS.find((m) => m.id === id);
	return found ?? FOREST_MAPS[0]!;
}

export function isForestMapId(id: unknown): id is ForestMapId {
	return typeof id === 'string' && (id === 'forest_1' || id === 'forest_2' || id === 'forest_3');
}

export const DEFAULT_FOREST_ENTRY: MapPos = { x: 4, y: 4 };
