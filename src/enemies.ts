import { Player } from './player.js';
import { Skill } from './skill.js';
import { createSkill } from './skillLibrary.js';

function scaled(base: number, perLevel: number | undefined, level: number): number {
  const lvl = Math.max(1, Math.floor(level || 1));
  const inc = Math.floor(Number(perLevel ?? 0));
  return Math.floor(Number(base ?? 0)) + (lvl - 1) * inc;
}

function cloneSkills(skills: Skill[] | undefined): Skill[] {
  const src = skills ?? [];
  return src
    .filter(Boolean)
    .map((s) => {
      const id = (s as any).skillId as Parameters<typeof createSkill>[0] | undefined;
      return id ? createSkill(id) : s;
    });
}

// Catalogue d'ennemis (exemple de base, à compléter)
export const ENEMY_DEFS = {
  gobelin: {
    type: 'gobelin',
    name: 'Guerrier gobelin',
    pv: 55,
    pvPerLevel: 10,
    mana: 40,
    manaPerLevel: 1,
    attack: 15,
    attackPerLevel: 2,
    manaRegenPerTurn: 10,
    skills: [
      createSkill('basic_attack'),
      createSkill('block'),
      createSkill('charge')
    ] as Skill[],
    xpReward: 10,
    xpPerLevel: 1,
    goldReward: 4,
    goldPerLevel: 1,
    woodReward: 0,
    woodPerLevel: 0,
    herbReward: 0,
    herbPerLevel: 0,
    cuirReward: 0,
    cuirPerLevel: 0,
    ferReward: 0,
    ferPerLevel: 0,
    image: 'ImagesRPG/imagespersonnage/trueennemi.png',
    description: 'Petit être agressif, facile à vaincre mais souvent en groupe.'
  },
  sergent_gobelin: {
    type: 'gobelin',
    name: 'Sergent gobelin',
    // Stats de base
    pv: 100,
    pvPerLevel: 0,
    mana: 40,
    manaPerLevel: 0,
    attack: 15,
    attackPerLevel: 0,
    // mana/tour
    manaRegenPerTurn: 20,
    // PA
    actionPointsMax: 3,
    // Sorts
    skills: [
      createSkill('basic_attack'),
      createSkill('charge'),
      createSkill('block'),
      createSkill('mana_gain')
    ] as Skill[],
    // Autres stats (caractéristiques)
    characteristics: {
      defense: 1,
      critique: 0,
      vitesse: 2,
    },
    // Récompenses (valeurs simples par défaut)
    xpReward: 15,
    xpPerLevel: 0,
    goldReward: 5,
    goldPerLevel: 0,
    woodReward: 0,
    woodPerLevel: 0,
    herbReward: 0,
    herbPerLevel: 0,
    cuirReward: 0,
    cuirPerLevel: 0,
    ferReward: 0,
    ferPerLevel: 0,
    image: 'ImagesRPG/imagespersonnage/sergent gobelin.png',
    description: 'Un gobelin vétéran, plus résistant et discipliné.'
  },
  chef_gobelin: {
    type: 'gobelin',
    name: 'Chef gobelin',
    // Stats de base
    pv: 200,
    pvPerLevel: 0,
    mana: 60,
    manaPerLevel: 0,
    attack: 20,
    attackPerLevel: 0,
    // mana/tour
    manaRegenPerTurn: 20,
    // PA
    actionPointsMax: 3,
    // Sorts
    skills: [
      createSkill('basic_attack'),
      createSkill('charge'),
      createSkill('block'),
      createSkill('eclair'),
      createSkill('mana_gain')
    ] as Skill[],
    // Autres stats (caractéristiques)
    characteristics: {
      defense: 1,
      critique: 1,
      vitesse: 2,
    },
    // Récompenses (valeurs simples par défaut)
    xpReward: 25,
    xpPerLevel: 0,
    goldReward: 10,
    goldPerLevel: 0,
    woodReward: 0,
    woodPerLevel: 0,
    herbReward: 0,
    herbPerLevel: 0,
    cuirReward: 0,
    cuirPerLevel: 0,
    ferReward: 0,
    ferPerLevel: 0,
    image: 'ImagesRPG/imagespersonnage/chefgobelin.png',
    description: 'Chef des gobelins: plus puissant, manie la foudre et se protège.'
  },
  gobelin_archer: {
    type: 'gobelin',
    name: 'Archer gobelin',
    pv: 45,
    pvPerLevel: 5,
    mana: 40,
    manaPerLevel: 0,
    attack: 8,
    attackPerLevel: 3,
    manaRegenPerTurn: 10,
    skills: [
      createSkill('tir_gobelin')
    ] as Skill[],
    xpReward: 12,
    xpPerLevel: 1,
    goldReward: 4,
    goldPerLevel: 1,
    woodReward: 0,
    woodPerLevel: 0,
    herbReward: 0,
    herbPerLevel: 0,
    cuirReward: 0,
    cuirPerLevel: 0,
    ferReward: 0,
    ferPerLevel: 0,
    actionPointsMax: 2,
    image: 'ImagesRPG/imagespersonnage/gobelin_archer.png',
    description: 'Un gobelin archer qui attaque à distance.'
  },
  loup: {
    name: 'Loup féroce',
    pv: 60,
    pvPerLevel: 10,
    mana: 35,
    manaPerLevel: 3,
    attack: 10,
    attackPerLevel: 2,
    manaRegenPerTurn: 20,
    skills: [
      createSkill('basic_attack'),
      createSkill('mana_gain')
    ] as Skill[],
    xpReward: 10,
    xpPerLevel: 1,
    goldReward: 7,
    goldPerLevel: 1,
    woodReward: 0,
    woodPerLevel: 0,
    herbReward: 0,
    herbPerLevel: 0,
    cuirReward: 0,
    cuirPerLevel: 0,
    ferReward: 0,
    ferPerLevel: 0,
    actionPointsMax: 3,
    image: 'ImagesRPG/imagespersonnage/loup.png',
    description: 'Loup sauvage, rapide et féroce — attention aux dégâts élevés.'
  }
  ,
  arbre: {
    name: 'Arbre',
    pv: 50,
    pvPerLevel: 10,
    mana: 40,
    manaPerLevel: 5,
    attack: 9,
    attackPerLevel: 1,
    manaRegenPerTurn: 10,
    skills: [
      createSkill('debuff_attaque'),
      createSkill('mana_gain')
    ] as Skill[],
    xpReward: 7,
    xpPerLevel: 1,
    goldReward: 0,
    goldPerLevel: 0,
    woodReward: 1,
    woodPerLevel: 0,
    herbReward: 0,
    herbPerLevel: 0,
    cuirReward: 0,
    cuirPerLevel: 0,
    ferReward: 0,
    ferPerLevel: 0,
    image: 'ImagesRPG/imagespersonnage/trueennemi.png',
    description: 'Un arbre massif qui affaiblit ses adversaires à chaque tour.'
  }
  // Ajoute ici d'autres ennemis...
} as const;

