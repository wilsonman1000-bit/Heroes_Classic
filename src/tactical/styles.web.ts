export function ensureTacticalStyles(): void {
    if (document.getElementById('tactical-style')) return;

    const style = document.createElement('style');
    style.id = 'tactical-style';
    style.innerHTML = `
        .tactical-wrap {
            position: relative;
            z-index: 2;
            width: min(1500px, 98vw);
            margin: 0 auto;
            display:flex;
            flex-direction:column;
            /* Taille du plateau partagée (utilisée par la grille et potentiellement d'autres éléments).
               Réduite de 20% à la demande (0.8), puis +10% demandé sur tous les combats (=> 0.88). */
                /* Passage 8x8 -> 9x9: on agrandit le plateau (pas de rétrécissement des cases). */
                --boardSize: calc(0.88 * min(94vh, 62vw, 960px) * 1.125);
            /* Background image removed from the screen wrapper - it will be applied to the board itself to keep original image dimensions */
            background: transparent;
        }

        /* Combat-only layout overrides (so we don't disturb world-map layouts that reuse tactical panels) */
        .tactical-wrap.tactical-combat {
            /* Do not change the overall combat centering; only pin specific UI elements */
            --tacticalLogW: 320px;
        }

        /*
           Combat alignment mode: lock the board (grid + Pixi overlay) to a viewport-centered rect
           so switching map -> combat doesn't visually move the board.

           JS sets on .tactical-wrap:
             --boardLeft, --boardTop, --boardW, --boardH, --boardSize
        */
        .tactical-wrap.tactical-combat.align-map .tactical-board-panel {
            min-width: var(--boardW, var(--boardSize));
            min-height: var(--boardH, var(--boardSize));
        }
        .tactical-wrap.tactical-combat.align-map .tactical-board-panel .tactical-center {
            position: fixed;
            left: var(--boardLeft, 0px);
            top: var(--boardTop, 0px);
            width: var(--boardW, var(--boardSize));
            height: var(--boardH, var(--boardSize));
            align-items: flex-end;
            justify-content: center;
            z-index: 150;
            pointer-events: auto;
        }
        .tactical-wrap.tactical-combat.align-map .tactical-board-panel .tactical-grid {
            width: 100%;
            height: 100%;
        }

        /* Side columns should match the locked board height in combat alignment mode */
        .tactical-wrap.tactical-combat.align-map .tactical-side {
            height: var(--boardH, var(--boardSize));
        }

        /* Fill empty side areas with the same combat background image (cover layer) */
        .tactical-wrap.tactical-combat {
            position: relative;
            isolation: isolate;
        }
        .tactical-wrap.tactical-combat::before {
            content: '';
            position: fixed;
            inset: 0;
            background-image: var(--tacticalBoardBgImage);
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            opacity: 0.35;
            z-index: -1;
            pointer-events: none;
        }

        /* Combat-only: compact spacing between grid tiles (1px) */
        .tactical-wrap.tactical-combat .tactical-grid { gap: 1px; }

        /* Combat history: keep inside the left column so it never masks the board */
        .tactical-wrap.tactical-combat .tactical-side .tactical-log-left {
            position: relative;
            left: auto;
            bottom: auto;
            width: auto;
            max-width: none;
            transform: translateY(24px);
            margin-top: auto;
            z-index: 12;
        }

        /* Bottom skill bars: 7 icons left (right of history), remaining icons bottom-right */
        .tactical-wrap.tactical-combat .tactical-skillbar {
            position: fixed;
            bottom: 8px;
            z-index: 2600;
            display: flex;
            flex-direction: row;
            gap: 10px;
            align-items: center;
            pointer-events: none; /* let tile clicks pass through */
        }
        .tactical-wrap.tactical-combat .tactical-skillbar-left {
            left: calc(8px + var(--tacticalLogW) + 12px);
        }
        .tactical-wrap.tactical-combat .tactical-skillbar-right {
            right: 8px;
        }
        .tactical-wrap.tactical-combat .tactical-skillbar .btn,
        .tactical-wrap.tactical-combat .tactical-skillbar button,
        .tactical-wrap.tactical-combat .tactical-skillbar [role="button"] {
            pointer-events: auto;
        }

        /* Fix combat action buttons (Pass/Flee/Back) and remove their overlay/panel */
        .tactical-wrap.tactical-combat .tactical-board-actions {
            position: fixed;
            right: 8px;
            bottom: calc(8px + 60px + 12px + 18px); /* slightly higher than skill icons */
            background: transparent;
            border: none;
            border-radius: 0;
            padding: 0;
            box-shadow: none;
            z-index: 2700; /* above skill bars */
            pointer-events: auto;
        }
        .tactical-hud { display:flex; gap:14px; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
        .tactical-panel { background: rgba(0,0,0,0.55); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px 12px; }

        /* Panels (allies/enemies/log) must stay readable over the board image/canvas */
        .tactical-wrap.tactical-combat .tactical-side { position: relative; z-index: 9000; }
        .tactical-wrap.tactical-combat .tactical-side .tactical-panel {
            background: rgba(0,0,0,0.68);
            border-color: rgba(255,255,255,0.12);
            backdrop-filter: blur(2px);
        }

        /* IMPORTANT: the iso board can visually extend under the side columns.
           Keep edge tiles clickable by making side panels "click-through" by default,
           while preserving clicks on actual UI elements inside them. */
        .tactical-wrap.tactical-combat .tactical-side {
            pointer-events: none;
        }
        .tactical-wrap.tactical-combat .tactical-side .tactical-panel {
            pointer-events: none;
        }
        /* Re-enable interactions on actual UI elements */
        .tactical-wrap.tactical-combat .tactical-side button,
        .tactical-wrap.tactical-combat .tactical-side .btn,
        .tactical-wrap.tactical-combat .tactical-side [role="button"],
        .tactical-wrap.tactical-combat .tactical-side a,
        .tactical-wrap.tactical-combat .tactical-side input,
        .tactical-wrap.tactical-combat .tactical-side select,
        .tactical-wrap.tactical-combat .tactical-side textarea,
        .tactical-wrap.tactical-combat .tactical-side .ally-entry,
        .tactical-wrap.tactical-combat .tactical-side .team-panel,
        .tactical-wrap.tactical-combat .tactical-side .tactical-log {
            pointer-events: auto;
        }
        .tactical-main { display:grid; grid-template-columns: minmax(240px, 320px) auto minmax(240px, 320px); gap:12px; align-items:start; justify-content:center; position: relative; z-index: 5; }
        .tactical-side { display:flex; flex-direction:column; gap:12px; height: var(--boardSize); }
        /* Log sous le panneau alliés (maintenu en bas du panneau, légèrement descendu) */
        .tactical-side .tactical-log-left { margin-top: auto; transform: translateY(24px); z-index: 12; }
        /* Boutons en bas à droite, sous le panneau ennemis */
        .tactical-actions-right { margin-top: auto; justify-content:flex-end; }
        @media (max-width: 980px) {
            .tactical-main { grid-template-columns: 1fr; }
            .tactical-side { height: auto; }
            .tactical-actions-right { margin-top: 12px; }
        }

        .tactical-actions { display:flex; gap:10px; align-items:center; justify-content:flex-end; flex-wrap:wrap; }
        .tactical-hud { position: relative; z-index: 1200; }
        .tactical-hud .tactical-panel { position: relative; z-index: 1200; }
        /* Keep side panels (teams + log) above the overflowing iso board */
        .tactical-side { position: relative; z-index: 300; }

        /* Always-visible combat actions anchored to the board (bottom-right) */
        .tactical-board-actions {
            position: absolute;
            right: 12px;
            bottom: 12px;
            z-index: 1250;
            background: rgba(0,0,0,0.62);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 12px;
            padding: 10px;
            gap: 10px;
            box-shadow: 0 14px 34px rgba(0,0,0,0.45);
            pointer-events: none; /* don't block tile clicks */
        }
        .tactical-board-actions .btn { pointer-events: auto; }
        .tactical-board-panel {
            position:relative;
            overflow: visible;
            /* Keep the board above side panels so edge tiles remain clickable in iso view. */
            z-index: 150;
                /* Harmonize combat background with movement maps:
                    - use contain (no cropping)
                    - apply the same default visual scale as movement maps (BG_SCALE ~= 1.5)
                */
                --boardBgScale: 1.5;
            --boardBgScaleMul: 1;
            --boardBgScaleEff: calc(var(--boardBgScale) * var(--boardBgScaleMul));
                /* Keep uniform scaling to match map movement look */
                --boardBgScaleX: var(--boardBgScaleEff);
            --tacticalBoardBgImage: url('ImagesRPG/imagesfond/image_combat4.png');
        }
        /* Background pseudo-element used to render a larger board background that can overflow the grid bounds */
        .tactical-board-panel::before {
            content: '';
            position: absolute;
            /* shift center to the right by 1% (moved left by 1% relative to before) */
            left: calc(50% + 1%);
            top: calc(50% + 3%);
            width: var(--boardSize);
            height: var(--boardSize);
            transform: translate(-50%, -50%) scaleX(var(--boardBgScaleX)) scaleY(var(--boardBgScaleEff)); /* width compressed via scaleX */
            transform-origin: center center;
            background-image: var(--tacticalBoardBgImage);
            background-size: contain;
            background-position: center;
            background-repeat: no-repeat;
            pointer-events: none;
            z-index: -2;
            filter: none;
        }

        /* Pixi mode: board background is rendered by Pixi (sprite + diamond mask) */
        .tactical-board-panel.pixi-mode::before { display: none; }
        .tactical-board-panel.pixi-mode .tactical-board-bg { display: none !important; }

        /* Dark framed overlay between background and grid */
        .tactical-board-panel::after {
            content: '';
            position: absolute;
            /* keep aligned with the background image center offsets */
            /* move left by ~1% */
            left: calc(50% + 0%);
            /* move up by ~1% */
            top: calc(50% + 0%);
            width: var(--boardSize);
            height: var(--boardSize);
                /* Oversized diamond overlay.
                    IMPORTANT: avoid >100% / negative clip-path coords (some browsers clamp them),
                    and widen using scaleX instead so left/right never get "cut" by vertical lines. */
                /* widen sides +3% (applied) */
                /* increased by +1% globally */
                transform: translate(-50%, -50%) scaleX(1.52043794) scaleY(1.11258773);
                transform-origin: center;
                clip-path: polygon(50% 5%, 100% 50%, 50% 95%, 0% 50%);
                -webkit-clip-path: polygon(50% 5%, 100% 50%, 50% 95%, 0% 50%);
                /* 90% opacity (almost black) */
                background: rgba(0,0,0,0.90);
            border: 1px solid rgba(255,255,255,0.12);
            box-shadow: 0 18px 40px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.05);
            pointer-events: none;
            /* Keep it above the board background so it can't be masked by neighbors */
            z-index: 1;
        }

        /* Measurable background element (used by integrated-terrain cutouts) */
        .tactical-board-panel .tactical-board-bg {
            display:none;
            position: absolute;
            left: calc(50% + 1%);
            top: calc(50% + 3%);
            width: var(--boardSize);
            height: var(--boardSize);
            transform: translate(-50%, -50%) scaleX(var(--boardBgScaleX)) scaleY(var(--boardBgScaleEff));
            transform-origin: center center;
            background-image: var(--tacticalBoardBgImage);
            background-size: contain;
            background-position: center;
            background-repeat: no-repeat;
            pointer-events: none;
            z-index: -2;
            opacity: 0;
        }

        .tactical-board-panel.integrated-terrain::before { opacity: 0; }
        .tactical-board-panel.integrated-terrain .tactical-board-bg { display:block; opacity: 1; }
        .tactical-board-panel .tactical-center { position: relative; z-index: 2; }
        .tactical-board-panel .tactical-grid { position: relative; z-index: 3; }

        /* Pixi overlay layer (canvas) inside the grid.
           In iso view, tiles can overflow the grid bounds; enlarge the Pixi layer so edge tiles/outline are not clipped. */
        .tactical-grid .tactical-pixi-layer {
            position: absolute;
            /* Large padding so the Pixi background can extend beyond the board without being clipped */
            inset: -800px;
            pointer-events: none;
            /* Under DOM tiles so Pixi can draw a background without hiding DOM UI */
            z-index: 1;
        }
        .tactical-board-panel .tactical-pixi-layer canvas {
            width: 100%;
            height: 100%;
            display: block;
        }

        /* Floating combat numbers (damage/heal) */
        .tactical-grid .tactical-float {
            position: absolute;
            left: 0;
            top: 0;
            transform: translate(-50%, -50%);
            font-weight: 900;
            font-size: 38px;
            letter-spacing: 0.2px;
            pointer-events: none;
            user-select: none;
            z-index: 50;
            text-shadow:
                0 2px 0 rgba(0,0,0,0.45),
                0 10px 18px rgba(0,0,0,0.55);
            filter: drop-shadow(0 10px 18px rgba(0,0,0,0.55));
            animation: tacticalFloatUp 2000ms cubic-bezier(0.12, 0.92, 0.18, 1) forwards;
            will-change: transform, opacity;
        }
        .tactical-grid .tactical-float.damage { color: #ff4d4d; }
        .tactical-grid .tactical-float.heal { color: #48ff8a; }
        .tactical-grid .tactical-float.damage::before { content: '-'; }
        .tactical-grid .tactical-float.heal::before { content: '+'; }

        @keyframes tacticalFloatUp {
            0%   { opacity: 0; transform: translate(-50%, -25%) scale(0.92); }
            8%   { opacity: 1; transform: translate(-50%, -70%) scale(1.10); }
            45%  { opacity: 1; transform: translate(-50%, -205%) scale(1.04); }
            100% { opacity: 0; transform: translate(-50%, -285%) scale(1.02); }
        }

        /* Spell GIFs placed on top of tiles/units */
        .tactical-board-panel .tactical-spell-gif {
            position: absolute;
            transform: translate(-50%, -50%);
            pointer-events: none;
            z-index: 520;
            max-width: 180px;
            max-height: 180px;
            will-change: transform, opacity;
        }

        /* Ensure tactical skills buttons are visible, moved lower-left and above other elements */
        .tactical-board-panel .tactical-skills {
            position: absolute;
            left: 1%;
            bottom: 1%;
            z-index: 9999;
            height: auto; max-height: none;
            display:flex; gap:10px; flex-direction: column-reverse; align-content:flex-start; justify-content:flex-end;
            /* Do not block clicks on tiles behind (only buttons remain clickable). */
            pointer-events: none;
            width: fit-content;
        }
        .tactical-board-panel .tactical-skills button,
        .tactical-board-panel .tactical-skills .btn,
        .tactical-board-panel .tactical-skills [role="button"] {
            pointer-events: auto;
        }
        .tactical-center {
            display:flex;
            align-items:flex-end;
            justify-content:center;
            gap:0;
        }
        .tactical-skills {
            /* À l'extérieur du plateau, collé sur le bord gauche bas */
            height: var(--boardSize);
            max-height: var(--boardSize);
            display:flex;
            flex-direction: column-reverse;
            flex-wrap: wrap;
            align-content: flex-start;
            justify-content:flex-start;
            gap:10px;
            padding: 0;
            margin: 0;
        }

        .tactical-grid {
            /* plateau carré qui tient dans l'écran */
            width: var(--boardSize);
            height: var(--boardSize);
            position: relative;
            display:grid;
            grid-template-columns: repeat(9, 1fr);
            grid-auto-rows: 1fr;
            gap:6px;
            user-select:none;
            box-sizing:border-box;
            padding:10px;
            border-radius:14px;
            background: transparent;
        }


        /* Vue isométrique (diamants).
              NOTE: La logique reste une grille 9x9, seul l'affichage change.
           Les positions (left/top) et la taille des tiles sont injectées en JS via --isoTileW/--isoTileH.
        */
        .tactical-grid.iso {
            display:block;
            overflow: visible;
        }
        .tactical-grid.iso .tile {
            position:absolute;
            left: 0;
            top: 0;
            width: var(--isoTileW, 64px);
            height: var(--isoTileH, 32px);
            transform: translate(-50%, -50%);
            background: transparent;
            border: none;
            border-radius: 0;
            overflow: visible;
            z-index: 10;
        }
        /* Visuel des cases en iso: rendu via SVG overlay (toujours visible, ne s'occulte pas). */
        .tactical-grid.iso .tile::before { display:none; }
        .tactical-grid.iso .tile > :not(.tile-bg):not(.tactical-float) { position: relative; z-index: 2; }
        .tactical-grid.iso .tile > .tactical-float { position: absolute; z-index: 50; }

        /* Pixi units: hide DOM sprite image, keep overlays/bars */
        .tactical-grid.pixi-units .unit-sprite { visibility: hidden; }

        /* Pixi units: hide the white SVG grid overlay (user preference) */
        .tactical-grid.pixi-units.iso .iso-grid-overlay { opacity: 0 !important; }

        /* Pixi mode: make the framed overlay less dark so the board isn't "all black" */
        .tactical-board-panel.pixi-mode::after {
            /* Disable entirely: clip-path/scale can create visual banding/cropping artifacts */
            display: none;
        }

        /* In combat, side panels should stay above the board when they overlap. */

        /* Terrain intégré (combat): chaque case affiche un découpage du fond de plateau */
        .tactical-grid.iso.integrated-terrain .iso-grid-overlay { opacity: 0; pointer-events:none; }
        .tactical-grid.iso.integrated-terrain .tile-bg {
            position: absolute;
            left: 50%;
            top: 50%;
            width: var(--isoTileW, 64px);
            height: var(--isoTileH, 32px);
            transform: translate(-50%, -50%);
            pointer-events: none;
            clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            -webkit-clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            background-image: var(--tacticalBgImage, none);
            background-size: var(--tacticalBgSize, auto);
            background-position: var(--tacticalBgPosX, 0px) var(--tacticalBgPosY, 0px);
            background-repeat: no-repeat;
            z-index: 0;
            filter: none;
        }
        .tactical-grid.iso.integrated-terrain .tile:hover .tile-bg { filter: brightness(1.06) saturate(1.04); }

        .tactical-grid.iso .iso-grid-overlay {
            position:absolute;
            left:0;
            top:0;
            width:100%;
            height:100%;
            pointer-events:none;
            z-index: 1;
            overflow: visible;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile {
            fill: rgba(255,255,255,0.02);
            stroke: rgba(255,255,255,0.98);
            stroke-width: 0.8;
            vector-effect: non-scaling-stroke;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.hovered {
            fill: rgba(255,255,255,0.30);
            stroke: rgba(255,255,255,1.00);
            stroke-width: 1.6;
            vector-effect: non-scaling-stroke;
            transition: fill 120ms ease, stroke-width 120ms ease;
            filter: drop-shadow(0 10px 24px rgba(255,255,255,0.12));
        }

        /* Strong hover highlight directly on tiles (works even when overlay is hidden) */
        .tactical-grid.iso .tile:hover::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 50%;
            width: calc(var(--isoTileW,64px) + 8px);
            height: calc(var(--isoTileH,32px) + 8px);
            transform: translate(-50%, -50%);
            pointer-events: none;
            clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            -webkit-clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            background: rgba(255,255,255,0.22);
            border: 2px solid rgba(255,255,255,0.45);
            box-shadow: 0 10px 30px rgba(255,255,255,0.18), 0 0 36px rgba(255,255,255,0.14);
            z-index: 0;
            transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.move-path {
            fill: rgba(255,255,255,0.06);
            stroke: rgba(255,255,255,0.95);
            stroke-width: 0.9;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.move-dest {
            fill: rgba(255,255,255,0.12);
            stroke: rgba(255,255,255,1.00);
            stroke-width: 1.1;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.in-range {
            fill: rgba(255,255,255,0.04);
            stroke: rgba(255,255,255,0.75);
            stroke-width: 0.9;
            stroke-dasharray: 4 3;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.in-range-enemy {
            fill: rgba(255,255,255,0.06);
            stroke: rgba(255,255,255,0.95);
            stroke-width: 1.1;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.active {
            fill: rgba(255,255,255,0.06);
            stroke: rgba(255,255,255,0.95);
            stroke-width: 1.2;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.active-enemy-turn {
            fill: rgba(255,255,255,0.08);
            stroke: rgba(255,255,255,0.96);
            stroke-width: 1.5;
        }
        .tactical-grid.iso .iso-grid-overlay .iso-tile.reward-tile {
            fill: rgba(255,255,255,0.05);
            stroke: rgba(255,255,255,0.75);
            stroke-width: 1;
        }

        /* Hide square-grid hover visuals in iso mode; the overlay handles it. */
        .tactical-grid.iso .tile.move-path,
        .tactical-grid.iso .tile.move-dest,
        .tactical-grid.iso .tile.in-range,
        .tactical-grid.iso .tile.in-range-enemy,
        .tactical-grid.iso .tile.active,
        .tactical-grid.iso .tile.active-enemy-turn,
        .tactical-grid.iso .tile.reward-tile {
            outline: none;
        }

        /* Skill & path highlights that work directly on iso tiles (useful when overlay is hidden/integrated-terrain) */
        .tactical-grid.iso .tile.in-range::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 50%;
            width: var(--isoTileW, 64px);
            height: var(--isoTileH, 32px);
            transform: translate(-50%, -50%);
            pointer-events: none;
            clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            -webkit-clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            background: rgba(66,133,244,0.75);
            border: 1px solid rgba(66,133,244,0.75);
            z-index: 1;
            transition: background 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
        }
        .tactical-grid.iso .tile.in-range-enemy::after {
            background: rgba(244,66,66,0.75);
            border-color: rgba(244,66,66,0.75);
        }

        /* Active unit highlight: apply solely to the tile ground (.tile-bg) so it never occludes the unit sprite or bars */
        .tactical-grid.iso .tile.active .tile-bg {
            /* stronger ground overlay: brighter, thicker border and stronger inset glow */
            background: rgba(255,217,101,0.62);
            border: 3px solid rgba(255,217,101,0.95);
            box-shadow: inset 0 18px 44px rgba(255,217,101,0.28), 0 6px 18px rgba(255,217,101,0.06);
            transform: translate(-50%, -50%) scale(1.03);
            transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
            z-index: 0; /* keep behind sprites and bars */
        }
        .tactical-grid.iso .tile.active-enemy-turn .tile-bg {
            background: rgba(244,67,54,0.50);
            border: 3px solid rgba(244,67,54,0.96);
            box-shadow: inset 0 18px 44px rgba(244,67,54,0.22), 0 6px 18px rgba(244,67,54,0.06);
            transform: translate(-50%, -50%) scale(1.03);
            transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
            z-index: 0;
        }

        /* Remove previous overlay animation rules and ensure hover still shows a visible highlight without occluding units */
        .tactical-grid.iso .tile:hover .tile-bg {
            filter: brightness(1.06);
        }

        /* When hovering an in-range tile, only change opacity (no scale/shadow) */
        .tactical-grid.iso .tile.in-range:hover::after {
            background: rgba(66,133,244,1);
            border-color: rgba(66,133,244,1);
            /* reset transformations/visual lift so only opacity changes */
            transform: translate(-50%, -50%);
            box-shadow: none;
        }
        .tactical-grid.iso .tile.in-range-enemy:hover::after {
            background: rgba(244,66,66,1);
            border-color: rgba(244,66,66,1);
            transform: translate(-50%, -50%);
            box-shadow: none;
        }

        .tactical-grid.iso .tile.move-dest::after { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.38); }
        .tactical-grid.iso .tile.move-path::after { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.22); }

        /* Projectiles (ex: boule de feu) */
        .tactical-projectile {
            position:absolute;
            width: 42px;
            height: 42px;
            pointer-events:none;
            user-select:none;
            -webkit-user-drag:none;
            z-index: 60;
            filter: drop-shadow(0 6px 10px rgba(0,0,0,0.45));
            will-change: transform, opacity;
        }

        .tactical-impact {
            position:absolute;
            width: 86px;
            height: 86px;
            pointer-events:none;
            user-select:none;
            -webkit-user-drag:none;
            z-index: 61;
            filter: drop-shadow(0 10px 18px rgba(0,0,0,0.45));
            will-change: transform, opacity;
        }

        /* Déplacement animé: on superpose un "ghost" qui glisse au-dessus de la grille */
        .tactical-move-ghost {
            position:absolute;
            left:0;
            top:0;
            z-index: 100000;
            pointer-events:none;
            will-change: transform;
        }
        .tile { position:relative; display:flex; align-items:center; justify-content:center; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); cursor:pointer; font-family: 'Cinzel', 'Georgia', serif; overflow:hidden; }

        /* Temporary dim effect (used by lightning): darken tiles only (not full-screen UI) */
        .tile.dimmed-black { background: rgba(0,0,0,0.92) !important; }
        .tile.dimmed-black .tile-bg { background: rgba(0,0,0,0.92) !important; filter: none !important; }

        /* Same dim effect, but resilient to re-render (toggle on body).
           IMPORTANT: in iso view, darken ONLY the ground (diamond), like in-range highlights. */
        body.tactical-dim-tiles #tacticalGrid:not(.iso) .tile { background: rgba(0,0,0,0.92) !important; }

        body.tactical-dim-tiles #tacticalGrid.iso .tile::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 50%;
            width: var(--isoTileW, 64px);
            height: var(--isoTileH, 32px);
            transform: translate(-50%, -50%);
            pointer-events: none;
            clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            -webkit-clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
            background: rgba(0,0,0,0.92);
            border: 1px solid rgba(0,0,0,0.95);
            z-index: 1;
        }
        /* Déplacement: portée cachée. On surligne seulement la case survolée + le chemin. */
        .tile.reachable { outline: none; }
        .tile.move-path { outline: 2px solid rgba(255,255,255,0.35); background: rgba(255,255,255,0.06); }
        .tile.move-dest { outline: 2px solid rgba(255,255,255,0.65); background: rgba(255,255,255,0.10); }
        /* Portée des sorts: visible uniquement quand un sort est sélectionné */
        .tile.in-range { outline: 2px dashed rgba(255,255,255,0.45); background: rgba(255,255,255,0.06); }
        .tile.in-range-enemy { outline: 2px solid rgba(255,255,255,0.70); background: rgba(255,255,255,0.08); }
        .tile.active { outline: 2px solid rgba(255,255,255,0.7); }
        /* Mettre davantage en lumière le gobelin (ennemi) quand c'est son tour */
        .tile.active-enemy-turn {
            outline: 3px solid rgba(255,255,255,0.92);
            box-shadow: 0 0 0 3px rgba(255,255,255,0.18), 0 0 22px rgba(255,255,255,0.28);
            background: rgba(255,255,255,0.08);
        }

        .tile.reward-tile { outline: 2px solid rgba(255,255,255,0.35); background: rgba(255,255,255,0.06); }
        .reward-marker {
            position:absolute;
            left:6px;
            right:6px;
            bottom:6px;
            padding:4px 6px;
            border-radius:8px;
            font-size: 12px;
            font-weight: 800;
            text-align:center;
            background: rgba(0,0,0,0.55);
            border: 1px solid rgba(255,255,255,0.10);
            color: rgba(255,255,255,0.95);
        }
        .reward-marker.reward-marker-icon {
            left:0;
            right:0;
            top:0;
            bottom:0;
            padding:0;
            border-radius:10px;
            background: transparent;
            border: none;
            display:flex;
            align-items:center;
            justify-content:center;
            pointer-events:none;
        }
        .reward-marker-img {
            display:block;
            max-width:34px;
            height:auto;
            margin:0 auto;
        }
        .reward-marker.reward-marker-icon .reward-marker-img {
            width:100%;
            height:100%;
            max-width:none;
            max-height:none;
            object-fit:contain;
            margin:0;
            pointer-events:none;
        }
        .reward-marker.reward-retreat { opacity: 0.95; }

        /* Flash effects for damage/heal like in Pokémon */
        .unit-sprite.flash-damage { animation: tactical-flash-damage 600ms linear; }
        .unit-sprite.flash-heal { animation: tactical-flash-heal 360ms linear; }
        .unit-sprite-bar.hp.flash-damage { box-shadow: 0 0 10px rgba(255,0,0,0.85) inset; }
        .unit-sprite-bar.hp.flash-heal { box-shadow: 0 0 10px rgba(80,255,120,0.85) inset; }
        .unit-sprite-bar.hp.flash-reduced { box-shadow: 0 0 10px rgba(66,133,244,0.85) inset; }

        @keyframes tactical-flash-damage {
            0% { opacity: 1; filter: drop-shadow(0 0 0 rgba(255,0,0,0.0)); transform: translateY(0); }
            25% { opacity: 0.2; transform: translateY(-2px); }
            50% { opacity: 1; transform: translateY(0); }
            75% { opacity: 0.2; transform: translateY(-2px); }
            100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes tactical-flash-heal {
            0% { opacity: 1; }
            50% { opacity: 0.25; }
            100% { opacity: 1; }
        }
        .unit-badge { width: 100%; height: 100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; }
        .unit-name { font-size: 0.82em; opacity: 0.95; text-align:center; padding: 0 4px; }
        .unit-hp { font-size: 0.78em; opacity: 0.9; }
        .unit-team-allies { background: rgba(76,175,80,0.08); }
        .unit-team-enemies { background: rgba(244,67,54,0.07); }

        /* Units that already acted this cycle (pick-alternate): subtle dimming on the unit only */
        .tile.acted .unit-sprite {
            filter: brightness(0.6);
        }

        .unit-sprite { width: 110%; height: 110%; object-fit: contain; display:block; pointer-events:none; user-select:none; -webkit-user-drag:none; transition: filter 140ms ease; }
        .unit-sprite-wrap { width: 100%; height: 100%; display:flex; align-items:center; justify-content:center; position:relative; }
        .unit-sprite-ap { position:absolute; top:4px; right:4px; display:flex; gap:3px; flex-wrap:wrap; justify-content:flex-end; max-width: 52%; pointer-events:none; }
        .unit-sprite-apdot { width:8px; height:8px; border-radius:999px; border:1px solid rgba(255,255,255,0.35); background: rgba(0,0,0,0.25); }
        .unit-sprite-apdot.filled { background: rgba(255,255,255,0.85); border-color: rgba(255,255,255,0.75); box-shadow: 0 0 8px rgba(255,255,255,0.18); }

        .unit-sprite-stats { position:absolute; top:4px; left:4px; display:flex; gap:3px; flex-wrap:wrap; justify-content:flex-start; max-width: 52%; pointer-events:none; }

        /* Stun badge (yellow pill) */
        .unit-sprite-stun {
            position:absolute;
            top:6px;
            right:6px;
            padding:3px 8px;
            background: rgba(255,235,59,0.95);
            color: #111;
            font-weight:800;
            font-size:11px;
            border-radius:999px;
            border: 1px solid rgba(0,0,0,0.12);
            box-shadow: 0 3px 10px rgba(0,0,0,0.25);
            pointer-events:none;
            z-index: 6;
        }

        .unit-sprite-overlay { position:absolute; bottom:30%; left:50%; transform:translateX(-50%); width:70%; display:flex; flex-direction:column; gap:2px; pointer-events:none; align-items:center; }
        .unit-sprite-bar { position:relative; border-radius:999px; background: rgba(255,255,255,0.10); overflow:hidden; border:1px solid rgba(255,255,255,0.08); width:70%; margin:0 auto; }
        /* Augmentation de hauteur de ~35% */
        .unit-sprite-bar.hp { height:11px; }
        .unit-sprite-bar.mana { height:8px; }
        .unit-sprite-barfill { height:100%; border-radius:999px; }
        .unit-sprite-barfill.hp { background: linear-gradient(90deg,#f44336,#c62828); }
        .unit-sprite-barfill.mana { background: linear-gradient(90deg,#2196f3,#1565c0); }

        .unit-sprite-effects { position:absolute; right:4px; top:50%; transform: translateY(-50%); display:flex; gap:3px; align-items:center; }
        /* Badges d'effets: uniquement l'icône (pas de fond) */
        .unit-sprite-effbadge {
            display:inline-flex;
            align-items:center;
            justify-content:center;
            font-size: 12px;
            line-height: 1;
            font-weight: 800;
            padding: 0;
            margin: 0;
            border: none;
            background: transparent;
            box-shadow: none;
            color: rgba(255,255,255,0.95);
            text-shadow: 0 1px 2px rgba(0,0,0,0.75);
        }
        /* Buffs: vert (couleurs "froides"/positives) */
        .unit-sprite-effbadge.buff,
        .unit-sprite-effbadge.hot,
        .unit-sprite-effbadge.mana_regen.pos {
            color: rgba(76,175,80,0.98);
        }
        /* Debuffs: rouge */
        .unit-sprite-effbadge.debuff,
        .unit-sprite-effbadge.vulnerability,
        .unit-sprite-effbadge.mana_regen.neg {
            color: rgba(244,67,54,0.98);
        }
        /* Brûlure: orange */
        .unit-sprite-effbadge.dot.burn {
            color: rgba(255,152,0,0.98);
        }

        /* Unit panel effect badges (bigger + with background) */
        .unit-panel-effects { margin-top: 6px; display:flex; flex-wrap:wrap; gap:6px; }
        .unit-panel-effbadge {
            display:inline-flex;
            align-items:center;
            justify-content:center;
            width: 22px;
            height: 22px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(0,0,0,0.28);
            box-shadow: 0 6px 14px rgba(0,0,0,0.22);
            font-size: 13px;
            line-height: 1;
            font-weight: 900;
            user-select:none;
        }
        .unit-panel-effbadge.buff,
        .unit-panel-effbadge.hot,
        .unit-panel-effbadge.mana_regen.pos {
            color: rgba(76,175,80,0.98);
        }
        .unit-panel-effbadge.debuff,
        .unit-panel-effbadge.vulnerability,
        .unit-panel-effbadge.mana_regen.neg {
            color: rgba(244,67,54,0.98);
        }
        .unit-panel-effbadge.dot.poison {
            color: rgba(0,0,0,0.95);
            text-shadow: 0 0 2px rgba(255,255,255,0.45), 0 1px 2px rgba(0,0,0,0.85);
            background: rgba(255,255,255,0.75);
            border-color: rgba(0,0,0,0.18);
        }
        .unit-panel-effbadge.dot.burn { color: rgba(255,152,0,0.98); }
        .unit-panel-effbadge.dot { color: rgba(244,67,54,0.95); }
        .unit-panel-effbadge.defense { color: rgba(255,255,255,0.95); }

        /* Deployment UI */
        .deployment-banner { box-shadow: 0 4px 18px rgba(0,0,0,0.6); }
        .tile.deployment-allowed { outline: 2px dashed rgba(255,215,85,0.95); background: linear-gradient(90deg, rgba(255,230,140,0.06), rgba(255,215,85,0.02)); }
        /* Poison: noir */
        .unit-sprite-effbadge.dot.poison {
            color: rgba(0,0,0,0.95);
            text-shadow: 0 0 2px rgba(255,255,255,0.45), 0 1px 2px rgba(0,0,0,0.85);
        }
        /* DoT générique */
        .unit-sprite-effbadge.dot {
            color: rgba(244,67,54,0.95);
        }
        .unit-sprite-effbadge.defense {
            color: rgba(255,255,255,0.95);
        }
        .team-panel { overflow:auto; max-height: min(60vh, 520px); }
        .log-panel { overflow:auto; max-height: 220px; }
        .tactical-log { overflow:auto; font-size: 0.95em; }
        .tactical-log .line { padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06); }
    `;

    document.head.appendChild(style);
}
