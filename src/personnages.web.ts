import { hero } from './index.web.js';
import { escapeHtml } from './utils.web.js';
import { getPartyClassLabel, getPartyMember, getPartyMembers, setSelectedPartyIndex, type PartyIndex } from './party.web.js';
import { getBaseSpeedForActor } from './tacticalBoard.js';
import { ensureTitles } from './titles.js';

type Options = { onBack?: () => void };

function goVillage(): void {
    void import('./village/villageMain.web.js').then((m) => m.showVillage());
}

export function showSelectionPersonnages(options: Options = {}): void {
    const app = document.getElementById('app');
    if (!app) return;

    const party = getPartyMembers();

    app.innerHTML = `
        <img src="https://wallpaperaccess.com/full/3486837.jpg" class="background" alt="Sélection personnages">
        <div class="centered-content">
            <h1>Sélection des personnages</h1>
            <div style="display:flex;flex-direction:column;gap:14px;align-items:center;margin-top:18px;">
                ${party
                    .map((p, idx) => {
                        const label = `${p.name} — ${getPartyClassLabel(p)} (Niv ${p.level})`;
                        return `
                            <div style="display:flex;gap:10px;align-items:center;">
                                <button class="btn" data-pidx-full="${idx}" style="min-width:320px;">${label}</button>
                                <button class="btn" data-pidx-modal="${idx}" style="min-width:120px;padding:6px 10px;font-size:0.9em;">Fiche</button>
                            </div>
                        `;
                    })
                    .join('')}
                <button class="btn" id="backBtn" style="min-width:220px;">Retour</button>
            </div>
        </div>
    `;

    document.querySelectorAll('[data-pidx-full]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number((btn as HTMLElement).getAttribute('data-pidx-full')) as PartyIndex;
            if (idx === 0) return showPersonnage1(options);
            if (idx === 1) return showPersonnage2(options);
            return showPersonnage3(options);
        });
    });

    document.querySelectorAll('[data-pidx-modal]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number((btn as HTMLElement).getAttribute('data-pidx-modal')) as PartyIndex;
            openPersonnageModal({ startIndex: idx });
        });
    });

    document.getElementById('backBtn')?.addEventListener('click', options.onBack ?? goVillage);
}

let personnageModalEl: HTMLDivElement | null = null;

export function openPersonnageModalFromMap(opts: { startIndex?: PartyIndex } = {}): void {
    openPersonnageModal(opts);
}

