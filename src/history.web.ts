export type HistoryEntry = { turn: number; text: string };

export function pushHistory(history: HistoryEntry[], turn: number, text: string): void {
    history.push({ turn, text });
}

export function pushHistoryMany(history: HistoryEntry[], turn: number, texts: string[]): void {
    texts.forEach((t) => history.push({ turn, text: t }));
}

export function renderHistoryHtml(history: HistoryEntry[], maxItems: number): string {
    return history
        .slice(-maxItems)
        .map((h) => `<div><b>[${h.turn}]</b> ${h.text}</div>`)
        .join('');
}
