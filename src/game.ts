import { ask, Choice } from "./choice.js";
import { Fight } from "./fight.js";
import { Home } from "./home.js";
import { Player } from "./player.js";
import { Skill } from "./skill.js";
import { createSkill } from './skillLibrary.js';
import { AudioManager } from "./audio.js";
import { QuestManager } from './questManager.js';
import { QUEST_DEFS } from './quests.js';
import { advanceGameTimeHours } from './daySystem.web.js';

export class Game {
    public name: string;
    public home: Home;
    public hero: Player;
    public audioManager: AudioManager;
    public questManager: QuestManager;
    public skillTree: {skill: Skill, unlockLevel: number}[] = [
        // Core skills: verrouillables au niveau 1 (noyau central)
        {skill: createSkill('basic_attack'), unlockLevel: 1},
        {skill: createSkill('mana_gain'), unlockLevel: 1},
        {skill: createSkill('couteau_magique'), unlockLevel: 1},
        {skill: createSkill('eclair'), unlockLevel: 1},
        {skill: createSkill('boule_de_feu'), unlockLevel: 1},
        {skill: createSkill('mana_groupe'), unlockLevel: 1},
        {skill: createSkill('teleportation'), unlockLevel: 1},
        {skill: createSkill('rayon_de_feu'), unlockLevel: 1},
        {skill: createSkill('soin'), unlockLevel: 1},
        {skill: createSkill('block'), unlockLevel: 1},
        {skill: createSkill('charge'), unlockLevel: 1},
        {skill: createSkill('hache_lourde'), unlockLevel: 1},
        {skill: createSkill('lancer_allie'), unlockLevel: 1},
        {skill: createSkill('lancer_ennemi'), unlockLevel: 1},
        {skill: createSkill('repouser'), unlockLevel: 1},
        {skill: createSkill('harpon_chaine'), unlockLevel: 1},
        {skill: createSkill('fureur'), unlockLevel: 1},
        {skill: createSkill('mouvement_de_fou'), unlockLevel: 1},
        {skill: createSkill('shuriken'), unlockLevel: 1},
        {skill: createSkill('bombe_fumigene'), unlockLevel: 1},
        {skill: createSkill('buff_attaque'), unlockLevel: 1},
        {skill: createSkill('fragiliser'), unlockLevel: 1},
        {skill: createSkill('assassinat'), unlockLevel: 1},
        {skill: createSkill('immobiliser'), unlockLevel: 1},
        {skill: createSkill('gain_pa_groupe'), unlockLevel: 1},

        // Level 1
        {skill: createSkill('missile_magique'), unlockLevel: 1},
        // Level 2
        {skill: createSkill('petit_soin'), unlockLevel: 2},
        {skill: createSkill('buff_regen_mana'), unlockLevel: 2},
        {skill: createSkill('boule_de_givre'), unlockLevel: 2},
        {skill: createSkill('ralentissement'), unlockLevel: 2},
        {skill: createSkill('mana_groupe'), unlockLevel: 2},
        {skill: createSkill('marque_vulnerante'), unlockLevel: 2},
        {skill: createSkill('fragiliser'), unlockLevel: 2},
        {skill: createSkill('assassinat'), unlockLevel: 2},
        {skill: createSkill('lancer_allie'), unlockLevel: 2},
        {skill: createSkill('repouser'), unlockLevel: 2},
        {skill: createSkill('bombe_fumigene'), unlockLevel: 3},
        {skill: createSkill('buff_attaque'), unlockLevel: 5}, // Buff attaque niveau 5
        {skill: createSkill('soin'), unlockLevel: 10}, // Soin niveau 10
        {skill: createSkill('malediction'), unlockLevel: 2}, // Malédiction facteur atk 1
        // Level 3
        {skill: createSkill('boule_de_feu'), unlockLevel: 2}, // Boule de feu attaque 150%
        {skill: createSkill('brulure'), unlockLevel: 8}, // DoT 4 tours 50% attaque, mana 30
        {skill: createSkill('hache_lourde'), unlockLevel: 3},
        {skill: createSkill('double_crochet'), unlockLevel: 3},
        {skill: createSkill('harpon_chaine'), unlockLevel: 3},
        {skill: createSkill('poison'), unlockLevel: 3}, // Poison mana cost 20
        // Level 4
        {skill: createSkill('buff_permanent'), unlockLevel: 4},
        {skill: createSkill('debuff_attaque'), unlockLevel: 4},
        {skill: createSkill('regeneration'), unlockLevel: 4}, // Régénération mana cost 30
        // Level 5
        {skill: createSkill('debuff_permanent'), unlockLevel: 5},
        {skill: createSkill('rayon_de_feu'), unlockLevel: 5}, // Mage: Rayon de feu (250% attaque, portée 7, orthogonal, touche toute la ligne)
        {skill: createSkill('fureur'), unlockLevel: 5},
        {skill: createSkill('immobiliser'), unlockLevel: 4},
        // Level 20
        {skill: createSkill('grand_soin'), unlockLevel: 20}
    ];
    constructor(name: string, hero: Player) {
        this.name = name;
        this.hero = hero;
        this.audioManager = new AudioManager();
        this.questManager = new QuestManager(hero, QUEST_DEFS);
        // Charger la musique de fond en boucle (volume 0.5)
        this.audioManager.loadSound('background', 'sounds/musique.mp3', true, 0.1);
        // Charger l'intro courte (une seule fois)
        this.audioManager.loadSound('intro', 'sounds/prenomaudio.mp3', false, 0.4);
        // Charger le son court "groot" qui se joue après l'intro
        this.audioManager.loadSound('groot', 'sounds/groot.mp3', false, 0.9);
        // Audio PNJ (menu compétences) : joué à la première ouverture
        this.audioManager.loadSound('pnjintro', 'sounds/Pnjintroaudio.mp3', false, 0.9);
        // Musique/soundscape pour l'auberge (boucle)
        this.audioManager.loadSound('auberge', 'sounds/aubergesound.mp3', true, 0.9);
        // Audio rire maléfique (sfx) : utilisé par certaines compétences
        this.audioManager.loadSound('riremalefique', 'sounds/riremalefique.mp3', false, 0.5);
        // Audio attaques (sfx) : lancé sur certaines compétences du joueur
        this.audioManager.loadSound('attaque', 'sounds/attaqueaudio.mp3', false, 0.9);
        // Audio Boule de feu (sfx)
        this.audioManager.loadSound('bouledefeu', 'sounds/bouledefeu.mp3', false, 0.9);
        // Forge (sfx)
        this.audioManager.loadSound('forge_bad', 'sounds/forge_bad.mp3', false, 0.9);
        this.audioManager.loadSound('forge_crit', 'sounds/forge_crit.mp3', false, 0.9);
        this.audioManager.loadSound('forge_meule', 'sounds/forge_meule.mp3', false, 0.9);
        // Couture SFX
        this.audioManager.loadSound('couture_predecoupe', 'sounds/couture_predecoupe.mp3', false, 0.9);
        this.audioManager.loadSound('couture_decoupe', 'sounds/couture_decoupe.mp3', false, 0.9);
        this.audioManager.loadSound('couture_alignement', 'sounds/couture_alignement.mp3', false, 0.9);
        // Audio Éclair (sfx)
        this.audioManager.loadSound('eclair', 'sounds/eclair.mp3', false, 0.9);
        // Audio magic (mana gain)
        this.audioManager.loadSound('magic', 'sounds/magic.mp3', false, 0.9);
        // Audio heal (healing SFX)
        this.audioManager.loadSound('healaudio', 'sounds/healaudio.mp3', false, 0.9);
        // Audio missile magique (sfx)
        this.audioManager.loadSound('sortaudio', 'sounds/sortaudio.mp3', false, 0.9);
        // Audio Boule de givre (sfx)
        this.audioManager.loadSound('givre', 'sounds/ice-magic-attack-effect.mp3', false, 0.9);
        // Olaf attack-buff sound
        this.audioManager.loadSound('olaf', 'sounds/onvasamuser_olaf.mp3', false, 0.9);
        // Olaf start combat sound (tactical plateau)
        this.audioManager.loadSound('cestparti_olaf', 'sounds/cestparti_olaf.mp3', false, 0.5);
        // Son spécial : destin scellé (joué quand un guerrier tue un ennemi)
        this.audioManager.loadSound('destinscelle', 'sounds/destinscelle.mp3', false, 0.9);
        // Son de sélection pour "Lancer d'allié"
        this.audioManager.loadSound('ilsvontpasaimer', 'sounds/ilsvontpasaimer.mp3', false, 0.5);
        // Son d'impact pour Lancer d'allié
        this.audioManager.loadSound('explosion', 'sounds/explosion.mp3', false, 0.9);
        // Son quand on sélectionne le voleur pour jouer (plateau tactique)
        this.audioManager.loadSound('jemenoccupe', 'sounds/jemenoccupe.mp3', false, 0.9);
        // Son quand on sélectionne le guerrier pour jouer (plateau tactique)
        this.audioManager.loadSound('aucombat', 'sounds/aucombat.mp3', false, 0.9);
        // Son quand on sélectionne le mage pour jouer (plateau tactique)
        this.audioManager.loadSound('nemeretenezpas', 'sounds/nemeretenezpas.mp3', false, 0.6);
        // Nouvelle version: 'allonsy' — son à jouer quand on sélectionne le mage
        this.audioManager.loadSound('allonsy', 'sounds/allonsy.mp3', false, 0.6);
        this.home = new Home(
            [
                new Choice('R', 'Aller au village'),
                new Choice('C', 'Combattre')
            ]
        );
    }