function openPersonnageModal(opts: { startIndex?: PartyIndex } = {}): void {
    if (personnageModalEl) return;

    const party = getPartyMembers();
    let selected: PartyIndex = (opts.startIndex ?? (0 as PartyIndex)) as PartyIndex;

    const close = () => {
        closeTitlesModal();
        personnageModalEl?.remove();
        personnageModalEl = null;
        document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);

    const overlay = document.createElement('div');
    overlay.id = 'personnageModal';
    overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:rgba(0,0,0,0.72)',
        'z-index:9999',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:18px',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
        'width:min(920px, 96vw)',
        'max-height:92vh',
        'overflow:auto',
        'background:rgba(20,20,24,0.96)',
        'border:1px solid rgba(255,255,255,0.10)',
        'border-radius:14px',
        'box-shadow:0 10px 40px rgba(0,0,0,0.65)',
        'padding:16px',
        'color:#fff',
    ].join(';');

    const getAvatarUrl = (actor: any): string => {
        const cls = String(actor?.characterClass ?? '').toLowerCase();
        if (cls === 'mage') return 'ImagesRPG/imagespersonnage/mage.jpg';
        if (cls === 'voleur') return 'ImagesRPG/imagespersonnage/voleur.png';
        return 'https://img.freepik.com/vecteurs-premium/illustration-personnage_961307-22519.jpg';
    };

    const bar = (label: string, current: number, max: number, color: string) => {
        const safeMax = Math.max(1, Math.floor(max));
        const pct = Math.max(0, Math.min(100, Math.round((Math.max(0, current) / safeMax) * 100)));
        return `
            <div style="margin:6px 0 10px 0;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.92em;color:#ddd;">
                    <div>${label}</div>
                    <div>${Math.floor(current)}/${safeMax}</div>
                </div>
                <div style="height:10px;background:rgba(255,255,255,0.10);border-radius:999px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${color};"></div>
                </div>
            </div>
        `;
    };

    const xpBar = (p: any) => {
        const next = Math.max(1, Math.floor(p.getXPForLevel(p.level + 1) ?? 1));
        const cur = Math.max(0, Math.floor(p.currentXP ?? 0));
        const pct = Math.max(0, Math.min(100, Math.round((cur / next) * 100)));
        return `
            <div style="margin-top:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.92em;color:#ddd;">
                    <div>XP</div>
                    <div>${cur} / ${next} (${pct}%)</div>
                </div>
                <div style="height:10px;background:rgba(255,255,255,0.10);border-radius:999px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#ffd36a,#ff9f4a);"></div>
                </div>
            </div>
        `;
    };

    let titlesModalEl: HTMLDivElement | null = null;

    const closeTitlesModal = () => {
        titlesModalEl?.remove();
        titlesModalEl = null;
    };

    const openTitlesModal = () => {
        if (!personnageModalEl) return;
        if (titlesModalEl) return;

        const titles = ensureTitles(hero as any);

        const wrap = document.createElement('div');
        wrap.style.cssText = [
            'position:fixed',
            'inset:0',
            'background:rgba(0,0,0,0.55)',
            'z-index:10020',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:18px',
        ].join(';');

        const box = document.createElement('div');
        box.style.cssText = [
            'width:min(520px, 92vw)',
            'background:rgba(20,20,24,0.98)',
            'border:1px solid rgba(255,255,255,0.12)',
            'border-radius:14px',
            'box-shadow:0 10px 40px rgba(0,0,0,0.65)',
            'padding:14px 14px 12px 14px',
            'color:#fff',
        ].join(';');

        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                <div style="font-size:1.05em;font-weight:800;">Titres obtenus</div>
                <button class="btn" id="titlesModalCloseBtn" style="min-width:90px;">Fermer</button>
            </div>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
                ${titles
                    .map((t) => {
                        const label = escapeHtml(String(t ?? '').trim());
                        return `<div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:8px 10px;">${label}</div>`;
                    })
                    .join('')}
            </div>
        `;

        wrap.appendChild(box);
        wrap.addEventListener('click', (e) => {
            if (e.target === wrap) closeTitlesModal();
        });
        (box.querySelector('#titlesModalCloseBtn') as HTMLButtonElement | null)?.addEventListener('click', () => closeTitlesModal());

        document.body.appendChild(wrap);
        titlesModalEl = wrap;
    };

    const clamp0100 = (n: unknown): number => {
        const v = Math.floor(Number(n ?? 0));
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, Math.min(100, v));
    };

    const virtueBar = (label: string, value: number, color: string) => {
        const pct = clamp0100(value);
        return `
            <div style="display:flex;align-items:flex-end;gap:8px;min-width:160px;">
                <div style="position:relative;width:18px;height:56px;background:rgba(255,255,255,0.10);border-radius:0;overflow:hidden;">
                    <div style="position:absolute;left:0;right:0;bottom:0;height:${pct}%;background:${color};border-radius:0;"></div>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <div style="font-size:0.92em;color:#ddd;">${label}</div>
                    <div style="font-size:0.82em;color:#999;">${pct}/100</div>
                </div>
            </div>
        `;
    };

    const render = () => {
        const p = getPartyMember(selected);
        const clsLabel = getPartyClassLabel(p);
        const portrait = getAvatarUrl(p as any);
        const pvMax = Math.max(1, Math.floor(p.effectiveMaxPv ?? p.maxPv ?? 1));
        const manaMax = Math.max(1, Math.floor(p.effectiveMaxMana ?? p.maxMana ?? 1));
        const points = Math.max(0, Math.floor((p as any).characteristicPoints ?? 0));

        // Valeurs partagées par le groupe (portées par le héros)
        const honneur = clamp0100((hero as any).honneur ?? (p as any).honneur ?? 0);
        const liberte = clamp0100((hero as any).liberte ?? (p as any).liberte ?? 0);
        const humanite = clamp0100((hero as any).humanite ?? (p as any).humanite ?? 0);

        const chars: Array<{ key: any; label: string; help: string }> = [
            { key: 'force', label: 'Force', help: '+1 attaque / point' },
            { key: 'sante', label: 'Santé', help: '+10 PV max / point' },
            { key: 'magie', label: 'Magie', help: '+10 mana max / point' },
            { key: 'energie', label: 'Énergie', help: '+1 mana/tour / point' },
            { key: 'vitesse', label: 'Vitesse', help: `initiative (total VIT: ${getBaseSpeedForActor(p, 'allies')})` },
            { key: 'critique', label: 'Critique', help: 'chance = (critique/force)×100, dégâts x2' },
            { key: 'defense', label: 'Défense', help: 'réduction = (défense/attaque ennemi)×100' },
            { key: 'connaissance', label: 'Connaissance', help: '+1 point de compétence / point' },
        ];

        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <div style="font-size:1.25em;font-weight:700;">${escapeHtml(p.name)} — ${escapeHtml(clsLabel)}</div>
                    <div style="color:#bbb;">Niveau <b>${p.level}</b> • Points caractéristique: <b>${points}</b></div>
                </div>
                <div style="display:flex;gap:10px;align-items:center;">
                    <label style="color:#ccc;font-size:0.92em;">Personnage</label>
                    <select id="personnageModalSelect" style="background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:6px 10px;">
                        ${party
                            .map((m, idx) => {
                                const sel = idx === selected ? 'selected' : '';
                                return `<option value="${idx}" ${sel}>${escapeHtml(m.name)} (${escapeHtml(getPartyClassLabel(m))})</option>`;
                            })
                            .join('')}
                    </select>
                    <button class="btn" id="personnageModalCloseBtn" style="min-width:90px;">Fermer</button>
                </div>
            </div>

            ${xpBar(p)}

            <div style="display:flex;gap:16px;align-items:flex-start;margin-top:14px;flex-wrap:wrap;">
                <div style="flex:0 0 180px;">
                    <img src="${portrait}" alt="Portrait" style="width:180px;height:180px;border-radius:14px;object-fit:cover;box-shadow:0 6px 18px rgba(0,0,0,0.6);" />
                </div>
                <div style="flex:1 1 320px;min-width:280px;">
                    ${bar('PV', p.pv ?? 0, pvMax, 'linear-gradient(90deg,#ff4b4b,#a81818)')}
                    ${bar('Mana', p.currentMana ?? 0, manaMax, 'linear-gradient(90deg,#4ea7ff,#2b58ff)')}
                    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;color:#ddd;">
                        <div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:12px;">ATK: <b>${Math.floor(p.effectiveAttack ?? p.baseAttack ?? 0)}</b></div>
                        <div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:12px;">Regen mana: <b>${Math.floor((p.manaRegenPerTurn ?? 0) + (p.getPassiveManaRegenPerTurnBonus?.() ?? 0))}</b>/tour</div>
                        <div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:12px;">PA: <b>${Math.floor(p.actionPoints ?? 0)}/${Math.floor(p.actionPointsMax ?? 0)}</b></div>
                    </div>
                </div>
            </div>

            <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.10);padding-top:12px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
                    <button class="btn" id="virtueTitlesBtn" style="min-width:110px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);">Titres</button>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;justify-content:center;">
                        ${virtueBar('Honneur', honneur, '#ff4b4b')}
                        ${virtueBar('Liberté', liberte, '#ffd36a')}
                        ${virtueBar('Humanité', humanite, '#4ea7ff')}
                    </div>
                </div>
                <div style="font-size:1.05em;font-weight:700;margin-bottom:10px;">Caractéristiques</div>
                <div style="display:grid;grid-template-columns: 1fr;gap:8px;">
                    ${chars
                        .map((c) => {
                            const val = Math.max(0, Math.floor(Number((p as any).characteristics?.[c.key] ?? 0)));
                            const disabled = points > 0 ? '' : 'disabled';
                            return `
                                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:8px 10px;">
                                    <div style="display:flex;flex-direction:column;gap:2px;">
                                        <div style="font-weight:600;">${c.label} : <b>${val}</b></div>
                                        <div style="color:#999;font-size:0.85em;">${c.help}</div>
                                    </div>
                                    <button class="btn" data-stat="${c.key}" ${disabled} style="padding:2px 6px;min-width:34px;min-height:22px;font-size:0.8em;line-height:1;">+1</button>
                                </div>
                            `;
                        })
                        .join('')}
                </div>
            </div>
        `;

        (panel.querySelector('#personnageModalCloseBtn') as HTMLButtonElement | null)?.addEventListener('click', () => close());
        (panel.querySelector('#virtueTitlesBtn') as HTMLButtonElement | null)?.addEventListener('click', () => openTitlesModal());
        (panel.querySelector('#personnageModalSelect') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
            const v = Number((e.target as HTMLSelectElement).value) as PartyIndex;
            selected = (Number.isFinite(v) ? v : selected) as PartyIndex;
            render();
        });
        (panel.querySelectorAll('[data-stat]') as NodeListOf<HTMLButtonElement>).forEach((b) => {
            b.addEventListener('click', () => {
                const stat = b.getAttribute('data-stat') as any;
                try {
                    (p as any).spendCharacteristicPoint?.(stat);
                } catch {
                    // noop
                }
                render();
            });
        });
    };

    render();
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    personnageModalEl = overlay;
}

