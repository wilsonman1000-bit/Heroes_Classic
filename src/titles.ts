function normalizeTitle(t: unknown): string {
    return String(t ?? '').trim();
}

export function ensureTitles(actor: any): string[] {
    if (!actor) return ['Mendiant'];

    const raw = (actor as any).titles;
    const list = Array.isArray(raw) ? raw.map(normalizeTitle).filter(Boolean) : [];

    if (list.length === 0) {
        (actor as any).titles = ['Mendiant'];
        return (actor as any).titles as string[];
    }

    (actor as any).titles = list;
    return list;
}

export function getTitles(actor: any): string[] {
    return ensureTitles(actor);
}

export function addTitle(actor: any, title: string): string[] {
    const t = normalizeTitle(title);
    const list = ensureTitles(actor);
    if (!t) return list;
    if (!list.includes(t)) list.push(t);
    (actor as any).titles = list;
    return list;
}
