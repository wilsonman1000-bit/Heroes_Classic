import { escapeHtml } from '../utils.web.js';
import { showTemporaryMessage } from '../uiNotifications.js';
import { renderInventory, wireInventoryActions } from '../ui.js';
import { Equipment, EQUIPMENT_SLOTS, type EquipmentSlot, Item } from '../item.js';
import { buildItemTooltip, renderItemIconHtml } from '../itemIcons.web.js';

type MarketSlot = {
    item: Item;
    price: number; // prix unitaire
    listedDay: number;
    basePrice: number;
};

type MarketUnsoldEntry = {
    item: Item;
    price: number; // prix unitaire
    listedDay: number;
    basePrice: number;
};

type MarketHistoryEntry = {
    day: number;
    item: Item;
    price: number; // total encaissé (prix unitaire * quantité)
};

type MarketState = {
    slots: Array<MarketSlot | null>; // length 3
    pendingGold: number;
    history: MarketHistoryEntry[];
    unsold: MarketUnsoldEntry[];
};

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function clampInt(n: unknown, min = 0): number {
    const v = Math.floor(Number(n ?? 0));
    if (!Number.isFinite(v)) return min;
    return Math.max(min, v);
}

function getMarketDay(hero: any): number {
    // Market day is now the global game day (hero.day). Keep marketDay as a legacy mirror for older saves.
    const day = clampInt((hero as any)?.day ?? (hero as any)?.marketDay ?? 1, 1);
    (hero as any).day = day;
    if ((hero as any).marketDay === undefined || (hero as any).marketDay === null) (hero as any).marketDay = day;
    return day;
}

function ensureMarket(hero: any): MarketState {
    const existing = hero?.market as MarketState | undefined;
    if (existing && Array.isArray(existing.slots)) {
        // normalize
        existing.slots = [0, 1, 2].map((i) => (existing.slots[i] ? existing.slots[i] : null));
        existing.pendingGold = clampInt((existing as any).pendingGold ?? 0, 0);
        existing.history = Array.isArray((existing as any).history) ? ((existing as any).history as any[]).filter(Boolean) : [];
        existing.unsold = Array.isArray((existing as any).unsold) ? ((existing as any).unsold as any[]).filter(Boolean) : [];
        return existing;
    }

    const state: MarketState = {
        slots: [null, null, null],
        pendingGold: 0,
        history: [],
        unsold: [],
    };
    hero.market = state;
    return state;
}

function estimateBasePrice(item: Item): number {
    const id = String((item as any).id ?? '').toLowerCase();
    const name = String((item as any).name ?? '').toLowerCase();

    // Known shop baselines
    if (id === 'potion_small' || name.includes('potion de soin')) return 50;
    if (id === 'mana_small' || name.includes('potion de mana')) return 30;
    if (id === 'feu_de_camp' || name.includes('feu de camp')) return 60;

    if (item instanceof Equipment) {
        const eq = item as Equipment;

        const qRaw = clampInt((eq as any).fabricationQuality ?? 1, 1);
        const q = clamp(qRaw, 1, 5);
        const qualityMult = Math.pow(2, q - 1); // Q2 = Q1*2, Q3 = Q2*2, Q4 = Q3*2, Q5 = Q4*2

        // Specific requested base prices for Q1
        let baseQ1: number | null = null;
        if (id === 'sword_wood') baseQ1 = 20;
        if (id === 'sword_1') baseQ1 = 100;

        if (baseQ1 === null) {
            const atk = clampInt(eq.attackBonus ?? 0, 0);
            const def = clampInt(eq.defenseBonus ?? 0, 0);
            const hp = clampInt(eq.hpBonus ?? 0, 0);
            const mana = clampInt(eq.manaBonus ?? 0, 0);
            // Heuristic baseline = Q1
            const raw = 10 + atk * 12 + def * 10 + hp * 1 + mana * 1;
            baseQ1 = clampInt(raw, 5);
        }

        return clampInt(baseQ1 * qualityMult, 1);
    }

    // Fallback for generic items
    return 25;
}

