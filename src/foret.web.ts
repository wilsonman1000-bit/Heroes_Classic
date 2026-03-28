import { showCombatMenu } from './combatMenu.web.js';
import { showTacticalSkirmish } from './tacticalCombat.web.js';
import { showCombatPlateauMenu } from './combatPlateauMenu.web.js';
import { showForestWorldMaps } from './world/worldMap.web.js';

export type ForetMenuOptions = {
    onBack?: () => void;
};

export function showForetMenu(options: ForetMenuOptions = {}): void {
    // Supprime le bouton Fuir du DOM si présent
    const fuirBtn = document.getElementById('fuirBtn');
    fuirBtn?.remove();

    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
        <img src="ImagesRPG/imagesfond/pngtree-forest-background-cartoon-illustration-image_2119957.jpg" class="background" alt="Forêt">
        <div class="centered-content">
            <h1>Forêt</h1>
            <div style="display:flex;flex-direction:column;gap:14px;align-items:center;margin-top:18px;">
                <button class="btn" id="foretCombatBtn" style="min-width:220px;">Combattre</button>
                <button class="btn" id="foretTacticalBtn" style="min-width:220px;">Combat plateau</button>
                <button class="btn" id="foretExploreMapsBtn" style="min-width:220px;">Explorer (cartes)</button>
                ${options.onBack ? `<button class="btn" id="foretBackBtn" style="min-width:220px;">Retour</button>` : ''}
            </div>
        </div>
    `;

    document.getElementById('foretCombatBtn')?.addEventListener('click', () => showCombatMenu({ onBack: () => showForetMenu(options) }));
    document.getElementById('foretTacticalBtn')?.addEventListener('click', () => showCombatPlateauMenu({ onBack: () => showForetMenu(options) }));
    document.getElementById('foretExploreMapsBtn')?.addEventListener('click', () => showForestWorldMaps({ onBack: () => showForetMenu(options) }));
    if (options.onBack) {
        document.getElementById('foretBackBtn')?.addEventListener('click', options.onBack);
    }
}