function renderFiche(idx: PartyIndex, options: Options): void {
    setSelectedPartyIndex(idx);
    const p = getPartyMember(idx);

    const app = document.getElementById('app');
    if (!app) return;

    // Avatar: portraits locaux par classe (demandé)
    const cls = String((p as any).characterClass ?? '').toLowerCase();
    const avatarUrl = cls === 'mage'
        ? 'ImagesRPG/imagespersonnage/mage.jpg'
        : cls === 'voleur'
            ? 'ImagesRPG/imagespersonnage/voleur.png'
            : 'https://img.freepik.com/vecteurs-premium/illustration-personnage_961307-22519.jpg';
    const backgroundUrl = 'https://thumbs.dreamstime.com/z/cozy-fantasy-medieval-tavern-inn-interior-food-drink-tables-burning-open-fireplace-candles-stone-ground-middle-277116558.jpg';

    app.innerHTML = `
        <img src="${backgroundUrl}" class="background" alt="Personnage">
        <div class="centered-content" style="max-width:1200px;margin:0 auto;">
            <h1>Fiche du personnage</h1>
            <div style="margin-top:6px;color:#ddd;">Sélection : <b>${p.name}</b> — Classe <b>${getPartyClassLabel(p)}</b></div>

            <div style="display:flex;gap:32px;justify-content:space-between;align-items:flex-start;margin-top:18px;flex-wrap:nowrap;width:100%;">
                <!-- Colonne 1 : Stats (comme avant) -->
                <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:18px;min-width:220px;max-width:260px;box-shadow:0 2px 12px rgba(0,0,0,0.15);flex:1 1 220px;align-self:stretch;">
                    <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:12px;">
                        <img id="character-img" src="${avatarUrl}" alt="Avatar" style="width:120px;height:120px;border-radius:10px;object-fit:cover;box-shadow:0 2px 12px rgba(0,0,0,0.6);margin-bottom:8px;" data-fixed="true">
                        <div style="font-size:1.1em;font-weight:600;">${p.name}</div>
                    </div>
                    <p><b>Niveau :</b> ${p.level}</p>
                    <p><b>XP :</b> ${p.currentXP} / ${p.getXPForLevel(p.level + 1)}</p>
                    <p><b>PV :</b> ${p.pv} / ${p.effectiveMaxPv}</p>
                    <p><b>Mana :</b> ${p.currentMana} / ${p.effectiveMaxMana}</p>
                    <p><b>Régénération mana :</b> ${p.manaRegenPerTurn + p.getPassiveManaRegenPerTurnBonus()} /tour <small style="color:#777;">(base ${p.manaRegenPerTurn}${p.getPassiveManaRegenPerTurnBonus() ? ' + ' + p.getPassiveManaRegenPerTurnBonus() : ''})</small></p>
                    <p><b>Attaque :</b> ${p.effectiveAttack} <small style="color:#777;">(base ${p.baseAttack} + eq ${Object.values(p.equipment).reduce((s: number, eq: any) => s + (eq?.attackBonus || 0), 0)})</small></p>
                    <p><b>Or :</b> ${p.gold}</p>
                    <p><b>Points de compétence :</b> ${p.skillPoints}</p>
                    <p><b>Points de caractéristique :</b> ${(p as any).characteristicPoints ?? 0}</p>
                </div>

                <!-- Colonne 2 : Caractéristiques (comme avant) -->
                <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:18px;min-width:220px;max-width:260px;box-shadow:0 2px 12px rgba(0,0,0,0.15);flex:1 1 220px;align-self:stretch;">
                    <h2 style="margin-top:0;">Caractéristiques</h2>
                    <div style="font-size:0.95em; color:#ddd;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Force : <b>${(p as any).characteristics?.force ?? 0}</b><br><small style="color:#999;">+1 attaque / point</small></div>
                            <button class="btn" data-stat="force" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Santé : <b>${(p as any).characteristics?.sante ?? 0}</b><br><small style="color:#999;">+10 PV max / point</small></div>
                            <button class="btn" data-stat="sante" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Énergie : <b>${(p as any).characteristics?.energie ?? 0}</b><br><small style="color:#999;">+1 mana/tour / point</small></div>
                            <button class="btn" data-stat="energie" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Magie : <b>${(p as any).characteristics?.magie ?? 0}</b><br><small style="color:#999;">+1 mana / tour / point</small></div>
                            <button class="btn" data-stat="magie" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Vitesse : <b>${(p as any).characteristics?.vitesse ?? 0}</b><br><small style="color:#999;"><span title="Total VIT = base de classe (guerrier/mage/voleur) + bonus de la caractéristique Vitesse">total VIT: ${getBaseSpeedForActor(p, 'allies')}</span></small></div>
                            <button class="btn" data-stat="vitesse" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Critique : <b>${(p as any).characteristics?.critique ?? 0}</b><br><small style="color:#999;">chance crit = (critique/force)×100, dégâts x2</small></div>
                            <button class="btn" data-stat="critique" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
                            <div>Défense : <b>${(p as any).characteristics?.defense ?? 0}</b><br><small style="color:#999;">réduction = (défense/attaque ennemi)×100</small></div>
                            <button class="btn" data-stat="defense" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                            <div>Connaissance : <b>${(p as any).characteristics?.connaissance ?? 0}</b><br><small style="color:#999;">+1 point de compétence / point</small></div>
                            <button class="btn" data-stat="connaissance" ${(p as any).characteristicPoints > 0 ? '' : 'disabled'} style="padding:4px 8px;min-width:44px;font-size:0.85em;">+1</button>
                        </div>
                    </div>
                </div>

                <!-- Colonne 3 : Compétences (comme avant, mais celles du perso sélectionné) -->
                <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:18px;min-width:220px;max-width:260px;box-shadow:0 2px 12px rgba(0,0,0,0.15);flex:1 1 220px;align-self:stretch;">
                    <h2 style="margin-top:0;">Compétences</h2>
                    <ul style="list-style:none;padding:0;">
                        ${p.skills.map((skill: any) => `<li><b>${skill.key}</b> : ${escapeHtml(skill.name)}</li>`).join('')}
                    </ul>
                </div>
            </div>

            <div style="margin-top:24px;text-align:center;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                <button class="btn" id="backSelectBtn" style="min-width:220px;">Retour sélection</button>
                <button class="btn" id="backVillageBtn" style="min-width:220px;">Retour village</button>
            </div>
        </div>
    `;

    document.getElementById('backSelectBtn')?.addEventListener('click', () => showSelectionPersonnages(options));
    document.getElementById('backVillageBtn')?.addEventListener('click', options.onBack ?? goVillage);

    // Empêche toute modification accidentelle de l'avatar (comme avant)
    const charImg = document.getElementById('character-img');
    if (charImg) {
        const clone = charImg.cloneNode(true) as HTMLElement;
        charImg.parentElement?.replaceChild(clone, charImg);
    }

    // Dépense points de caractéristique: par personnage (indépendant)
    (app.querySelectorAll('[data-stat]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
        btn.addEventListener('click', () => {
            const stat = btn.getAttribute('data-stat') as any;
            const msg = (p as any).spendCharacteristicPoint?.(stat);
            // Alerte supprimée pour éviter les popups ; on met simplement à jour l'affichage
            renderFiche(idx, options);
        });
    });
}

export function showPersonnage1(options: Options = {}): void {
    renderFiche(0, options);
}

export function showPersonnage2(options: Options = {}): void {
    renderFiche(1, options);
}

export function showPersonnage3(options: Options = {}): void {
    renderFiche(2, options);
}