function estimateSellChance(basePrice: number, chosenPrice: number): number {
    const bp = Math.max(1, clampInt(basePrice, 1));
    const p = Math.max(1, clampInt(chosenPrice, 1));
    // If price == base => 90% chance. Higher price reduces linearly; cheaper prices increase chance (clamped).
    // Use 0.9 as baseline multiplier so p==bp => 0.9.
    const chance = 0.9 * (bp / p);
    return clamp(chance, 0.05, 0.95);
}

function getStackQty(item: Item): number {
    const q = Math.floor(Number((item as any)?.quantity ?? 1));
    if (!Number.isFinite(q)) return 1;
    return Math.max(1, q);
}

function formatNameWithQty(item: Item): string {
    const name = String((item as any)?.name ?? 'Objet');
    const qty = getStackQty(item);
    const isStackable = Boolean((item as any)?.stackable);
    return isStackable && qty > 1 ? `${name} x${qty}` : name;
}

function formatPct(p: number): string {
    return `${Math.round(p * 100)}%`;
}

function formatGold(n: unknown): string {
    const v = clampInt(n, 0);
    return String(v);
}

function openModal(opts: { title: string; bodyHtml: string; onClose?: () => void }) {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:rgba(0,0,0,0.65)',
        'z-index:1100',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:16px',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
        'width:min(920px, 96vw)',
        'max-height:86vh',
        'overflow:auto',
        'background:rgba(15,15,15,0.96)',
        'border:1px solid rgba(255,255,255,0.14)',
        'border-radius:14px',
        'box-shadow:0 18px 60px rgba(0,0,0,0.55)',
        'padding:14px',
        'color:#fff',
    ].join(';');

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="font-size:1.05em;font-weight:900;">${escapeHtml(opts.title)}</div>
            <button class="btn" data-modal-close style="min-width:90px;">Fermer</button>
        </div>
        <div>${opts.bodyHtml}</div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = () => {
        overlay.remove();
        opts.onClose?.();
    };

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    panel.querySelector('[data-modal-close]')?.addEventListener('click', close);

    return { overlay, panel, close };
}

function openHistoryModal(hero: any, onClose: () => void) {
    const market = ensureMarket(hero);
    const history = [...(market.history || [])].slice(-50).reverse();

    const bodyHtml = `
        <div style="color:#ddd;margin-bottom:10px;">Historique (50 derniers objets vendus)</div>
        <div style="max-height:62vh;overflow:auto;padding-right:6px;">
            ${history.length === 0 ? `<div style="color:#bbb;">Aucune vente pour l'instant.</div>` : `
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${history
                        .map((h) => {
                            const icon = renderItemIconHtml(h.item, { size: 51 });
                            return `
                                <div style="background:rgba(0,0,0,0.20);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px;display:flex;justify-content:space-between;gap:12px;">
                                    <div>
                                        <div style="display:flex;align-items:center;gap:10px;">${icon}</div>
                                        <div style="color:#aaa;font-size:0.9em;">Vendu le jour ${formatGold(h.day)}</div>
                                    </div>
                                    <div style="white-space:nowrap;font-weight:900;">${formatGold(h.price)} or</div>
                                </div>
                            `;
                        })
                        .join('')}
                </div>
            `}
        </div>
    `;

    openModal({ title: 'Historique des ventes', bodyHtml, onClose });
}

