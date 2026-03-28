// Fonctions d'affichage génériques et helpers DOM

import { Consumable, Equipment } from './item.js';
import { renderItemIconHtml } from './itemIcons.web.js';

function escapeAttr(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function renderHtml(elementId: string, html: string) {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = html;
}

// Affichage centralisé de l'inventaire du héros (HTML)
export function renderInventory(
    hero: any,
    opts: {
        showGold?: boolean;
        showWood?: boolean;
        transferFromPartyIdx?: number;
        transferTargets?: Array<{ partyIdx: number; label: string }>;
    } = {}
) {
    const {
        showGold = true,
        showWood = true,
        transferFromPartyIdx,
        transferTargets = [],
    } = opts;
    let html = '';
    if (showGold || showWood) {
        html += '<p style="margin:6px 0;">';
        if (showGold) html += `<b>Or :</b> ${hero.gold}`;
        if (showGold && showWood) html += ' &nbsp; ';
        if (showWood) html += `<b>Bois :</b> ${hero.wood ?? 0}`;
        html += '</p>';
    }
    html += `<div class="inventory-items" style="margin-top:8px; color:#ddd; font-size:0.95em;">
        ${hero.inventory.length === 0 ? `<em>Aucun objet</em>` : `
            <ul style="list-style:none;padding:0;margin:0;">
                ${hero.inventory.map((it: any, idx: number) => {
                    const qty = Math.max(1, Math.floor(Number((it as any)?.quantity ?? 1)));
                    const showQty = Boolean((it as any)?.stackable) && qty > 1;
                    const headerHtml = renderItemIconHtml(it, { size: 51 });

                    // Quality badge (if present)
                    const colorMap = ['#ffffff', '#4caf50', '#2196f3', '#9c27b0', '#ffb300'];
                    const nameMap = ['Blanc', 'Vert', 'Bleu', 'Violet', 'Orange/Doré'];
                    const q = Number((it as any).fabricationQuality ?? 0);
                    let qualityBadgeHtml = '';
                    if (q >= 1 && q <= 5) {
                        const c = colorMap[Math.max(0, Math.min(colorMap.length - 1, q - 1))];
                        const label = nameMap[Math.max(0, Math.min(nameMap.length - 1, q - 1))];
                        qualityBadgeHtml = `<span title="Qualité: ${escapeAttr(String(label))}" style="display:inline-block;margin-left:8px;vertical-align:middle;"><span style="width:12px;height:12px;border-radius:2px;background:${c};box-shadow:0 0 6px ${c};display:inline-block;border:1px solid rgba(0,0,0,0.25);"></span></span>`;
                    }
                    // Append badge regardless of HTML structure (img or div)
                    const qtyHtml = showQty ? `<span style="margin-left:2px;opacity:0.9;font-weight:900;">x${qty}</span>` : '';
                    const headerWithBadge = `<div style="display:flex;align-items:center;gap:8px;">${headerHtml}${qualityBadgeHtml}${qtyHtml}</div>`;

                    const giveBtns = (typeof transferFromPartyIdx === 'number' && transferTargets.length)
                        ? `<div style=\"margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;\">` +
                            transferTargets
                                .map((t) => `<button class=\"btn\" data-give-party-from=\"${transferFromPartyIdx}\" data-give-party-to=\"${t.partyIdx}\" data-give-inv-idx=\"${idx}\" style=\"min-width:90px; padding:4px 10px; font-size:0.85em;\">Donner → ${t.label}</button>`)
                                .join('') +
                          `</div>`
                        : '';

                    return `<li data-inv-row="${idx}" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;cursor:pointer;user-select:none;border-radius:10px;padding:6px 8px;">
                    <div style="flex:1;">
                        ${headerWithBadge}
                        ${giveBtns}
                    </div>
                    <div data-inv-actions="${idx}" style="white-space:nowrap;display:none;gap:8px;align-items:flex-start;">
                        ${it instanceof Consumable ? `<button class=\"btn\" data-inv-idx=\"${idx}\" style=\"min-width:80px;\">Utiliser</button>` : ''}
                        ${it instanceof Equipment ? `<button class=\"btn\" data-equip-idx=\"${idx}\" style=\"min-width:80px;\">Équiper</button>` : ''}
                    </div>
                </li>`;
                }).join('')}
            </ul>
        `}
    </div>`;
    return html;
}

// Centralise le branchement des boutons (Utiliser / Équiper) générés par renderInventory.
// À appeler après avoir injecté le HTML dans le DOM.
export function wireInventoryActions(root: ParentNode, hero: any, onAfterAction: () => void) {
    const invButtons = root.querySelectorAll('[data-inv-idx]');
    invButtons.forEach(btn => {
        (btn as HTMLElement).addEventListener('click', () => {
            const idx = Number((btn as HTMLElement).getAttribute('data-inv-idx'));
            const msg = hero.useItem(idx);
            alert(msg);
            onAfterAction();
        });
    });

    const equipButtons = root.querySelectorAll('[data-equip-idx]');
    equipButtons.forEach(btn => {
        (btn as HTMLElement).addEventListener('click', () => {
            const idx = Number((btn as HTMLElement).getAttribute('data-equip-idx'));
            hero.equipItem(idx);
            onAfterAction();
        });
    });

    // Sélection d'objets: afficher Utiliser/Équiper uniquement sur l'item sélectionné.
    // - Clic sur une ligne: sélectionne
    // - Clic droit sur une ligne: désélectionne
    // - Clic dans le vide (dans l'inventaire): désélectionne
    (root.querySelectorAll('.inventory-items') as NodeListOf<HTMLElement>).forEach((container) => {
        if ((container as any).dataset?.invSelectionWired === '1') return;
        (container as any).dataset.invSelectionWired = '1';

        const update = () => {
            const sel = container.getAttribute('data-selected-inv') ?? '';
            (container.querySelectorAll('[data-inv-actions]') as NodeListOf<HTMLElement>).forEach((actionsEl) => {
                const idx = actionsEl.getAttribute('data-inv-actions') ?? '';
                actionsEl.style.display = sel && idx === sel ? 'flex' : 'none';
            });
            (container.querySelectorAll('[data-inv-row]') as NodeListOf<HTMLElement>).forEach((rowEl) => {
                const idx = rowEl.getAttribute('data-inv-row') ?? '';
                if (sel && idx === sel) {
                    rowEl.style.background = 'rgba(255,255,255,0.06)';
                    rowEl.style.outline = '1px solid rgba(255,235,59,0.35)';
                } else {
                    rowEl.style.background = 'transparent';
                    rowEl.style.outline = 'none';
                }
            });
        };

        const deselect = () => {
            container.removeAttribute('data-selected-inv');
            update();
        };

        container.addEventListener('click', (ev) => {
            const target = ev.target as HTMLElement | null;
            if (!target) return;
            if (target.closest('button')) return; // avoid interfering with action buttons
            const row = target.closest('[data-inv-row]') as HTMLElement | null;
            if (!row || !container.contains(row)) {
                deselect();
                return;
            }
            const idx = row.getAttribute('data-inv-row') ?? '';
            if (!idx) return;
            container.setAttribute('data-selected-inv', idx);
            update();
        });

        container.addEventListener('contextmenu', (ev) => {
            const target = ev.target as HTMLElement | null;
            const row = target?.closest?.('[data-inv-row]') as HTMLElement | null;
            if (!row || !container.contains(row)) return;
            ev.preventDefault();
            deselect();
        });

        update();
    });
}
