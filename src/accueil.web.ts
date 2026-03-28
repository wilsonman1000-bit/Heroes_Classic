// Affichage de l'écran d'accueil
import { showVillage } from './village.web.js';
import { showCombat } from './combat.web.js';
import { hero } from './index.web.js';
import {
    deleteBrowserSave,
    exportSaveAsString,
    getBrowserSaveMeta,
    hasBrowserSave,
    importSaveFromString,
    loadGameFromBrowser,
    saveGameToBrowser,
} from './save.web.js';
import { showTacticalSkirmish } from './tacticalCombat.web.js';

export function showAccueil() {
        // Supprime le bouton Fuir du DOM si présent
        const fuirBtn = document.getElementById('fuirBtn');
        if (fuirBtn && document.body.contains(fuirBtn)) document.body.removeChild(fuirBtn);
    const app = document.getElementById('app');
    if (!app) return;
    // Ask for name if hero keeps the default
    // (No persistence across browser restarts — name remains only for current session)
    const askNameHtml = (hero.name === 'Hero' || !hero.name) ? `
            <div style="margin-bottom:14px;">
                <label for="nameInput">Entrez votre prénom :</label><br>
                <input id="nameInput" type="text" placeholder="Ton prénom" style="padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);min-width:220px;margin-top:8px;">
                <div style="margin-top:10px;"><button class="btn" id="submitNameBtn">Valider</button></div>
            </div>
        ` : `
            <div id="playerGreeting" style="margin-bottom:14px;">Bienvenue, <b>${hero.name}</b> !</div>
        `; 

    const saveMeta = getBrowserSaveMeta();
    const saveInfoHtml = hasBrowserSave()
        ? `<div style="margin-top:10px;font-size:0.95em;color:#ddd;">Sauvegarde détectée (${saveMeta?.createdAt ? new Date(saveMeta.createdAt).toLocaleString() : 'date inconnue'})</div>`
        : `<div style="margin-top:10px;font-size:0.95em;color:#bbb;">Aucune sauvegarde détectée</div>`;

    app.innerHTML = `
        <img src="ImagesRPG/imagesfond/fondaccueil.png" class="background" alt="Accueil RPG">
        <div class="centered-content">
            <h1>Bienvenue dans le jeu RPG !</h1>
            ${askNameHtml}
            <button class="btn" id="villageBtn">Village</button>
            <button class="btn" id="tacticalBtn">Combat plateau (test)</button>

            <div style="margin-top:18px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08);">
                <h2 style="margin:0 0 10px 0; font-size:1.15em; font-weight:600;">Sauvegarde</h2>
                ${saveInfoHtml}
                <button class="btn" id="saveBtn">Sauvegarder</button>
                <button class="btn" id="loadBtn">Charger</button>
                <button class="btn" id="exportBtn">Exporter</button>
                <button class="btn" id="importBtn">Importer</button>
                <button class="btn" id="deleteSaveBtn">Supprimer sauvegarde</button>
            </div>
        </div>
    `;

    // Name input handlers
    if (hero.name === 'Hero' || !hero.name) {
        const submitBtn = document.getElementById('submitNameBtn');
        const nameInput = document.getElementById('nameInput') as HTMLInputElement | null;
        submitBtn?.addEventListener('click', () => {
            if (!nameInput) return;
            const val = nameInput.value.trim();
            if (val.length === 0) {
                alert('Veuillez entrer votre prénom.');
                return;
            }
            // Keep name in-memory only for this session
            hero.name = val;
            // Re-render accueil to show greeting
            showAccueil();
        });
        if (nameInput) {
            nameInput.addEventListener('keyup', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    (document.getElementById('submitNameBtn') as HTMLButtonElement)?.click();
                }
            });
        }
    }

    document.getElementById('villageBtn')?.addEventListener('click', showVillage);
    document.getElementById('tacticalBtn')?.addEventListener('click', () => showTacticalSkirmish());

    document.getElementById('saveBtn')?.addEventListener('click', () => {
        const res = saveGameToBrowser(hero);
        if (!res.ok) {
            alert('Erreur sauvegarde: ' + res.error);
            return;
        }
        alert('Sauvegarde effectuée.');
        showAccueil();
    });

    document.getElementById('loadBtn')?.addEventListener('click', () => {
        const res = loadGameFromBrowser(hero);
        if (!res.ok) {
            alert('Erreur chargement: ' + res.error);
            return;
        }
        alert('Sauvegarde chargée.');
        showAccueil();
    });

    document.getElementById('exportBtn')?.addEventListener('click', async () => {
        const text = exportSaveAsString(hero);
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                alert('Export copié dans le presse-papiers.');
                return;
            }
        } catch {
            // ignore and fallback to prompt
        }
        // Fallback: show in prompt for manual copy
        window.prompt('Copiez votre sauvegarde JSON :', text);
    });

    document.getElementById('importBtn')?.addEventListener('click', () => {
        const input = window.prompt('Collez votre sauvegarde JSON :');
        if (!input) return;
        const res = importSaveFromString(hero, input);
        if (!res.ok) {
            alert('Erreur import: ' + res.error);
            return;
        }
        alert('Sauvegarde importée et chargée.');
        showAccueil();
    });

    document.getElementById('deleteSaveBtn')?.addEventListener('click', () => {
        const sure = window.confirm('Supprimer la sauvegarde du navigateur ?');
        if (!sure) return;
        const res = deleteBrowserSave();
        if (!res.ok) {
            alert('Erreur suppression: ' + res.error);
            return;
        }
        alert('Sauvegarde supprimée.');
        showAccueil();
    });
}