function openInventorySellModal(hero: any, slotIndex: number, onDone: () => void) {
    const market = ensureMarket(hero);
    const day = getMarketDay(hero);

    type Selection =
        | { kind: 'inventory'; index: number }
        | { kind: 'equipped'; slot: EquipmentSlot }
        | null;

    let selection: Selection = null;
    let price = 0; // prix unitaire
    let quantity = 1;

    const getSelectedItem = (): Item | null => {
        if (!selection) return null;
        if (selection.kind === 'inventory') {
            return hero.inventory?.[selection.index] ?? null;
        }
        return hero.equipment?.[selection.slot] ?? null;
    };

    const getSelectedMaxQty = (): number => {
        const it = getSelectedItem();
        if (!it) return 1;
        const qty = getStackQty(it);
        const isStackable = Boolean((it as any)?.stackable);
        return isStackable ? qty : 1;
    };

    const clampQty = (n: unknown): number => {
        const max = getSelectedMaxQty();
        const v = clampInt(n, 1);
        return Math.max(1, Math.min(max, v));
    };

    const cloneItemWithQty = (src: Item, qty: number): Item => {
        const out = Object.assign(Object.create(Object.getPrototypeOf(src)), src) as Item;
        (out as any).quantity = Math.max(1, Math.floor(Number(qty)));
        return out;
    };

    const render = () => {
        const inv = (hero.inventory ?? []) as Item[];
        const eqSlots = (EQUIPMENT_SLOTS ?? []) as EquipmentSlot[];

        const selectedItem = getSelectedItem();
        const base = selectedItem ? estimateBasePrice(selectedItem) : 0;
        const chosen = clampInt(price, 0);
        const qtyMax = getSelectedMaxQty();
        const qty = selectedItem ? clampQty(quantity) : 1;
        const total = selectedItem && chosen > 0 ? chosen * qty : 0;
        const fee = total > 0 ? Math.max(1, Math.floor(total * 0.05)) : 0;
        const chance = selectedItem && chosen > 0 ? estimateSellChance(base, chosen) : 0;

        return `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;">
                <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:12px;">
                    <div style="font-weight:900;margin-bottom:8px;">Inventaire</div>
                    <div style="max-height:46vh;overflow:auto;padding-right:6px;">
                        ${inv.length === 0 ? `<div style="color:#bbb;">Inventaire vide.</div>` : `
                            <div style="display:flex;flex-direction:column;gap:8px;">
                                ${inv
                                    .map((it, idx) => {
                                        const isSelected = selection?.kind === 'inventory' && selection.index === idx;
                                        const baseP = estimateBasePrice(it);
                                        const title = buildItemTooltip(it);
                                        const icon = renderItemIconHtml(it, { size: 48, title });
                                        const qty = getStackQty(it);
                                        const showQty = Boolean((it as any)?.stackable) && qty > 1;
                                        const qtyHtml = showQty ? `<span style="opacity:0.9;font-weight:900;">x${qty}</span>` : '';
                                        return `
                                            <button class="btn" data-sel-inv="${idx}" title="${escapeHtml(title)}" style="text-align:left;display:flex;align-items:center;justify-content:space-between;gap:10px;${isSelected ? 'outline:2px solid rgba(255,235,59,0.8);' : ''}">
                                                <span style="display:flex;align-items:center;gap:10px;">${icon}${qtyHtml}</span>
                                                <span style="opacity:0.8;">≈ ${formatGold(baseP)} or</span>
                                            </button>
                                        `;
                                    })
                                    .join('')}
                            </div>
                        `}
                    </div>

                    <div style="margin-top:12px;font-weight:900;margin-bottom:8px;">Équipement porté</div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        ${eqSlots
                            .map((slot) => {
                                const it = hero.equipment?.[slot] as Item | undefined;
                                const isSelected = selection?.kind === 'equipped' && selection.slot === slot;
                                if (!it) {
                                    return `<div style="color:#777;background:rgba(0,0,0,0.10);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:8px;">${escapeHtml(slot)} : —</div>`;
                                }
                                const baseP = estimateBasePrice(it);
                                const title = buildItemTooltip(it);
                                const icon = renderItemIconHtml(it, { size: 48, title });
                                return `
                                    <button class="btn" data-sel-eq="${escapeHtml(String(slot))}" title="${escapeHtml(title)}" style="text-align:left;display:flex;align-items:center;justify-content:space-between;gap:10px;${isSelected ? 'outline:2px solid rgba(255,235,59,0.8);' : ''}">
                                        <span style="display:flex;align-items:center;gap:10px;">${icon} <span style="opacity:0.75;">(${escapeHtml(String(slot))})</span></span>
                                        <span style="opacity:0.8;">≈ ${formatGold(baseP)} or</span>
                                    </button>
                                `;
                            })
                            .join('')}
                    </div>
                </div>

                <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:12px;">
                    <div style="font-weight:900;margin-bottom:8px;">Mise en vente (slot ${slotIndex + 1})</div>

                    <div style="color:#ddd;">Objet sélectionné :</div>
                    <div style="margin:6px 0 10px 0;font-weight:900;">
                        ${selectedItem ? renderItemIconHtml(selectedItem, { size: 60 }) : '<span style="color:#777;">—</span>'}
                    </div>

                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                        <label style="font-weight:800;">Prix (unité) :</label>
                        <input id="marketPriceInput" type="number" min="1" step="1" value="${chosen > 0 ? chosen : ''}" placeholder="ex: ${base || ''}" style="width:140px;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.28);color:#fff;" />
                        <button class="btn" id="marketSuggestBtn" ${selectedItem ? '' : 'disabled'}>Prix conseillé</button>
                    </div>

                    ${selectedItem && Boolean((selectedItem as any)?.stackable) && qtyMax > 1 ? `
                        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;">
                            <label style="font-weight:800;">Quantité :</label>
                            <input id="marketQtyInput" type="number" min="1" max="${qtyMax}" step="1" value="${qty}" style="width:110px;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.28);color:#fff;" />
                            <div style="color:#aaa;">(disponible: ${qtyMax})</div>
                        </div>
                        <div style="margin-top:8px;color:#ddd;">Total : <b id="marketTotalValue">${total > 0 ? `${formatGold(total)} or` : '—'}</b></div>
                    ` : ''}

                    <div id="marketFeeArea" style="margin-top:10px;color:#bbb;font-size:0.92em;">
                        Taxe de dépôt : <b id="marketFeeValue">${fee ? `${formatGold(fee)} or` : '—'}</b> (5% du total)
                        <span id="marketChanceArea">${selectedItem && chosen > 0 ? `<br>Chance estimée de vente aujourd'hui : <b id="marketChanceValue">${formatPct(chance)}</b>` : ''}</span>
                    </div>

                    <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">
                        <button class="btn" id="marketConfirmListBtn" ${selectedItem && chosen > 0 ? '' : 'disabled'} style="min-width:180px;">Déposer en vente</button>
                        <button class="btn" id="marketCancelSelectBtn">Annuler</button>
                    </div>

                    <div style="margin-top:12px;color:#aaa;font-size:0.9em;">
                        Or actuel : <b>${formatGold(hero.gold)}</b>
                    </div>
                </div>
            </div>
        `;
    };

    const modal = openModal({
        title: 'Choisir un objet à vendre',
        bodyHtml: `<div id="marketSellModalRoot"></div>`,
        onClose: () => onDone(),
    });

    const root = modal.panel.querySelector('#marketSellModalRoot') as HTMLElement | null;
    if (!root) return;

    const rerender = () => {
        root.innerHTML = render();

        // Selection handlers
        (root.querySelectorAll('[data-sel-inv]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = clampInt(btn.getAttribute('data-sel-inv'), 0);
                selection = { kind: 'inventory', index: idx };
                const item = getSelectedItem();
                price = item ? estimateBasePrice(item) : 0;
                quantity = 1;
                rerender();
            });
        });

        (root.querySelectorAll('[data-sel-eq]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
            btn.addEventListener('click', () => {
                const slot = (btn.getAttribute('data-sel-eq') as EquipmentSlot) ?? 'weapon';
                selection = { kind: 'equipped', slot };
                const item = getSelectedItem();
                price = item ? estimateBasePrice(item) : 0;
                quantity = 1;
                rerender();
            });
        });

        const priceInput = root.querySelector('#marketPriceInput') as HTMLInputElement | null;
        priceInput?.addEventListener('input', () => {
            // Update the model but avoid re-rendering the whole modal to keep focus inside the input
            price = clampInt(priceInput.value, 0);
            const feeValue = root.querySelector('#marketFeeValue') as HTMLElement | null;
            const chanceArea = root.querySelector('#marketChanceArea') as HTMLElement | null;
            const confirmBtn = root.querySelector('#marketConfirmListBtn') as HTMLButtonElement | null;
            const totalValue = root.querySelector('#marketTotalValue') as HTMLElement | null;
            const chosen = clampInt(price, 0);
            const curItem = getSelectedItem();
            const qty = curItem ? clampQty(quantity) : 1;
            const total = curItem && chosen > 0 ? chosen * qty : 0;
            const newFee = total > 0 ? Math.max(1, Math.floor(total * 0.05)) : 0;
            if (feeValue) feeValue.textContent = newFee ? `${formatGold(newFee)} or` : '—';
            const curBase = curItem ? estimateBasePrice(curItem) : 0;
            if (chanceArea) chanceArea.innerHTML = curItem && chosen > 0 ? `<br>Chance estimée de vente aujourd'hui : <b id="marketChanceValue">${formatPct(estimateSellChance(curBase, chosen))}</b>` : '';
            if (totalValue) totalValue.textContent = total > 0 ? `${formatGold(total)} or` : '—';
            if (confirmBtn) confirmBtn.disabled = !(curItem && chosen > 0);
        });

        const qtyInput = root.querySelector('#marketQtyInput') as HTMLInputElement | null;
        qtyInput?.addEventListener('input', () => {
            quantity = clampQty(qtyInput.value);
            const chosen = clampInt(price, 0);
            const curItem = getSelectedItem();
            const qty = curItem ? clampQty(quantity) : 1;
            const total = curItem && chosen > 0 ? chosen * qty : 0;
            const feeValue = root.querySelector('#marketFeeValue') as HTMLElement | null;
            const totalValue = root.querySelector('#marketTotalValue') as HTMLElement | null;
            const newFee = total > 0 ? Math.max(1, Math.floor(total * 0.05)) : 0;
            if (feeValue) feeValue.textContent = newFee ? `${formatGold(newFee)} or` : '—';
            if (totalValue) totalValue.textContent = total > 0 ? `${formatGold(total)} or` : '—';
        });

        root.querySelector('#marketSuggestBtn')?.addEventListener('click', () => {
            const item = getSelectedItem();
            if (!item) return;
            price = estimateBasePrice(item);
            rerender();
        });

        root.querySelector('#marketCancelSelectBtn')?.addEventListener('click', () => {
            modal.close();
        });

        root.querySelector('#marketConfirmListBtn')?.addEventListener('click', () => {
            const item = getSelectedItem();
            const chosenPrice = clampInt(price, 1);
            if (!item) return;

            const qtyToList = clampQty(quantity);
            const totalPrice = Math.max(1, chosenPrice * Math.max(1, qtyToList));

            if (market.slots[slotIndex]) {
                showTemporaryMessage('Ce slot est déjà occupé.', 2500);
                return;
            }

            const fee = Math.max(1, Math.floor(totalPrice * 0.05));
            if (clampInt(hero.gold, 0) < fee) {
                showTemporaryMessage(`Pas assez d'or pour la taxe (${fee} or).`, 3000);
                return;
            }

            // Pay fee now
            hero.gold = clampInt(hero.gold, 0) - fee;
            showTemporaryMessage(`Taxe payée : -${fee} or (5%)`, 2800);

            // Remove item from source
            let moved: Item | null = null;
            if (selection?.kind === 'inventory') {
                const src = (hero.inventory ?? [])[selection.index] as Item | undefined;
                if (src && Boolean((src as any)?.stackable) && getStackQty(src) > 1 && qtyToList < getStackQty(src)) {
                    (src as any).quantity = getStackQty(src) - qtyToList;
                    moved = cloneItemWithQty(src, qtyToList);
                } else {
                    moved = hero.removeItem?.(selection.index) ?? null;
                    if (moved && Boolean((moved as any)?.stackable)) (moved as any).quantity = Math.max(1, qtyToList);
                }
            } else if (selection?.kind === 'equipped') {
                // Unequip to inventory then remove last item (simpler + keeps side effects consistent)
                const beforeLen = (hero.inventory ?? []).length;
                hero.unequipSlot?.(selection.slot);
                const afterLen = (hero.inventory ?? []).length;
                if (afterLen > beforeLen) {
                    const idx = afterLen - 1;
                    const src = (hero.inventory ?? [])[idx] as Item | undefined;
                    if (src && Boolean((src as any)?.stackable) && getStackQty(src) > 1 && qtyToList < getStackQty(src)) {
                        (src as any).quantity = getStackQty(src) - qtyToList;
                        moved = cloneItemWithQty(src, qtyToList);
                    } else {
                        moved = hero.removeItem?.(idx) ?? null;
                        if (moved && Boolean((moved as any)?.stackable)) (moved as any).quantity = Math.max(1, qtyToList);
                    }
                }
            }

            if (!moved) {
                showTemporaryMessage("Impossible de déplacer l'objet.", 3000);
                // refund fee to avoid frustration
                hero.gold = clampInt(hero.gold, 0) + fee;
                return;
            }

            const base = estimateBasePrice(moved);
            market.slots[slotIndex] = { item: moved, price: chosenPrice, listedDay: day, basePrice: base };

            modal.close();
            onDone();
        });
    };

    rerender();
}

