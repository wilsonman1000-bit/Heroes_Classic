import type { Game } from './game.js';

declare global {
    interface Window {
        game?: Game;
    }
}

export {};