export type EnemyId = keyof typeof ENEMY_DEFS;

export function createEnemy(id: EnemyId, level: number = 1): Player {
  const def = ENEMY_DEFS[id] as any;
  const pv = scaled(def.pv, def.pvPerLevel, level);
  const maxPv = pv;
  const attack = scaled(def.attack, def.attackPerLevel, level);
  const mana = scaled(def.mana, def.manaPerLevel, level);
  const xp = scaled(def.xpReward, def.xpPerLevel, level);
  const gold = scaled(def.goldReward, def.goldPerLevel, level);
  const wood = scaled(def.woodReward ?? 0, def.woodPerLevel ?? 0, level);
  const herb = scaled(def.herbReward ?? 0, def.herbPerLevel ?? 0, level);
  const cuir = scaled(def.cuirReward ?? 0, def.cuirPerLevel ?? 0, level);
  const fer = scaled(def.ferReward ?? 0, def.ferPerLevel ?? 0, level);

  const enemy = new Player(
    `${def.name} niveau ${level}`,
    pv,
    maxPv,
    attack,
    cloneSkills(def.skills),
    mana,
    false,
    0,
    0,
    xp,
    gold,
    def.manaRegenPerTurn ?? 20,
    wood,
    herb,
    Math.max(1, Math.floor(Number(def.actionPointsMax ?? 2))),
    0,
    def.characteristics
  );

  // Propagate image and rewards to the created enemy instance so the UI can use it.
  (enemy as any).image = def.image;
  (enemy as any).woodReward = wood;
  (enemy as any).herbReward = herb;
  (enemy as any).cuirReward = cuir;
  (enemy as any).ferReward = fer;
  return enemy;
}