export function runMarketDailyTick(hero: any, dayOverride?: number): { soldCount: number; soldTotal: number } {
    const market = ensureMarket(hero);
    const day = Number.isFinite(Number(dayOverride)) ? clampInt(dayOverride, 1) : getMarketDay(hero);

    let soldCount = 0;
    let soldTotal = 0;

    for (let i = 0; i < market.slots.length; i++) {
        const slot = market.slots[i];
        if (!slot) continue;

        const chance = estimateSellChance(slot.basePrice, slot.price);
        if (Math.random() <= chance) {
            soldCount += 1;
            const qty = getStackQty(slot.item);
            const total = clampInt(slot.price, 0) * qty;
            soldTotal += total;
            market.pendingGold = clampInt(market.pendingGold, 0) + total;
            market.history = [...(market.history || []), { day, item: slot.item, price: total }].slice(-200);
            market.slots[i] = null;
        } else {
            // Not sold today: remove from slot but keep visible in the "Non vendus" panel.
            market.unsold = [...(market.unsold || []), { item: slot.item, price: slot.price, listedDay: slot.listedDay, basePrice: slot.basePrice }].slice(-50);
            market.slots[i] = null;
        }
    }

    return { soldCount, soldTotal };
}

// Legacy exported wrapper so older screens can still advance the day.
// Prefer using advanceGameDay() from daySystem.web.ts so day advancement is not market-specific.
export function advanceMarketOneDay(hero: any): { soldCount: number; soldTotal: number } {
    const prev = getMarketDay(hero);
    const day = prev + 1;
    (hero as any).day = day;
    (hero as any).marketDay = day;
    return runMarketDailyTick(hero, day);
}

