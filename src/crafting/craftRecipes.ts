import { Campfire, Consumable, Equipment, Item } from '../item.js';

export type CraftCategory = 'equipment' | 'consumable' | 'other';
export type CraftMinigameKind = 'forge' | 'sewing' | 'memory' | null;

export type CraftCost = {
	wood?: number;
	herb?: number;
	cuir?: number;
	fer?: number;
};

export type CraftRecipe = {
	id: string;
	label: string;
	category: CraftCategory;
	cost: CraftCost;
	craftDurationMs?: number;
	minigame: CraftMinigameKind;
	create: () => Item;
};

export const CRAFT_RECIPES: CraftRecipe[] = [
	{
		id: 'potion_small',
		label: 'Potion (coût 5 herbes)',
		category: 'consumable',
		cost: { herb: 5 },
		craftDurationMs: 900,
		minigame: 'memory',
		create: () => new Consumable('potion_small', 'Potion de soin', 'Soigne 50 PV', 'heal', 50),
	},
	{
		id: 'bombe_fumigene_item',
		label: 'Bombe fumigène (coût 1 bois + 1 herbe)',
		category: 'other',
		cost: { wood: 1, herb: 1 },
		craftDurationMs: 700,
		minigame: 'memory',
		create: () => new Item('bombe_fumigene_item', 'Bombe fumigène', "Ressource de compétence (non utilisable en tant qu'objet).", { stackable: true }),
	},
	{
		id: 'staff_novice',
		label: 'Bâton de novice (coût 6 bois)',
		category: 'equipment',
		cost: { wood: 6 },
		craftDurationMs: 1400,
		minigame: 'sewing',
		create: () => new Equipment('staff_novice', 'Bâton de novice', 'Bâton simple (+10 mana maximum)', 'weapon', 0, 0, 0, 10),
	},
	{
		id: 'sword_wood',
		label: 'Épée en bois (coût 4 bois)',
		category: 'equipment',
		cost: { wood: 4 },
		craftDurationMs: 1200,
		minigame: 'forge',
		create: () => new Equipment('sword_wood', 'Épée en bois', "Épée légère (+1 attaque)", 'weapon', 1, 0, 0, 0),
	},
	{
		id: 'sword_1',
		label: 'Épée basique (coût 8 fer)',
		category: 'equipment',
		cost: { fer: 8 },
		craftDurationMs: 1600,
		minigame: 'forge',
		create: () => new Equipment('sword_1', 'Épée basique', 'Épée en fer (+5 attaque)', 'weapon', 5, 0, 0, 0),
	},
	{
		id: 'sword_bronze',
		label: 'Épée de bronze (coût 5 fer)',
		category: 'equipment',
		cost: { fer: 5 },
		craftDurationMs: 1500,
		minigame: 'forge',
		create: () => new Equipment('sword_bronze', 'Épée de bronze', 'Épée en bronze (+2 attaque)', 'weapon', 2, 0, 0, 0),
	},
	{
		id: 'dague_fer',
		label: 'Dague de fer (coût 6 fer)',
		category: 'equipment',
		cost: { fer: 6 },
		craftDurationMs: 1400,
		minigame: 'forge',
		create: () => new Equipment('dague_fer', 'Dague de fer', 'Dague en fer (+2 attaque, +2 critique)', 'weapon', 2, 0, 0, 0, 2),
	},
	{
		id: 'dagues_rouille',
		label: 'Dagues rouillées (coût 3 fer)',
		category: 'equipment',
		cost: { fer: 3 },
		craftDurationMs: 1100,
		minigame: 'forge',
		create: () => new Equipment('dagues_rouille', 'Dagues rouillées', 'Dagues usées (+1 critique)', 'weapon', 0, 0, 0, 0, 1),
	},
	{
		id: 'armor_1',
		label: 'Armure de cuir (coût 6 cuir)',
		category: 'equipment',
		cost: { cuir: 6 },
		craftDurationMs: 1700,
		minigame: 'sewing',
		create: () => new Equipment('armor_1', 'Armure de cuir', 'Armure légère (+20 PV)', 'armor', 0, 0, 20, 0),
	},
	{
		id: 'ring_1',
		label: 'Anneau de mana (coût 4 fer)',
		category: 'equipment',
		cost: { fer: 4 },
		craftDurationMs: 1300,
		minigame: 'forge',
		create: () => new Equipment('ring_1', 'Anneau de mana', 'Anneau (+10 mana)', 'ring', 0, 0, 0, 10),
	},
	{
		id: 'campfire',
		label: 'Feu de camp (coût 5 bois)',
		category: 'other',
		cost: { wood: 5 },
		craftDurationMs: 2200,
		minigame: 'memory',
		create: () => new Campfire(),
	},
];