    public async init() {
        // Musique chargée, sera lancée au premier clic
    }

    public async goHome() {
        const response = await this.home.init();
        console.log('Vous avez choisi de ' + response.description);
        if (response.key == 'C') {
            this.goFight();
        } else if (response.key == 'R') {
            await this.goRest();
        }
        return response;
    }

    public async goFight() {
        // Gobelin de base au niveau 1 (PV de base = 55)
        let gobelinLevel = 1;
        let continueFighting = true;
        while (continueFighting) {
            const enemyPv = 65 + (gobelinLevel - 1) * 15;
            const enemyAttack = 8 + gobelinLevel * 2;
            const enemyMana = 20 + gobelinLevel * 1;
            const enemyXpReward = 10 + gobelinLevel * 1;
            const enemyGoldReward = 7 + gobelinLevel * 1;

            const mechant = new Player(
                `Guerrier gobelin niveau ${gobelinLevel}`,
                enemyPv,
                enemyPv,
                enemyAttack,
                [createSkill('basic_attack')],
                enemyMana,
                false,
                0,
                0,
                enemyXpReward,
                enemyGoldReward
            );
            const fight = new Fight(this.hero, mechant);
            const winner = await fight.init();
            if (winner === this.hero) {
                this.hero.gainXP(mechant.xpReward);
                this.hero.gold += mechant.goldReward;
                console.log(this.hero.name + ` gagne ${mechant.goldReward} pièces d'or ! Total: ${this.hero.gold}`);
                // Ask if player wants to continue
                const nextChoices = [
                    new Choice('C', 'Enchaîner un autre combat (gobelin +1 niveau)'),
                    new Choice('V', 'Retourner au village')
                ];
                const response = await ask('Que voulez-vous faire ?', nextChoices);
                if (response.key === 'C') {
                    gobelinLevel++;
                } else {
                    continueFighting = false;
                }
            } else {
                // Player lost, end chain and return to village
                continueFighting = false;
            }
        }
        await this.goHome();
    }

