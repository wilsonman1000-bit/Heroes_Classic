// npm run start

// ./imagesRPG/Fabienne_photo.png
//https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80
//  https://wallpaperaccess.com/full/3486837.jpg 
// https://i.pinimg.com/originals/af/ea/54/afea54a4884f91e673872f822a0c72e6.jpg//



//
import { Game } from './game.js';
import { Player } from './player.js';
import { createSkill } from './skillLibrary.js';
import { showAccueil } from './accueil.web.js';

import { Consumable, Equipment } from './item.js';
import { exposePixiDebugApi } from "./pixi/pixiBootstrap.web.js";

export const hero = new Player(
    'Hero',
    0,
    0,
    0,
    [
        createSkill('basic_attack'),
        createSkill('block'),
        createSkill('mana_gain'),
        createSkill('missile_magique')
    ],
    0,
    true,
    50,
    0,
    0,
    0,
    40,
    20,
    10,
    2,
    0,
    { force: 10, sante: 10, energie: 40, vitesse: 2, magie: 10, critique: 0, defense: 0 }
);

// Remplit PV/mana/PA après dérivation depuis les caractéristiques.
hero.syncDerivedStatsFromCharacteristics({ fillResources: true });

const game = new Game('Merdoum 3', hero);
// REND L'INSTANCE GLOBALE POUR LES AUTRES MODULES

window.game = game;
game.init();
export { game };

// Lance la musique au premier clic (restriction navigateur)
let musicStarted = false;
document.addEventListener('click', () => {
    if (!musicStarted) {
        musicStarted = true;
        // Joue l'intro une fois, puis "groot" une fois, puis enchaine sur la musique de fond en boucle
        game.audioManager.playOnce('intro', () => {
            game.audioManager.playOnce('groot', () => {
                game.audioManager.play('background');
                console.log('Intro et Groot terminés, musique de fond lancée');
            });
        });
    }
});

console.log('Bienvenue dans ' + game.name + ' !');
const gameContainer = window.document.getElementById('game-container');
if(gameContainer){
    gameContainer.innerText = 'Bienvenue dans ' + game.name + ' !';
}

const app = document.getElementById('app');