export function showMarche(options: { hero: any; onBack?: () => void } ) {
    const { hero, onBack } = options;
    const app = document.getElementById('app');
    if (!app) return;

    const rerender = () => showMarche(onBack ? { hero, onBack } : { hero });

    const market = ensureMarket(hero);
    const day = getMarketDay(hero);

    const renderSlot = (slot: MarketSlot | null, idx: number): string => {
        if (!slot) {
            return `
                <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;">
                    <div style="font-weight:900;">Slot ${idx + 1}</div>
                    <div style="color:#777;">(vide)</div>
                    <button class="btn" data-slot-deposit="${idx}">Déposer un objet</button>
                </div>
            `;
        }
        const chance = estimateSellChance(slot.basePrice, slot.price);
        const icon = renderItemIconHtml(slot.item, { size: 57 });
        const qty = slot?.item ? getStackQty(slot.item) : 1;
        const total = clampInt(slot.price, 0) * qty;
        const priceTxt = qty > 1 ? `${formatGold(slot.price)} or (unité) — total ${formatGold(total)} or` : `${formatGold(slot.price)} or`;
        return `
            <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                    <div>
                        <div style="font-weight:900;">Slot ${idx + 1}</div>
                        <div style="margin-top:8px;display:flex;align-items:center;gap:10px;">${icon}</div>
                        <div style="color:#bbb;font-size:0.92em;">Mis en vente jour ${formatGold(slot.listedDay)}</div>
                    </div>
                    <div style="white-space:nowrap;text-align:right;">
                        <div style="font-weight:900;">${escapeHtml(priceTxt)}</div>
                        <div style="color:#aaa;font-size:0.88em;">Chance: ${formatPct(chance)}</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn" data-slot-withdraw="${idx}" style="min-width:140px;">Retirer</button>
                </div>
            </div>
        `;
    };

    app.innerHTML = `
        <img src="https://i.pinimg.com/originals/af/ea/54/afea54a4884f91e673872f822a0c72e6.jpg" class="background" alt="Marché">
        <div class="centered-content" style="padding-top:26px;max-width:1100px;">
            <h1>Marché</h1>

            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
                <div style="color:#ddd;">
                    <div><b>Jour :</b> ${formatGold(day)}</div>
                    <div style="font-size:0.95em;color:#aaa;">Ventes possibles chaque jour selon votre prix.</div>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
                    <button class="btn" id="marketHistoryBtn" style="min-width:180px;">Historique des ventes</button>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1.2fr 0.8fr;gap:16px;align-items:start;">
                <div>
                    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;">
                        ${renderSlot(market.slots[0] ?? null, 0)}
                        ${renderSlot(market.slots[1] ?? null, 1)}
                        ${renderSlot(market.slots[2] ?? null, 2)}
                    </div>

                    <div style="margin-top:14px;background:rgba(0,0,0,0.16);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:12px;">
                        <div style="font-weight:900;margin-bottom:8px;">Rappel</div>
                        <div style="color:#bbb;font-size:0.95em;line-height:1.45;">
                            Déposer un objet coûte <b>5%</b> du prix (taxe). Vous pouvez retirer l'objet à tout moment.
                        </div>
                    </div>
                </div>

                <div>
                    <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:12px;">
                        <div style="font-weight:900;margin-bottom:8px;">Argent à collecter</div>
                        <div style="font-size:1.2em;font-weight:900;">${formatGold(market.pendingGold)} or</div>
                        <button class="btn" id="marketCollectBtn" ${market.pendingGold > 0 ? '' : 'disabled'} style="margin-top:10px;min-width:160px;">Collecter</button>

                        <div style="margin-top:14px;color:#ddd;">
                            <div><b>Votre or :</b> ${formatGold(hero.gold)}</div>
                        </div>
                    </div>

                    <details style="margin-top:12px;background:rgba(0,0,0,0.14);border:1px solid rgba(255,255,255,0.10);border-radius:12px;" open>
                        <summary style="cursor:pointer;user-select:none;padding:10px 12px;font-weight:900;">Inventaire (aperçu)</summary>
                        <div style="padding:10px 12px;">
                            ${renderInventory(hero, { showGold: false, showWood: false })}
                        </div>
                    </details>

                    <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                        <button class="btn" id="marketBackBtn" style="min-width:180px;">Retour</button>
                    </div>
                </div>
            </div>

            <div style="margin-top:14px;background:rgba(0,0,0,0.16);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                    <div style="font-weight:900;">Objets non vendus</div>
                    <div style="color:#aaa;font-size:0.92em;">Ils sont retirés des slots après la journée. Récupère-les pour les remettre en vente depuis l'inventaire.</div>
                </div>

                <div style="margin-top:10px;">
                    ${(market.unsold || []).length === 0 ? `<div style=\"color:#777;\">Aucun objet non vendu.</div>` : `
                        <div style="display:flex;flex-direction:column;gap:8px;">
                            ${(market.unsold || []).slice().reverse().map((u, i) => {
                                const idx = (market.unsold || []).length - 1 - i;
                                const icon = u?.item ? renderItemIconHtml(u.item, { size: 51 }) : '';
                                const qty = u?.item ? getStackQty(u.item) : 1;
                                const total = clampInt(u.price, 0) * qty;
                                const priceTxt = qty > 1 ? `${formatGold(u.price)} or (unité) — total ${formatGold(total)} or` : `${formatGold(u.price)} or`;
                                return `
                                    <div style="background:rgba(0,0,0,0.20);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;">
                                        <div>
                                            <div style="display:flex;align-items:center;gap:10px;">${icon}${qty > 1 ? `<span style=\"opacity:0.9;font-weight:900;\">x${qty}</span>` : ''}</div>
                                            <div style="color:#aaa;font-size:0.9em;">Prix affiché: ${escapeHtml(priceTxt)} — mis en vente jour ${formatGold(u.listedDay)}</div>
                                        </div>
                                        <div style="white-space:nowrap;display:flex;gap:8px;">
                                            <button class="btn" data-unsold-take="${idx}" style="min-width:140px;">Récupérer</button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;

    // Wire inventory actions inside preview
    wireInventoryActions(app, hero, () => rerender());

    // Slot actions
    (app.querySelectorAll('[data-slot-deposit]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = clampInt(btn.getAttribute('data-slot-deposit'), 0);
            openInventorySellModal(hero, idx, () => rerender());
        });
    });

    (app.querySelectorAll('[data-slot-withdraw]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = clampInt(btn.getAttribute('data-slot-withdraw'), 0);
            const slot = market.slots[idx];
            if (!slot) return;
            hero.addItem?.(slot.item);
            market.slots[idx] = null;
            showTemporaryMessage('Objet retiré du marché.', 2200);
            rerender();
        });
    });

    // Unsold panel actions
    (app.querySelectorAll('[data-unsold-take]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = clampInt(btn.getAttribute('data-unsold-take'), 0);
            const u = (market.unsold || [])[idx];
            if (!u) return;
            hero.addItem?.(u.item);
            market.unsold = (market.unsold || []).filter((_, i) => i !== idx);
            showTemporaryMessage('Objet récupéré (inventaire).', 2400);
            rerender();
        });
    });

    // Collect
    document.getElementById('marketCollectBtn')?.addEventListener('click', () => {
        const amt = clampInt(market.pendingGold, 0);
        if (amt <= 0) return;
        hero.gold = clampInt(hero.gold, 0) + amt;
        market.pendingGold = 0;
        showTemporaryMessage(`+${amt} or collectés.`, 2600);
        rerender();
    });

    // History
    document.getElementById('marketHistoryBtn')?.addEventListener('click', () => {
        openHistoryModal(hero, () => rerender());
    });

    // Back
    document.getElementById('marketBackBtn')?.addEventListener('click', () => {
        if (onBack) onBack();
    });
}
