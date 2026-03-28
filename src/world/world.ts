import type { EnemyId } from '../enemies.js';

export type MapId = string & {};

export type MapDir = 'north' | 'south' | 'east' | 'west' | (string & {});

export type MapPos = { x: number; y: number };

export type MapExit = {
	to: MapId;
	entry: MapPos;
	label?: string;
	dir?: MapDir;
};

export type NPCDef = {
	id: string;
	title: string;
	text: string;
	questStartId?: string;
};

export type EncounterDef = {
	enemyId?: EnemyId;
	enemyCount?: number;
	enemyLevel?: number;
	once?: boolean;
};

export type TileDef = {
	x: number;
	y: number;
	terrain?: string;
	blocked?: boolean;
	exit?: MapExit;
	eventId?: string;
	npc?: NPCDef;
	encounter?: EncounterDef;
};

export type MapDef = {
	id: MapId;
	name: string;
	w: number;
	h: number;
	backgroundSrc?: string;
	tiles?: TileDef[];
	meta?: {
		/** Optional world-grid position for this map (e.g. 3x3 forest world: x=1..3, y=1..3) */
		grid?: { x: number; y: number };
		/** Optional per-map iso scale multiplier (overrides layout.isoScale) */
		isoScale?: number;
		moveStepMs?: number;
		/** Optional per-map background scale multiplier (overrides layout.bgScale) */
		bgScale?: number;
		/** Optional per-map background horizontal translate (percent number or string, e.g. -4 or '-4%') */
		bgTranslateX?: string | number;
		/** Optional per-map background vertical translate (percent number or string, e.g. -4 or '-4%') */
		bgTranslateY?: string | number;
		/** Optional per-map board horizontal translate (percent number or string, e.g. 5 or '5%') */
		boardTranslateX?: string | number;
		/** Optional per-map board vertical translate (percent number or string, e.g. -7 or '-7%') */
		boardTranslateY?: string | number;
		/** Optional per-map board scale multiplier (1.0 = default). Use 0.85 to reduce by 15%. */
		boardScale?: number;
		/** Optional Pixi-board scale multiplier relative to the viewport (1.0 = fullscreen). */
		pixiBoardScale?: number;
		/** Optional Pixi-board origin inside its rect ('center' or 'topleft'). */
		boardOrigin?: 'center' | 'topleft' | (string & {});
		/** If true, disables the decorative dark overlay under the board for this map */
		disableOverlay?: boolean;
		/** Optional gap between iso tiles in pixels (0 = no gaps). */
		tileGap?: number;
		/** Optional explicit display title used in HUD (falls back to `name`) */
		displayName?: string;
		/** Default level used for encounters on this map when a tile encounter doesn't provide `enemyLevel`. */
		encounterLevel?: number;
		/** If false, disables random encounters triggered on tile steps for this map. */
		randomEncounters?: boolean;
		/** Random encounter chance per tile step (0..1). Defaults to 0.05 when enabled. */
		randomEncounterChance?: number;
	};
	};

export type WorldEventMap = {
	mapExit: { from: MapId; to: MapId };
	mapEnter: { mapId: MapId };
	tileEnter: { mapId: MapId; pos: MapPos; tile: TileDef | null };
	tileInteract: { mapId: MapId; pos: MapPos; tile: TileDef | null };
};

type Handler<T> = (payload: T) => void;

export type WorldUnsubscribe = () => void;

const clampInt = (n: number, min: number, max: number): number => {
	const v = Math.floor(Number(n));
	if (!Number.isFinite(v)) return min;
	return Math.max(min, Math.min(max, v));
};

export const key = (p: MapPos): string => `${p.x},${p.y}`;

type MapRuntime = {
	def: MapDef;
	tileByKey: Map<string, TileDef>;
	onceConsumed: Set<string>;
};

export class WorldManager {
	private maps = new Map<MapId, MapRuntime>();
	private handlers = new Map<keyof WorldEventMap, Set<(payload: any) => void>>();

	private _currentMapId: MapId | null = null;
	private _playerPos: MapPos = { x: 0, y: 0 };

	registerMap(def: MapDef): void {
		const tileByKey = new Map<string, TileDef>();
		for (const t of def.tiles ?? []) tileByKey.set(key(t), t);
		this.maps.set(def.id, { def, tileByKey, onceConsumed: new Set<string>() });
		if (!this._currentMapId) this._currentMapId = def.id;
	}

	registerMaps(defs: MapDef[]): void {
		for (const d of defs) this.registerMap(d);
	}

	on<K extends keyof WorldEventMap>(event: K, handler: Handler<WorldEventMap[K]>): WorldUnsubscribe {
		const set = this.handlers.get(event) ?? new Set<(payload: any) => void>();
		set.add(handler as any);
		this.handlers.set(event, set);
		return () => {
			set.delete(handler as any);
		};
	}

