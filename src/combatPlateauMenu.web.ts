import { ENEMY_DEFS } from './enemies.js';
import { showTacticalSkirmish } from './tacticalCombat.web.js';
import { showForetMenu } from './foret.web.js';
import type { EnemyId } from './enemies.js';

export type CombatPlateauMenuOptions = {
    onBack?: () => void;
};

export function showCombatPlateauMenu(options: CombatPlateauMenuOptions = {}) {
    const audio = window.game?.audioManager;
    audio?.pauseAll();
    audio?.resume('background');

    const fuirBtn = document.getElementById('fuirBtn');
    fuirBtn?.remove();

    const app = document.getElementById('app');
    if (!app) return;

    const defaultCounts: Record<string, number> = {
        gobelin: 3,
        gobelin_archer: 3,
        loup: 4,
        arbre: 1,
    };

    app.innerHTML = `
        <img src="ImagesRPG/imagesfond/pngtree-forest-background-cartoon-illustration-image_2119957.jpg" class="background" alt="Menu combat plateau">
        <div class="centered-content">
            <h1>Combat plateau</h1>
            <div style="display:flex;flex-direction:column;gap:14px;align-items:center;margin-top:18px;">
                ${Object.entries(ENEMY_DEFS).map(([id, def]) => `
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button class="btn enemy-btn" data-enemy-id="${id}" title="${def.description ?? ''}" aria-label="${def.name} - ${def.description ?? ''}" style="min-width:180px;display:flex;align-items:center;gap:12px;justify-content:center;padding:8px 12px;">
                            <img src="${def.image}" alt="${def.name}" title="${def.description ?? ''}" style="height:38px;width:38px;border-radius:8px;object-fit:cover;box-shadow:0 2px 8px #000a;">
                            <span class="enemy-name">${def.name}</span>
                        </button>
                        <div class="enemy-count" style="display:flex;align-items:center;gap:6px;margin-left:6px;">
                            <button class="count-decr btn small" data-for="${id}" style="width:26px;height:26px;">-</button>
                            <span class="count-value" data-for="${id}" style="min-width:24px;text-align:center;display:inline-block;">${ defaultCounts[String(id)] ?? 3 }</span>
                            <button class="count-incr btn small" data-for="${id}" style="width:26px;height:26px;">+</button>
                        </div>
                    </div>
                `).join('')}
                ${options.onBack ? `<button class="btn" id="backBtn" style="min-width:220px;">Retour</button>` : ''}
            </div>
        </div>
    `;

    // Hook up stepper controls
    document.querySelectorAll('.count-decr').forEach(b => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (b as HTMLElement).getAttribute('data-for') as string;
            const span = document.querySelector(`.count-value[data-for="${id}"]`) as HTMLElement | null;
            if (!span) return;
            const v = Math.max(1, Number(span.textContent || '1') - 1);
            span.textContent = String(Math.max(1, Math.min(6, v)));
        });
    });
    document.querySelectorAll('.count-incr').forEach(b => {
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (b as HTMLElement).getAttribute('data-for') as string;
            const span = document.querySelector(`.count-value[data-for="${id}"]`) as HTMLElement | null;
            if (!span) return;
            const v = Number(span.textContent || '1') + 1;
            span.textContent = String(Math.max(1, Math.min(6, v)));
        });
    });

    document.querySelectorAll('.enemy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).getAttribute('data-enemy-id') as EnemyId;
            const span = document.querySelector(`.count-value[data-for="${id}"]`) as HTMLElement | null;
            const count = span ? Math.max(1, Math.min(6, Math.floor(Number(span.textContent || '1')))) : 3;
            showTacticalSkirmish({ enemyId: id as EnemyId, enemyCount: count, onFlee: options.onBack ?? showForetMenu, onReturnAfterCombat: () => showCombatPlateauMenu(options) });
        });
    });

    if (options.onBack) {
        document.getElementById('backBtn')?.addEventListener('click', options.onBack);
    }
}
