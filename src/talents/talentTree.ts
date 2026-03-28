import { createSkill, type SkillId } from '../skillLibrary.js';

export type CharacterClass = 'mage' | 'voleur' | 'guerrier';

export type TalentNodeKind = 'core-skill' | 'spec-skill';

export type TalentNode = {
	id: string;
	kind: TalentNodeKind;
	skillId?: SkillId;
	name: string;
	description: string;
	icon?: string;
	costSkillPoints?: number; // only for spec-skill for now
	requiredLevel?: number;
	prereqs?: string[]; // additional prereqs (AND)
	specId?: string; // for spec nodes
	tier?: number; // 1..n for spec nodes
	slot?: number; // 0..2 (three per tier)
};

export type TalentSpec = {
	id: string;
	name: string;
	// layout hint (0=up,1=right,2=down,3=left)
	direction: 0 | 1 | 2 | 3;
	// tiers of 3 slots each
	tierCount: number;
};

export type TalentTreeDefinition = {
	classId: CharacterClass;
	className: string;
	coreRequiredLevelBySkill?: Record<string, number>;
	coreNodes: TalentNode[];
	specUnlockLevel: number;
	specs: TalentSpec[];
	getSpecNodeId: (specId: string, tier: number, slot: number) => string;
};

export const CLASS_SPECS: Record<CharacterClass, Array<{ id: string; name: string }>> = {
	mage: [
		{ id: 'invocateur', name: 'Invocateur' },
		{ id: 'enchanteur', name: 'Enchanteur' },
		{ id: 'magicien', name: 'Magicien' },
		{ id: 'barde', name: 'Barde' },
	],
	voleur: [
		{ id: 'assassin', name: 'Assassin' },
		{ id: 'arlequin', name: 'Arlequin' },
		{ id: 'chasseur', name: 'Chasseur' },
		{ id: 'saboteur', name: 'Saboteur' },
	],
	guerrier: [
		{ id: 'paladin', name: 'Paladin' },
		{ id: 'barbare', name: 'Barbare' },
		{ id: 'chevalier', name: 'Chevalier' },
		{ id: 'gladiateur', name: 'Gladiateur' },
	],
};

const norm = (s: string) => s.trim().toLowerCase();

export function getCharacterClassId(p: any): CharacterClass {
	const cls = norm(String(p?.characterClass ?? ''));
	if (cls === 'mage') return 'mage';
	if (cls === 'voleur') return 'voleur';
	return 'guerrier';
}

const CORE_SKILLS: Record<CharacterClass, SkillId[]> = {
	mage: ['missile_magique', 'mana_gain', 'couteau_magique', 'eclair', 'boule_de_feu', 'mana_groupe', 'teleportation', 'rayon_de_feu', 'soin'],
	guerrier: ['basic_attack', 'block', 'charge', 'hache_lourde', 'lancer_allie', 'lancer_ennemi', 'repouser', 'harpon_chaine', 'fureur'],
	voleur: ['basic_attack', 'mouvement_de_fou', 'shuriken', 'bombe_fumigene', 'buff_attaque', 'fragiliser', 'assassinat', 'immobiliser', 'gain_pa_groupe'],
};

function coreNodesFromSkills(classId: CharacterClass): TalentNode[] {
	const ids = CORE_SKILLS[classId];
	return ids.map((skillId) => {
		let s: any;
		try {
			s = createSkill(skillId);
		} catch {
			s = null;
		}
		const name = String(s?.name ?? skillId);
		const description = String(s?.description ?? 'Compétence de classe (débloquée par niveau).');
		return {
			id: `core.${skillId}`,
			kind: 'core-skill',
			skillId,
			name,
			description,
		};
	});
}

export function getTalentTreeDefinition(classId: CharacterClass): TalentTreeDefinition {
	const specUnlockLevel = 10;
	const specTierCount = 4; // facilement modifiable plus tard

	const specsSrc = CLASS_SPECS[classId];
	const specs: TalentSpec[] = specsSrc.map((s, idx) => ({
		id: s.id,
		name: s.name,
		direction: (idx as 0 | 1 | 2 | 3),
		tierCount: specTierCount,
	}));

	const getSpecNodeId = (specId: string, tier: number, slot: number) => `spec.${classId}.${specId}.t${tier}.s${slot}`;

	const coreNodes = coreNodesFromSkills(classId);

	return {
		classId,
		className: classId === 'mage' ? 'Mage' : classId === 'voleur' ? 'Voleur' : 'Guerrier',
		coreNodes,
		specUnlockLevel,
		specs,
		getSpecNodeId,
	};
}

// Map specific spec nodes to actual skill IDs when desired. This allows a spec node
// to grant a real Skill (e.g., moving `drain_de_vie` into Assassin tier 1 center slot).
export function getSpecNodeSkillId(classId: CharacterClass, specId: string, tier: number, slot: number): SkillId | undefined {
	// Voleur / Assassin (tier 1): injecter des compétences réelles dans les nodes de spé.
	// slot: 0 (gauche), 1 (centre), 2 (droite)
	if (classId === 'voleur' && specId === 'assassin' && tier === 1 && slot === 0) return 'poison';
	if (classId === 'voleur' && specId === 'assassin' && tier === 1 && slot === 1) return 'drain_de_vie';
	// Voleur / Chasseur (tier 1): Tir à l'arc.
	if (classId === 'voleur' && specId === 'chasseur' && tier === 1 && slot === 1) return 'tir_a_l_arc';
	return undefined;
}

export type TalentTreeState = {
	version: number;
	learnedSpecNodeIds: string[]; // spec nodes learned (cost points)
	learnedCoreSkillIds: string[]; // core skills learned via the talent tree (SkillId strings)
	learnedPassiveNodeIds: string[]; // passive nodes learned (cost points)
};

export function getOrCreateTalentTreeState(p: any): TalentTreeState {
	const cur = (p as any).talentTreeState as TalentTreeState | undefined;
	if (cur && Array.isArray(cur.learnedSpecNodeIds) && typeof cur.version === 'number') {
		if (!Array.isArray((cur as any).learnedCoreSkillIds)) (cur as any).learnedCoreSkillIds = [];
		if (!Array.isArray((cur as any).learnedPassiveNodeIds)) (cur as any).learnedPassiveNodeIds = [];
		return cur;
	}
	const next: TalentTreeState = { version: 1, learnedSpecNodeIds: [], learnedCoreSkillIds: [], learnedPassiveNodeIds: [] };
	(p as any).talentTreeState = next;
	return next;
}