// Ajoute ou modifie le style global pour les images de fond et les boutons centrés
const style = document.createElement('style');
style.innerHTML = `
    html, body {
        width: 100%;
        height: 100%;
    }
    body {
        background: #000;
        color: #fff;
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
    }
    #app {
        width: 100%;
        min-height: 100vh;
        position: relative;
    }
    .background {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        width: 100vw;
        height: 100vh;
        object-fit: contain;
        z-index: 0;
        filter: brightness(0.7);
        background: #000;
    }
    /* Specific scale for the Compétences background (dezoom 35% => scale 0.65) */
    .background-competences {
        transform: scale(0.65);
        transform-origin: center;
    }
    .centered-content {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1;
        text-align: center;
        width: 100vw;
        max-width: 600px;
    }
    .combat-history {
        position: absolute;
        top: 10%;
        right: 3%;
        width: 340px;
        min-height: 320px;
        max-height: 60vh;
        background: rgba(0,0,0,0.7);
        color: #fff;
        border-radius: 12px;
        padding: 18px 18px 8px 18px;
        font-size: 1em;
        overflow-y: auto;
        z-index: 2;
        box-shadow: 0 2px 16px #000a;
        text-align: left;
        display: flex;
        flex-direction: column;
    }
    .combat-history-title {
        font-weight: bold;
        margin-bottom: 8px;
        font-size: 1.1em;
        color: #ffd700;
    }
    /* Badges for active effects (buff / debuff) */
    .effect-badges { display:flex; gap:8px; justify-content:center; margin-top:8px; flex-wrap:wrap }
    .effect-badge { padding:4px 8px; border-radius:6px; font-size:0.9em; border:1px solid rgba(255,255,255,0.06) }
    .effect-badge.buff { background: rgba(76,175,80,0.12); color:#c8e6c9; border-color: rgba(76,175,80,0.18) }
    .effect-badge.debuff { background: rgba(244,67,54,0.08); color:#ffd6d1; border-color: rgba(244,67,54,0.14) }
    .effect-badge.defense { background: rgba(3,169,244,0.06); color:#bde7ff; border-color: rgba(3,169,244,0.12); }

    /* HP / Mana bars */
    .hp-row { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px }
    .hp-column { width:45%; }
    .hp-bar-container, .mana-bar-container { background: rgba(255,255,255,0.06); border-radius:6px; height:14px; overflow:hidden; position:relative }
    .hp-bar { height:14px; border-radius:6px; transition:width 0.25s ease; }
    .hp-bar.player { background: linear-gradient(90deg,#ff5252,#c62828); }
    .hp-bar.enemy { background: linear-gradient(90deg,#f44336,#c62828); float:right }
    .mana-bar { height:8px; border-radius:6px; background: linear-gradient(90deg,#2196f3,#1565c0); transition:width 0.25s ease; margin-top:6px }
    .hp-label { font-size:0.9em; color:#ddd; margin-bottom:6px }
    .bar-label { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); font-size:0.85em; color:#fff; text-shadow:0 1px 0 rgba(0,0,0,0.6); pointer-events:none }
    /* Small inline stat badges next to HP label */
    .stat-badges-inline { display:inline-flex; gap:8px; align-items:center; margin-left:8px }
    .stat-badge { font-size:0.85em; padding:3px 6px; border-radius:6px; background: rgba(255,255,255,0.03); color:#fff; display:inline-flex; align-items:center; gap:6px; border:1px solid rgba(255,255,255,0.04) }
    .stat-badge.up { background: rgba(255,235,59,0.08); color:#fff; border-color: rgba(255,235,59,0.12); }
    .stat-badge.down { background: rgba(244,67,54,0.08); color:#fff; border-color: rgba(244,67,54,0.12); }
    .stat-badge .icon { font-size:0.95em }
    /* Defense stat badge (shield) */
    .stat-badge.defense { background: rgba(3,169,244,0.06); color:#bde7ff; border-color: rgba(3,169,244,0.12); }
    /* Flash when block reduces a hit */
    .hp-bar.flash-reduced { animation: flash-reduced 360ms ease; box-shadow: 0 0 10px rgba(3,169,244,0.9); }
    .stat-badge.defense.flash-reduced { transform:scale(1.06); box-shadow:0 0 8px rgba(3,169,244,0.9); }
    @keyframes flash-reduced { 0% { filter:brightness(1.6); } 100% { filter:brightness(1); } }
    .hp-bar.flash-damage { animation: flash-damage 600ms ease; box-shadow: 0 0 10px rgba(244,67,54,0.9); }
    .hp-bar.flash-heal { animation: flash-heal 360ms ease; box-shadow: 0 0 10px rgba(76,175,80,0.9); }
    @keyframes flash-damage { 0% { filter:brightness(1.4); } 100% { filter:brightness(1); } }
    @keyframes flash-heal { 0% { filter:brightness(1.6); } 100% { filter:brightness(1); } }


    /* Global medieval button theme (applies everywhere) */
    button, .btn, .village-btn, .btn-medieval,
    input[type=button], input[type=submit],
    a.button, a.btn {
        background: linear-gradient(135deg, #bfa76a 0%, #7c5c2a 100%);
        color: #fffbe6;
        border: 2px solid #5a4321;
        border-radius: 10px;
        font-family: 'Cinzel', 'Georgia', serif;
        font-size: 1.08em;
        font-weight: 600;
        letter-spacing: 0.5px;
        box-shadow: 0 2px 8px rgba(60,40,10,0.18);
        padding: 10px 28px;
        margin: 6px 0;
        cursor: pointer;
        transition: background 0.2s;
        text-shadow: 0 1px 2px #3a2a10;
        text-decoration: none;
        display: inline-block;
    }
    button:hover, .btn:hover, .village-btn:hover, .btn-medieval:hover,
    input[type=button]:hover, input[type=submit]:hover,
    a.button:hover, a.btn:hover {
        background: linear-gradient(135deg, #e2c88f 0%, #a07b3b 100%);
        color: #fffbe6;
    }

    /* Layout for generic buttons (keeps prior sizing/centering) */
    .btn {
        display: block;
        margin: 18px auto;
        padding: 16px 40px;
        font-size: 1.3em;
        min-width: 220px;
    }

    /* Skill buttons (combat / entrainement): click the icon (no visible container) */
    .btn.skill-btn {
        width: 60px;
        height: 60px;
        min-width: 0;
        padding: 0;
        margin: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        background: transparent !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        text-shadow: none !important;
    }
    .btn.skill-btn:focus { outline: none; }
    .btn.skill-btn img {
        width: 60px;
        height: 60px;
        object-fit: contain;
        display: block;
        user-select: none;
        -webkit-user-drag: none;
        filter: drop-shadow(0 6px 10px rgba(0,0,0,0.55));
        transition: transform 120ms ease, filter 120ms ease;
    }
    .btn.skill-btn:hover img {
        transform: scale(1.06);
        filter: drop-shadow(0 8px 14px rgba(0,0,0,0.65));
    }
    /* Style spécifique pour le bouton Fuir en combat */
    #fuirBtn {
        position: fixed;
        left: 80vw;
        top: 60vh;
        font-size: 0.95em;
        min-width: 90px;
        padding: 8px 18px;
        z-index: 1000;
        margin: 0;
        transform: translateX(-50%);
    }
    /* Village menu positioning (theme is handled above) */
    .village-btn {
        position: absolute;
        min-width: 180px;
        padding: 16px 32px;
        font-size: 1.1em;
    }
    .village-hg { top: 10%; left: 10%; }
    .village-hc { top: 10%; left: 50%; transform: translateX(-50%); }
    .village-hd { top: 10%; right: 10%; }
    .village-bg { bottom: 10%; left: 10%; }
    .village-bc { bottom: 10%; left: 50%; transform: translateX(-50%); }
    .village-bd { bottom: 10%; right: 10%; }
    .village-title {
        position: absolute;
        /* ...autres styles... */
    }
`;
document.head.appendChild(style);

// Initialisation UI
showAccueil();

// Pixi bootstrap: canvas minimal dans #battle-container.
// (Le rendu du jeu reste DOM pour l'instant; on branchera Pixi sur le tactical ensuite.)
exposePixiDebugApi();