    public async goRest() {
        while (true) {
            const villageMenu = new Home([
                new Choice('A', 'Dormir à l\'auberge (plein PV et mana, coûte 30 or)'),
                new Choice('E', 'Résoudre une énigme (+200 XP si réussite)'),
                new Choice('S', 'Apprendre des compétences'),
                new Choice('T', 'S\'entraîner contre un maître'),
                new Choice('B', 'Boutique (vide pour l\'instant)'),
                new Choice('Q', 'Retourner au menu principal')
            ]);
            const response = await villageMenu.init();
            console.log('Vous avez choisi de ' + response.description);
            if (response.key == 'A') {
                if (this.hero.gold >= 30) {
                    this.hero.gold -= 30;
                    this.hero.pv = this.hero.maxPv;
                    this.hero.currentMana = this.hero.maxMana;
					advanceGameTimeHours(this.hero, 12, { reason: 'auberge_sleep' });
                    console.log('Vous dormez à l\'auberge et récupérez tous vos PV et mana. Or restant: ' + this.hero.gold);
                    console.log('PV: ' + this.hero.pv + '/' + this.hero.maxPv + ', Mana: ' + this.hero.currentMana + '/' + this.hero.maxMana);
                } else {
                    console.log('Vous n\'avez pas assez d\'or (30 nécessaires, vous avez ' + this.hero.gold + ').');
                }
            } else if (response.key == 'E') {
                // Simple riddle
                const riddle = 'Quel est l\'animal qui a quatre pattes le matin, deux à midi et trois le soir ?';
                console.log('Énigme : ' + riddle);
                const riddleChoices = [
                    new Choice('A', 'L\'homme'),
                    new Choice('B', 'Le lion'),
                    new Choice('C', 'Le serpent')
                ];
                const userAnswer = await ask('Votre réponse :', riddleChoices);
                if (userAnswer.key == 'A') {
                    this.hero.gainXP(200);
                    console.log('Bonne réponse ! Vous gagnez 200 XP.');
                } else {
                    console.log('Mauvaise réponse. Pas d\'XP cette fois.');
                }
            } else if (response.key == 'S') {
                await this.learnSkills();
            } else if (response.key == 'T') {
                // Training against master
                this.hero.pv = this.hero.maxPv;
                this.hero.currentMana = this.hero.maxMana;
                console.log('Vous vous préparez pour l\'entraînement. PV et mana restaurés à 100%.');
                const masterLevel = this.hero.level;
                const masterPv = 80 + masterLevel * 25;
                const masterAttack = Math.floor((8 + masterLevel * 2) / 2);
                const masterMana = 20 + masterLevel * 1;
                const masterXp = 10 + masterLevel * 5;
                const masterGold = 5 + masterLevel * 2;
                const master = new Player(
                    `Maître niveau ${masterLevel}`,
                    masterPv,
                    masterPv,
                    masterAttack,
                    [createSkill('basic_attack')],
                    masterMana,
                    false,
                    0,
                    0,
                    masterXp,
                    masterGold
                );
                const fight = new Fight(this.hero, master);
                const winner = await fight.init();
                if (winner === this.hero) {
                    this.hero.gainXP(master.xpReward);
                    this.hero.gold += master.goldReward;
                    console.log(`Entraînement terminé avec succès ! Vous gagnez ${master.xpReward} XP et ${master.goldReward} or.`);
                } else {
                    console.log('Vous avez perdu l\'entraînement. Aucun XP gagné.');
                }
            } else if (response.key == 'B') {
                console.log('La boutique est vide pour l\'instant. Revenez plus tard !');
            } else if (response.key == 'Q') {
                break;
            }
        }
        await this.goHome();
    }

    public async learnSkills() {
        console.log('=== Compétences ===');
        console.log('Points de compétence: ' + this.hero.skillPoints);
        console.log('Compétences débloquées:');
        this.hero.skills.forEach(skill => {
            console.log('- ' + skill.name);
        });
        console.log('Compétences disponibles:');
        const available = this.skillTree.filter(s => this.hero.level >= s.unlockLevel && !this.hero.skills.some(hs => hs.name === s.skill.name));
        if (available.length === 0) {
            console.log('Aucune compétence disponible pour le moment.');
            return;
        }
        const skillChoices = available.map((s, index) => new Choice((index + 1).toString(), `${s.skill.name} (Niveau ${s.unlockLevel})`));
        skillChoices.push(new Choice('0', 'Retour'));
        const response = await ask('Choisissez une compétence à apprendre:', skillChoices);
        const num = parseInt(response.key);
        if (num >= 1 && num <= available.length) {
            const selected = available[num - 1]!;
            if (this.hero.skillPoints >= 1) {
                this.hero.skillPoints -= 1;
                this.hero.skills.push(selected.skill);
                console.log('Vous avez appris ' + selected.skill.name + ' !');
            } else {
                console.log('Pas assez de points de compétence.');
            }
        }
    }
}
