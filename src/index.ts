// npm run start
import { Game } from './game.js';
import { Player } from './player.js';
import { createSkill } from './skillLibrary.js';

const hero = new Player(
    'Hero',
    0,
    0,
    0,
    [
        createSkill('basic_attack'),
        createSkill('block'),
        createSkill('mana_gain')
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

hero.syncDerivedStatsFromCharacteristics({ fillResources: true });

const game = new Game('Merdoum 3', hero);
game.init();
    