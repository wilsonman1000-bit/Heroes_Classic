import { ENEMY_DEFS, createEnemy } from './enemies.js';
import { ENABLE_SIMPLE_COMBAT } from './config.web.js';
import type { EnemyId } from './enemies.js';

export type CombatMenuOptions = {
    onBack?: () => void;
};

export function showCombatMenu(options: CombatMenuOptions) {
    // Quand on entre dans le menu combattre, on arrête les autres ambiances (auberge incluse) puis on (ré)active la musique de fond
    const audio = window.game?.audioManager;
    audio?.pauseAll();
    audio?.resume('background');

    // Supprime le bouton Fuir du DOM si présent
    const fuirBtn = document.getElementById('fuirBtn');
    fuirBtn?.remove();

    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
        <img src="ImagesRPG/imagesfond/pngtree-forest-background-cartoon-illustration-image_2119957.jpg" class="background" alt="Menu combattre">
        <div class="centered-content">
            <h1>Menu combattre</h1>
            <div style="display:flex;flex-direction:column;gap:14px;align-items:center;margin-top:18px;">
                ${Object.entries(ENEMY_DEFS).map(([id, def]) => `
                    <button class="btn enemy-btn" data-enemy-id="${id}" title="${def.description ?? ''}" aria-label="${def.name} - ${def.description ?? ''}" style="min-width:220px;display:flex;align-items:center;gap:12px;justify-content:center;">
                        <img src="${def.image}" alt="${def.name}" title="${def.description ?? ''}" style="height:38px;width:38px;border-radius:8px;object-fit:cover;box-shadow:0 2px 8px #000a;">
                        <span>${def.name}</span>
                    </button>
                `).join('')}
                ${options.onBack ? `<button class="btn" id="backBtn" style="min-width:220px;">Retour</button>` : ''}
            </div>
        </div>
    `;

    // Ajoute un listener pour chaque bouton ennemi
    document.querySelectorAll('.enemy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = (btn as HTMLElement).getAttribute('data-enemy-id') as EnemyId;
            if (!ENABLE_SIMPLE_COMBAT) {
                alert('Le mode de combat simple est désactivé. Utilisez le Combat plateau.');
                return;
            }
            // Fournit une factory pour que le combat instancie l'ennemi au niveau désiré (par défaut niveau du héros)
            void import('./combat.web.js').then((m) => m.showCombat(undefined, { enemyFactory: (lvl:number) => createEnemy(id, lvl) }));
        });
    });

    if (options.onBack) {
        document.getElementById('backBtn')?.addEventListener('click', options.onBack);
    }
}
