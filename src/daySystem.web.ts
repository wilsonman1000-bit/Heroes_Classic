import { runMarketDailyTick } from './market/market.web.js';

export const GAME_DAY_EVENT = 'gameDayAdvanced';

// Optional: emitted when hours advance (including when it causes a day advance).
export const GAME_TIME_EVENT = 'gameTimeAdvanced';

export type AdvanceDayResult = {
	day: number;
	hour?: number;
	market?: { soldCount: number; soldTotal: number };
};

export type AdvanceTimeResult = {
	day: number;
	hour: number;
	daysAdvanced: number;
	market?: { soldCount: number; soldTotal: number };
};

function clampInt(n: unknown, min = 0): number {
	const v = Math.floor(Number(n ?? 0));
	if (!Number.isFinite(v)) return min;
	return Math.max(min, v);
}

function clampIntRange(n: unknown, min: number, max: number): number {
	const v = Math.floor(Number(n ?? min));
	if (!Number.isFinite(v)) return min;
	return Math.max(min, Math.min(max, v));
}

export function getGameDay(hero: any): number {
	// Prefer the global day. Fallback to legacy marketDay for older saves.
	const day = clampInt((hero as any)?.day ?? (hero as any)?.marketDay ?? 1, 1);
	(hero as any).day = day;
	// Keep legacy field in sync while the migration is ongoing.
	if ((hero as any).marketDay === undefined || (hero as any).marketDay === null) {
		(hero as any).marketDay = day;
	}
	return day;
}

export function getGameHour(hero: any): number {
	const hour = clampIntRange((hero as any)?.hour ?? 0, 0, 23);
	(hero as any).hour = hour;
	return hour;
}

export function setGameHour(hero: any, hour: number): number {
	const v = clampIntRange(hour, 0, 23);
	(hero as any).hour = v;
	return v;
}

export function getGameTime(hero: any): { day: number; hour: number } {
	return { day: getGameDay(hero), hour: getGameHour(hero) };
}

export function setGameDay(hero: any, day: number): number {
	const v = clampInt(day, 1);
	(hero as any).day = v;
	// Keep legacy field in sync for now.
	(hero as any).marketDay = v;
	return v;
}

export function setGameTime(hero: any, time: { day: number; hour: number }): { day: number; hour: number } {
	const day = setGameDay(hero, time.day);
	const hour = setGameHour(hero, time.hour);
	return { day, hour };
}

export function advanceGameTimeHours(hero: any, hours: number, opts: { reason?: string } = {}): AdvanceTimeResult {
	const prevDay = getGameDay(hero);
	const prevHour = getGameHour(hero);
	const add = clampInt(hours, 0);
	const total = prevHour + add;
	const daysAdvanced = Math.floor(total / 24);
	const hour = clampIntRange(total % 24, 0, 23);

	let day = prevDay;
	let market: { soldCount: number; soldTotal: number } | undefined;
	if (daysAdvanced > 0) {
		for (let i = 0; i < daysAdvanced; i++) {
			day = setGameDay(hero, day + 1);
			try {
				market = runMarketDailyTick(hero, day);
			} catch (e) {
				console.error('[daySystem] runMarketDailyTick error', e);
			}
			try {
				window.dispatchEvent(
					new CustomEvent(GAME_DAY_EVENT, {
						detail: { day, reason: String(opts.reason ?? '') },
					})
				);
			} catch {
				// ignore
			}
		}
	} else {
		day = prevDay;
	}

	setGameHour(hero, hour);

	try {
		window.dispatchEvent(
			new CustomEvent(GAME_TIME_EVENT, {
				detail: { day, hour, daysAdvanced, reason: String(opts.reason ?? '') },
			})
		);
	} catch {
		// ignore
	}

	const res: AdvanceTimeResult = { day, hour, daysAdvanced, ...(market ? { market } : {}) };
	return res;
}

export function advanceGameDay(hero: any, opts: { reason?: string } = {}): AdvanceDayResult {
	// Semantic: "passer au lendemain". We advance by 1 day and reset the hour to morning (0).
	const prev = getGameDay(hero);
	const day = setGameDay(hero, prev + 1);
	const hour = setGameHour(hero, 0);

	let market: { soldCount: number; soldTotal: number } | undefined;
	try {
		market = runMarketDailyTick(hero, day);
	} catch (e) {
		console.error('[daySystem] runMarketDailyTick error', e);
	}

	try {
		window.dispatchEvent(
			new CustomEvent(GAME_DAY_EVENT, {
				detail: { day, reason: String(opts.reason ?? '') },
			})
		);
	} catch {
		// ignore
	}

	try {
		window.dispatchEvent(
			new CustomEvent(GAME_TIME_EVENT, {
				detail: { day, hour, daysAdvanced: 1, reason: String(opts.reason ?? '') },
			})
		);
	} catch {
		// ignore
	}

	return market ? { day, hour, market } : { day, hour };
}
