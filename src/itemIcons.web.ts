import { escapeHtml } from './utils.web.js';

export type ItemLike = {
    id?: unknown;
    name?: unknown;
    description?: unknown;
    icon?: unknown;
    image?: unknown;
    stackable?: unknown;
    quantity?: unknown;
};

export function getItemIconSrc(item: ItemLike | null | undefined): string | null {
    if (!item) return null;

    const direct = (item as any)?.icon ?? (item as any)?.image;
    if (typeof direct === 'string' && direct.trim()) return direct;

    const id = String((item as any)?.id ?? '').toLowerCase();
    const name = String((item as any)?.name ?? '').toLowerCase();

    if (id === 'pomme' || name === 'pomme') return 'ImagesRPG/imagesobjets/pomme.png';

    if (id === 'potion_small' || name === 'potion de soin') return 'ImagesRPG/imagesobjets/potionsoin.png';
    if (id === 'mana_small' || name.includes('potion de mana')) return 'ImagesRPG/imagesobjets/potion_violet.png';

    // Requested: Épée de bronze
    if (id === 'sword_bronze' || id === 'sword_fer' || name.includes('épée de bronze') || name.includes('epee de bronze') || name.includes('épée de fer') || name.includes('epee de fer')) return 'ImagesRPG/imagesobjets/epee_fer.png';

    // Requested: Dague de fer
    if (id === 'dague_fer' || name.includes('dague de fer')) return 'ImagesRPG/imagesobjets/dague_tier2.png';

    // Requested: Épée basique
    if (id === 'sword_1' || name.includes('épée basique') || name.includes('epee basique')) return 'ImagesRPG/imagesobjets/epee1.png';

    // Requested: Dagues rouillées
    if (id === 'dagues_rouille' || name.includes('dagues rouill')) return 'ImagesRPG/imagesobjets/dague_rouillee.png';

    // Requested: Bâton de novice
    if (id === 'staff_novice' || name.includes('bâton de novice') || name.includes('baton de novice')) return 'ImagesRPG/imagesobjets/baton_novice.png';

    // Requested: Armure de cuir
    if (id === 'armor_1' || name.includes('armure de cuir')) return 'ImagesRPG/imagesobjets/armure_cuir.png';

    return null;
}

export function buildItemTooltip(item: ItemLike | null | undefined): string {
    const name = String((item as any)?.name ?? 'Objet');
    const desc = String((item as any)?.description ?? '').trim();

    const qty = Math.max(1, Math.floor(Number((item as any)?.quantity ?? 1)));
    const isStackable = Boolean((item as any)?.stackable);

    const firstLine = isStackable && qty > 1 ? `${name} x${qty}` : name;
    return desc ? `${firstLine}\n${desc}` : firstLine;
}

export function renderItemIconHtml(
    item: ItemLike | null | undefined,
    opts: { size?: number; title?: string } = {}
): string {
    const size = Math.max(18, Math.floor(Number(opts.size ?? 51)));
    const title = opts.title ?? buildItemTooltip(item);

    const src = getItemIconSrc(item);
    const baseStyle = `width:${size}px;height:${size}px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);`;

    if (src) {
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(String((item as any)?.name ?? 'Objet'))}" title="${escapeHtml(title)}" style="${baseStyle}padding:4px;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.35));" />`;
    }

    const fallback = String((item as any)?.name ?? '?').trim();
    const firstChar = fallback && fallback.length > 0 ? fallback.charAt(0) : '?';
    const letter = escapeHtml(firstChar.toUpperCase());
    return `<span title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" style="${baseStyle}font-weight:900;color:#fff;opacity:0.9;">${letter}</span>`;
}