	emit<K extends keyof WorldEventMap>(event: K, payload: WorldEventMap[K]): void {
		const set = this.handlers.get(event);
		if (!set || !set.size) return;
		for (const h of set) {
			try {
				(h as any)(payload);
			} catch {
				// ignore handler errors
			}
		}
	}

	get currentMapId(): MapId {
		if (!this._currentMapId) throw new Error('World has no current map');
		return this._currentMapId;
	}

	get currentMap(): MapDef {
		const rt = this.maps.get(this.currentMapId);
		if (!rt) throw new Error(`Unknown map: ${String(this.currentMapId)}`);
		return rt.def;
	}

	get playerPos(): MapPos {
		return { x: this._playerPos.x, y: this._playerPos.y };
	}

	setPlayerPos(pos: MapPos): void {
		const map = this.currentMap;
		this._playerPos = {
			x: clampInt(pos.x, 0, Math.max(0, map.w - 1)),
			y: clampInt(pos.y, 0, Math.max(0, map.h - 1)),
		};
		this.emit('tileEnter', { mapId: this.currentMapId, pos: this.playerPos, tile: this.getTileAt(this._playerPos) });
	}

	goto(mapId: MapId, entry: MapPos): void {
		const from = this.currentMapId;
		if (!this.maps.has(mapId)) throw new Error(`Unknown map: ${String(mapId)}`);
		this.emit('mapExit', { from, to: mapId });
		this._currentMapId = mapId;
		this.emit('mapEnter', { mapId });
		this.setPlayerPos(entry);
	}

	getTileAt(pos: MapPos): TileDef | null {
		const rt = this.maps.get(this.currentMapId);
		if (!rt) return null;
		return rt.tileByKey.get(key(pos)) ?? null;
	}

	isBlocked(pos: MapPos): boolean {
		const map = this.currentMap;
		if (pos.x < 0 || pos.y < 0 || pos.x >= map.w || pos.y >= map.h) return true;
		const t = this.getTileAt(pos);
		return Boolean(t?.blocked);
	}

	computePath(to: MapPos, opts?: { allowEnterBlockedDestination?: boolean }): MapPos[] {
		const map = this.currentMap;
		const from = this.playerPos;
		const allowBlockedDest = Boolean(opts?.allowEnterBlockedDestination);
		const dest: MapPos = {
			x: clampInt(to.x, 0, Math.max(0, map.w - 1)),
			y: clampInt(to.y, 0, Math.max(0, map.h - 1)),
		};
		if (from.x === dest.x && from.y === dest.y) return [];
		if (this.isBlocked(dest) && !allowBlockedDest) return [];

		const q: MapPos[] = [{ x: from.x, y: from.y }];
		const visited = new Set<string>([key(from)]);
		const cameFrom = new Map<string, string | null>();
		cameFrom.set(key(from), null);

		const deltas = [
			{ x: 1, y: 0 },
			{ x: -1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 0, y: -1 },
		];

		while (q.length) {
			const cur = q.shift()!;
			if (cur.x === dest.x && cur.y === dest.y) break;
			for (const d of deltas) {
				const nx = cur.x + d.x;
				const ny = cur.y + d.y;
				if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
				const next = { x: nx, y: ny };
				const k = key(next);
				if (visited.has(k)) continue;
				if (this.isBlocked(next) && !(allowBlockedDest && nx === dest.x && ny === dest.y)) continue;
				visited.add(k);
				cameFrom.set(k, key(cur));
				q.push(next);
			}
		}

		const destKey = key(dest);
		if (!cameFrom.has(destKey)) return [];

		const path: MapPos[] = [];
		let curKey: string | null = destKey;
		while (curKey && curKey !== key(from)) {
			const [sx, sy] = curKey.split(',');
			path.unshift({ x: Number(sx), y: Number(sy) });
			curKey = cameFrom.get(curKey) ?? null;
		}
		return path;
	}

	tryStepTo(next: MapPos): boolean {
		const map = this.currentMap;
		if (next.x < 0 || next.y < 0 || next.x >= map.w || next.y >= map.h) return false;
		if (this.isBlocked(next)) return false;
		this._playerPos = { x: next.x, y: next.y };
		this.emit('tileEnter', { mapId: this.currentMapId, pos: this.playerPos, tile: this.getTileAt(next) });
		return true;
	}

	interact(): void {
		this.emit('tileInteract', { mapId: this.currentMapId, pos: this.playerPos, tile: this.getTileAt(this._playerPos) });
	}

	consumeOnce(mapId: MapId, token: string): boolean {
		const rt = this.maps.get(mapId);
		if (!rt) return false;
		if (rt.onceConsumed.has(token)) return false;
		rt.onceConsumed.add(token);
		return true;
	}
}
