import { escapeHtml, installHoverTooltip } from '../utils.web.js';
import { getPartyMembers, getPartyMember, type PartyIndex } from '../party.web.js';
import { getCharacterClassId, getOrCreateTalentTreeState, getTalentTreeDefinition, getSpecNodeSkillId, type CharacterClass } from './talentTree.js';
import { createSkill, type SkillId } from '../skillLibrary.js';
import { getSkillIconSrc } from '../skillUi.web.js';
import { getTalentPassiveNodeDef, TALENT_PASSIVE_NODE_DEFS } from './talentPassives.js';
import { PASSIVE_DEFS, type PassiveId } from '../passives.js';

const GENERIC_NODE_ICON_SRC = './ImagesRPG/imagesobjets/journal_quete.png';

type TalentTreeOptions = {
	selectedIdx?: PartyIndex;
	onBack?: (idx: PartyIndex) => void;
};

type LayoutNode = {
	id: string;
	x: number;
	y: number;
	label: string;
	kind: 'core' | 'spec' | 'passive';
	iconSrc?: string;
	skillId?: SkillId;
	requiredLevel?: number;
	specId?: string;
	tier?: number;
	slot?: number;
};

type LayoutEdge = { from: string; to: string };

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

function getSkillPoints(p: any): number {
	return Math.max(0, Math.floor(Number(p?.skillPoints ?? 0)));
}

function setSkillPoints(p: any, v: number): void {
	p.skillPoints = Math.max(0, Math.floor(v));
}

function getLearnedSkillIds(p: any): string[] {
	return ((p?.learnedSkillIds ?? []) as string[]).filter(Boolean);
}

function hasLearnedSkillId(p: any, skillId: string, skillNameFallback?: string): boolean {
	const id = String(skillId ?? '').trim();
	if (id) {
		if (getLearnedSkillIds(p).includes(id)) return true;
		if ((p?.skills ?? []).some((s: any) => String(s?.skillId ?? '') === id)) return true;
	}
	const name = String(skillNameFallback ?? '').trim();
	if (!name) return false;
	return (p?.skills ?? []).some((s: any) => String(s?.name ?? '') === name);
}

function learnSkill(p: any, skillId: SkillId): { ok: true } | { ok: false; message: string } {
	let skill: any;
	try {
		skill = createSkill(skillId);
	} catch {
		return { ok: false, message: `Compétence introuvable: ${String(skillId)}` };
	}

	const already = hasLearnedSkillId(p, String(skillId), String(skill?.name ?? ''));
	if (already) return { ok: false, message: 'Déjà apprise.' };

	if (!Array.isArray(p.skills)) p.skills = [];
	p.skills = [...p.skills, skill];

	const ids = new Set(getLearnedSkillIds(p));
	ids.add(String(skillId));
	p.learnedSkillIds = Array.from(ids);

	return { ok: true };
}

function removeLearnedSkillsById(p: any, skillIds: string[]): void {
	const toRemove = new Set((skillIds ?? []).map((s) => String(s)).filter(Boolean));
	if (!toRemove.size) return;

	// Remove from learnedSkillIds
	const keepIds = getLearnedSkillIds(p).filter((id) => !toRemove.has(String(id)));
	p.learnedSkillIds = keepIds;

	// Remove from skills array (by skillId, fallback by name if skillId missing)
	const idsArray = Array.from(toRemove);
	const namesToRemove = new Set<string>();
	for (const id of idsArray) {
		try {
			const s: any = createSkill(id as SkillId);
			if (s?.name) namesToRemove.add(String(s.name));
		} catch {
			// ignore
		}
	}

	const curSkills = Array.isArray(p?.skills) ? (p.skills as any[]) : [];
	p.skills = curSkills.filter((s: any) => {
		const sid = String(s?.skillId ?? '');
		if (sid && toRemove.has(sid)) return false;
		const nm = String(s?.name ?? '');
		if (nm && namesToRemove.has(nm)) return false;
		return true;
	});
}

function buildUnlockLevelBySkillIdFromGame(p: any): Record<string, number> {
	const map: Record<string, number> = {};
	const gameSkillTree = ((window as any).game?.skillTree ?? []) as Array<{ skill?: any; unlockLevel?: number }>;
	for (const entry of gameSkillTree) {
		const skill = entry?.skill;
		const skillId = String((skill as any)?.skillId ?? '');
		const unlockLevel = Math.max(1, Math.floor(Number(entry?.unlockLevel ?? NaN)));
		if (!skillId || !Number.isFinite(unlockLevel)) continue;
		if (map[skillId] === undefined || unlockLevel < map[skillId]!) map[skillId] = unlockLevel;
	}

	// If the player already has the skill, treat it as level 1 unlock (fallback)
	const playerSkills = (p?.skills ?? []) as any[];
	for (const s of playerSkills) {
		const skillId = String((s as any)?.skillId ?? '');
		if (!skillId) continue;
		if (map[skillId] === undefined || 1 < map[skillId]!) map[skillId] = 1;
	}

	return map;
}

function buildLayout(classId: CharacterClass, w: number, h: number, unlockLevelBySkillId: Record<string, number>) {
	const def = getTalentTreeDefinition(classId);
	const cx = w * 0.5;
	const cy = h * 0.52;

	const nodes: LayoutNode[] = [];
	const edges: LayoutEdge[] = [];

	// Core: 3x3 grid around center (shrunk to be more compact)
	const BASE_GRID_DX = Math.min(106, w * 0.11);
	const BASE_GRID_DY = Math.min(96, h * 0.11);
	const CORE_SHRINK = 0.65; // 0.65 => ~35% tighter
	const gridDx = Math.max(36, Math.floor(BASE_GRID_DX * CORE_SHRINK));
	const gridDy = Math.max(32, Math.floor(BASE_GRID_DY * CORE_SHRINK));
	const startX = cx - gridDx;
	const startY = cy - gridDy;
	for (let i = 0; i < def.coreNodes.length; i++) {
		const gx = i % 3;
		const gy = Math.floor(i / 3);
		const n = def.coreNodes[i];
		if (!n) continue;

		let label = n.name;
		let iconSrc: string | undefined;
		let requiredLevel: number | undefined;
		let skillId: SkillId | undefined;
		if (n.skillId) {
			skillId = n.skillId;
			try {
				const s = createSkill(n.skillId);
				label = s.name;
				iconSrc = getSkillIconSrc(s);
			} catch {
				iconSrc = GENERIC_NODE_ICON_SRC;
			}
			requiredLevel = unlockLevelBySkillId[String(n.skillId)] ?? n.requiredLevel;
		} else {
			requiredLevel = n.requiredLevel;
		}

		const ln: LayoutNode = {
			id: n.id,
			x: startX + gx * gridDx,
			y: startY + gy * gridDy,
			label,
			kind: 'core',
		};
		if (iconSrc) ln.iconSrc = iconSrc;
		if (skillId) ln.skillId = skillId;
		if (typeof requiredLevel === 'number') ln.requiredLevel = requiredLevel;
		nodes.push(ln);
	}

	// Core passives: 8 nodes forming a ring around the 3x3 core grid (4 corners + 4 midpoints)
	const coreCellSize = Math.max(gridDx, gridDy);
	const passiveRingRadius = coreCellSize * 1.8;
	const corePassivePositions = [
		{ x: cx - passiveRingRadius * 1.2, y: cy - passiveRingRadius, label: 'Passif central (coin haut-gauche)' },
		{ x: cx, y: cy - passiveRingRadius, label: 'Passif central (milieu haut)' },
		{ x: cx + passiveRingRadius * 1.2, y: cy - passiveRingRadius, label: 'Passif central (coin haut-droit)' },
		{ x: cx + passiveRingRadius * 1.2, y: cy, label: 'Passif central (milieu droit)' },
		{ x: cx + passiveRingRadius * 1.2, y: cy + passiveRingRadius, label: 'Passif central (coin bas-droit)' },
		{ x: cx, y: cy + passiveRingRadius, label: 'Passif central (milieu bas)' },
		{ x: cx - passiveRingRadius * 1.2, y: cy + passiveRingRadius, label: 'Passif central (coin bas-gauche)' },
		{ x: cx - passiveRingRadius * 1.2, y: cy, label: 'Passif central (milieu gauche)' },
	];

	for (let i = 0; i < corePassivePositions.length; i++) {
		const pos = corePassivePositions[i]!;
		const id = `passive.${classId}.core.p${i}`;
		nodes.push({ id, x: pos.x, y: pos.y, label: pos.label, kind: 'passive' });
	}

	// Specs: 4 branches, tiers radiating
	const directions: Array<{ dx: number; dy: number; ox: number; oy: number }> = [
		{ dx: 0, dy: -1, ox: 1, oy: 0 },
		{ dx: 1, dy: 0, ox: 0, oy: 1 },
		{ dx: 0, dy: 1, ox: 1, oy: 0 },
		{ dx: -1, dy: 0, ox: 0, oy: 1 },
	];

	// Push branches away from core so they don't overlap.
	// Important: scale PER direction (top/bottom vs left/right) so LR doesn't pull UD toward the center.
	const margin = 44;
	const coreRadius = Math.max(gridDx, gridDy) * 1.9;

	// Base spacing (can tweak safely)
	const baseRadius0 = coreRadius + Math.min(w, h) * 0.22;
	const baseStepR = Math.min(w, h) * 0.22;
	const baseLateral = Math.min(w, h) * 0.12; // réduit pour rapprocher les compétences d'un même étage

	// Requested: left & right tier1 is 2x farther than current
	const lrMultiplier = 2;
	// Keep up/down slightly further from center
	const udMultiplier = 1.6;

	const getMaxAlongDir = (dx: number, dy: number): number => {
		if (dy < 0) return Math.max(20, cy - margin);
		if (dy > 0) return Math.max(20, h - cy - margin);
		if (dx > 0) return Math.max(20, w - cx - margin);
		return Math.max(20, cx - margin);
	};

	const fitDir = (dx: number, dy: number, radius0: number, stepR: number, tierCount: number) => {
		const maxR = getMaxAlongDir(dx, dy);
		const needed = radius0 + Math.max(0, tierCount - 1) * stepR;
		if (needed <= maxR) return { radius0, stepR };
		const scale = maxR / needed;
		return { radius0: radius0 * scale, stepR: stepR * scale };
	};

	for (const spec of def.specs) {
		const d = directions[spec.direction];
		if (!d) continue;
		const isLeftRight = spec.direction === 1 || spec.direction === 3;
		const dirMultiplier = isLeftRight ? lrMultiplier : udMultiplier;
		const fitted = fitDir(d.dx, d.dy, baseRadius0 * dirMultiplier, baseStepR, spec.tierCount);
		const lateral = baseLateral;
		for (let tier = 1; tier <= spec.tierCount; tier++) {
			const r = fitted.radius0 + (tier - 1) * fitted.stepR;

			// Skill nodes (existing): 3 per tier
			for (let slot = 0; slot < 3; slot++) {
				const offsetIndex = slot - 1; // -1,0,1
				const x = cx + d.dx * r + d.ox * offsetIndex * lateral;
				const y = cy + d.dy * r + d.oy * offsetIndex * lateral;
				const id = def.getSpecNodeId(spec.id, tier, slot);
			const specSkillId = getSpecNodeSkillId(classId, spec.id, tier, slot);
			const nodeObj: LayoutNode = { id, x, y, label: '', kind: 'spec', specId: spec.id, tier, slot };
			if (specSkillId) nodeObj.skillId = specSkillId;
			nodes.push(nodeObj);
			}

			// Passive nodes: 4 per tier
			// Placement rule: 2 between the 3 skills (midpoints) + 1 on each side of the extremes.
			// Offsets are equidistant: [-1.5, -0.5, 0.5, 1.5] relative to the center slot.
			const passiveOffsets = [-1.5, -0.5, 0.5, 1.5];
			for (let i = 0; i < passiveOffsets.length; i++) {
				const offsetIndex = passiveOffsets[i]!;
				const x = cx + d.dx * r + d.ox * offsetIndex * lateral;
				const y = cy + d.dy * r + d.oy * offsetIndex * lateral;
				const id = `passive.${classId}.${spec.id}.t${tier}.p${i}`;
				nodes.push({ id, x, y, label: '', kind: 'passive', specId: spec.id, tier, slot: i });
			}

			// Edges: tier chaining per slot (visual). Also link center -> first tier.
			if (tier === 1) {
				const centerId = def.coreNodes[4]?.id ?? def.coreNodes[0]?.id ?? 'core-center';
				for (let slot = 0; slot < 3; slot++) {
					edges.push({ from: centerId, to: def.getSpecNodeId(spec.id, 1, slot) });
				}
			} else {
				for (let slot = 0; slot < 3; slot++) {
					edges.push({ from: def.getSpecNodeId(spec.id, tier - 1, slot), to: def.getSpecNodeId(spec.id, tier, slot) });
				}
			}
		}
	}

	// Clamp nodes to bounds margins (avoid out of container)
	for (const n of nodes) {
		n.x = clamp(n.x, margin, w - margin);
		n.y = clamp(n.y, margin, h - margin);
	}

	return { def, nodes, edges };
}

function canUseSpecTree(p: any, specUnlockLevel: number): boolean {
	return Math.floor(Number(p?.level ?? 0)) >= specUnlockLevel;
}

const REQUIRED_POINTS_IN_TIER_TO_UNLOCK_NEXT = 3;

function getTierSpentCount(
	state: { learnedSpecNodeIds: string[]; learnedPassiveNodeIds?: string[] },
	classId: CharacterClass,
	specId: string,
	tier: number,
): number {
	const specPrefix = `spec.${classId}.${specId}.t${tier}.s`;
	const passivePrefix = `passive.${classId}.${specId}.t${tier}.p`;
	const specSpent = (state.learnedSpecNodeIds ?? []).filter((id) => String(id).startsWith(specPrefix)).length;
	const passiveSpent = ((state as any).learnedPassiveNodeIds ?? []).filter((id: any) => String(id).startsWith(passivePrefix)).length;
	// For now each node costs 1 point; if costs diverge later, replace this with a cost lookup.
	return specSpent + passiveSpent;
}

function isSpecNodeLearned(state: { learnedSpecNodeIds: string[] }, id: string): boolean {
	return (state.learnedSpecNodeIds ?? []).includes(id);
}

function isPassiveNodeLearned(state: { learnedPassiveNodeIds?: string[] }, id: string): boolean {
	return ((state as any).learnedPassiveNodeIds ?? []).includes(id);
}

function getLearnedPassiveNodeIds(state: any): string[] {
	return Array.isArray(state?.learnedPassiveNodeIds) ? (state.learnedPassiveNodeIds as string[]) : [];
}

function canLearnPassiveNode(state: any, id: string): { ok: true } | { ok: false; message: string } {
	const def = getTalentPassiveNodeDef(id);
	// If it grants a real passive, don't allow duplicates.
	const grants = String(def?.grantsPassiveId ?? '').trim();
	if (grants) {
		const cur = Array.isArray((state as any)?.__owner?.passiveSkills) ? ((state as any).__owner.passiveSkills as any[]) : null;
		// Fallback: the owner is passed explicitly in the click handler; here we only keep legacy checks.
		if (Array.isArray(cur) && cur.includes(grants)) return { ok: false, message: 'Déjà appris.' };
	}
	if (!def?.exclusiveGroup) return { ok: true };
	const learned = getLearnedPassiveNodeIds(state);
	const conflict = learned.find((pid) => TALENT_PASSIVE_NODE_DEFS[String(pid)]?.exclusiveGroup === def.exclusiveGroup);
	if (conflict) return { ok: false, message: 'Passif incompatible avec un autre déjà appris.' };
	return { ok: true };
}

function canLearnPassiveNodeForPlayer(p: any, state: any, id: string): { ok: true } | { ok: false; message: string } {
	const def = getTalentPassiveNodeDef(id);
	const grants = String(def?.grantsPassiveId ?? '').trim();
	if (grants) {
		// Already learned somewhere else.
		if (typeof p?.hasPassive === 'function' && p.hasPassive(grants as any)) return { ok: false, message: 'Déjà appris.' };
		const passiveDef = PASSIVE_DEFS[grants as PassiveId];
		const group = String(passiveDef?.exclusiveGroup ?? '').trim();
		if (group) {
			const learnedPassives = Array.isArray(p?.passiveSkills) ? (p.passiveSkills as PassiveId[]) : [];
			const conflict = learnedPassives.find((pid) => PASSIVE_DEFS[pid]?.exclusiveGroup === group);
			if (conflict) return { ok: false, message: 'Passif incompatible avec un autre déjà appris.' };
		}
	}
	return canLearnPassiveNode(state, id);
}

function applyGrantedPassiveFromTalentNode(p: any, nodeId: string): { ok: true } | { ok: false; message: string } {
	const def = getTalentPassiveNodeDef(nodeId);
	const grants = String(def?.grantsPassiveId ?? '').trim();
	if (!grants) return { ok: true };
	if (typeof p?.hasPassive === 'function' && p.hasPassive(grants as any)) return { ok: false, message: 'Déjà appris.' };
	if (!Array.isArray(p.passiveSkills)) p.passiveSkills = [];
	p.passiveSkills = [...new Set([...(p.passiveSkills as any[]), grants])];
	return { ok: true };
}

function removeGrantedPassivesForTalentNodes(p: any, nodeIds: string[]): void {
	if (!Array.isArray(nodeIds) || !nodeIds.length) return;
	const grants = nodeIds
		.map((id) => String(getTalentPassiveNodeDef(id)?.grantsPassiveId ?? '').trim())
		.filter(Boolean);
	if (!grants.length) return;
	if (!Array.isArray(p?.passiveSkills)) return;
	const toRemove = new Set(grants);
	p.passiveSkills = (p.passiveSkills as any[]).filter((pid) => !toRemove.has(String(pid)));
}

function isTierUnlocked(
	p: any,
	state: { learnedSpecNodeIds: string[]; learnedPassiveNodeIds?: string[] },
	classId: CharacterClass,
	specId: string,
	tier: number,
	specUnlockLevel: number,
): boolean {
	if (!canUseSpecTree(p, specUnlockLevel)) return false;
	if (tier <= 1) return true;
	// spending at least N points in previous tier unlocks this tier (skills + passives count)
	return getTierSpentCount(state as any, classId, specId, tier - 1) >= REQUIRED_POINTS_IN_TIER_TO_UNLOCK_NEXT;
}

export function showTalentTree(options: TalentTreeOptions = {}): void {
	const app = document.getElementById('app');
	if (!app) return;

	let selectedIdx: PartyIndex = (options.selectedIdx ?? 0) as PartyIndex;

	const render = () => {
		const party = getPartyMembers();
		selectedIdx = Math.max(0, Math.min(party.length - 1, Math.floor(Number(selectedIdx) || 0))) as PartyIndex;
		const p = getPartyMember(selectedIdx);
		const classId = getCharacterClassId(p);
		const def = getTalentTreeDefinition(classId);
		const state = getOrCreateTalentTreeState(p);
		const unlockLevelBySkillId = buildUnlockLevelBySkillIdFromGame(p);

		app.innerHTML = `
				<img src="ImagesRPG/imagesobjets/grimoire_skilltree.png" class="background background-competences" alt="Talents" style="transform: scale(1.037); transform-origin: center;">
			<div class="centered-content" style="max-width:min(1500px,98vw);">
				<style>
					.talent-wrap{ --boardSize:min(94vh, 62vw, 960px); }
					.talent-layout{ display:grid; grid-template-columns:minmax(240px,320px) var(--boardSize) minmax(240px,320px); gap:12px; align-items:start; justify-content:center; }
					.talent-panel{ background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:12px 14px; }
					.talent-actions{ display:flex; gap:10px; align-items:center; justify-content:flex-end; flex-wrap:wrap; }
					@media (max-width: 980px){
						.talent-layout{ grid-template-columns:1fr; }
						.talent-panel{ max-width: var(--boardSize); margin: 0 auto; }
						.talent-actions{ justify-content:center; }
					}
				</style>

				<div class="talent-wrap">
					<div class="talent-layout">
						<div class="talent-panel">
							<h1 style="margin:0 0 8px 0;">Arbre de talents — ${escapeHtml(def.className)}</h1>
							<div style="color:#ddd;">Niveau: <b>${Math.floor(Number(p.level ?? 0))}</b></div>
							<div style="color:#ddd; margin-top:4px;">Points: <b id="talentSkillPointsVal">${getSkillPoints(p)}</b></div>
						</div>

						<div id="talentTreeWrap" style="position:relative;width:calc(var(--boardSize) * 1.09);height:var(--boardSize);border:1px solid rgba(255,255,255,0.12);border-radius:14px;background:rgba(0,0,0,0.25);overflow:hidden;">
							<svg id="talentTreeSvg" width="100%" height="100%" style="position:absolute;inset:0;pointer-events:none;"></svg>
							<div id="talentTreeNodes" style="position:absolute;inset:0;"></div>
						</div>

						<div class="talent-panel">
							<div style="color:#ddd; margin-bottom:10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
								<label>Perso:</label>
								<select id="talentMemberSelect">
									${party.map((m, idx) => `<option value="${idx}" ${idx === selectedIdx ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
								</select>
							</div>
							<div class="talent-actions">
								<button class="btn" id="talentResetBtn">Réinitialiser</button>
								<button class="btn" id="talentBackBtn">Retour</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;

		const wrap = document.getElementById('talentTreeWrap') as HTMLElement | null;
		const svg = document.getElementById('talentTreeSvg') as SVGSVGElement | null;
		const nodesHost = document.getElementById('talentTreeNodes') as HTMLElement | null;
		if (!wrap || !svg || !nodesHost) return;

		const rect = wrap.getBoundingClientRect();
		const layout = buildLayout(classId, rect.width, rect.height, unlockLevelBySkillId);

		// SVG edges
		svg.innerHTML = layout.edges
			.map((e) => {
				const a = layout.nodes.find((n) => n.id === e.from);
				const b = layout.nodes.find((n) => n.id === e.to);
				if (!a || !b) return '';
				return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(255,255,255,0.14)" stroke-width="2" />`;
			})
			.join('');

		const specNames = new Map(def.specs.map((s) => [s.id, s.name] as const));
		const playerLevel = Math.floor(Number(p.level ?? 0));
		const havePts = getSkillPoints(p) >= 1;

		const PASSIVE_ICON_SRC = 'ImagesRPG/imagesobjets/passif3.png';
		const SKILL_ICON_SIZE = 44;
		const PASSIVE_ICON_SIZE = Math.max(12, Math.floor(SKILL_ICON_SIZE * 0.5));

		const nodeHtml = layout.nodes
			.map((n) => {
				if (n.kind === 'core') {
					const requiredLevel = Math.max(1, Math.floor(Number(n.requiredLevel ?? 1)));
					const unlocked = playerLevel >= requiredLevel;
					const skillId = String(n.skillId ?? '').trim();
					const learned = skillId ? hasLearnedSkillId(p, skillId, n.label) : hasLearnedSkillId(p, '', n.label);
					const canLearn = Boolean(skillId) && unlocked && !learned && havePts;
					const disabled = !canLearn;

					const label = escapeHtml(n.label);
					const iconSrc = escapeHtml(n.iconSrc ?? GENERIC_NODE_ICON_SRC);
					const imgFilter = learned
						? 'filter:drop-shadow(0 2px 6px rgba(0,0,0,0.35));'
						: canLearn
							? 'filter:grayscale(1) brightness(0.70) contrast(0.95) drop-shadow(0 0 10px rgba(255,215,0,0.90)) drop-shadow(0 0 18px rgba(255,215,0,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.35));'
							: 'filter:grayscale(1) brightness(0.55) contrast(0.95) drop-shadow(0 2px 6px rgba(0,0,0,0.35));';
					const statusText = learned
						? 'Apprise'
						: unlocked
							? (havePts ? 'Débloquée (cliquer pour apprendre)' : 'Débloquée (pas assez de points)')
							: `Verrouillée (niveau ${requiredLevel} requis)`;

					let tooltip = `${decodeURIComponent(encodeURIComponent(n.label))}\n${statusText}`;
					if (!learned) tooltip += `\nCoût: 1 point`;
					tooltip += `\nNiveau requis: ${requiredLevel}`;
					if (skillId) {
						try {
							const s: any = createSkill(skillId as SkillId);
							const desc = String(s?.description ?? '');
							if (desc) tooltip += `\n\n${desc}`;
						} catch {
							// ignore
						}
					}
					const encodedTooltip = escapeHtml(encodeURIComponent(tooltip));
					// No .btn styling: hitbox must be exactly the icon square.
					const btnStyle = `all:unset;display:block;width:${SKILL_ICON_SIZE}px;height:${SKILL_ICON_SIZE}px;cursor:${disabled ? 'not-allowed' : 'pointer'};pointer-events:auto;`;
				return `
					<div style="position:absolute;left:${n.x}px;top:${n.y}px;transform:translate(-50%,-50%);">
						<button type="button" ${disabled ? 'disabled' : ''} data-core-skill-id="${escapeHtml(skillId)}" data-skill-desc="${encodedTooltip}"
							style="${btnStyle}">
								<img src="${iconSrc}" alt="${label}" style="width:${SKILL_ICON_SIZE}px;height:${SKILL_ICON_SIZE}px;object-fit:contain;${imgFilter}" />
							</button>
						</div>
					`;
				}

				if (n.kind === 'passive') {
					const specId = String(n.specId ?? '');
					const tier = Math.max(1, Math.floor(Number(n.tier ?? 1)));
					const slot = Math.max(0, Math.floor(Number(n.slot ?? 0)));
				const isCorePassive = n.id.includes('.core.p');
				const unlockedTier = isCorePassive || isTierUnlocked(p, state, classId, specId, tier, def.specUnlockLevel);
				const learned = isPassiveNodeLearned(state, n.id);
				const canLearn = unlockedTier && !learned && havePts;
				const disabled = !canLearn;

				const passiveDef = getTalentPassiveNodeDef(n.id);

				const specName = escapeHtml(specNames.get(specId) ?? (isCorePassive ? 'Central' : 'Spé'));
				const title = isCorePassive 
					? (learned ? 'Déjà appris' : havePts ? 'Cliquer pour apprendre (1 point)' : 'Pas assez de points')
					: (canUseSpecTree(p, def.specUnlockLevel)
						? unlockedTier
							? (learned ? 'Déjà appris' : havePts ? 'Cliquer pour apprendre (1 point)' : 'Pas assez de points')
							: `Étage verrouillé (dépenser ${REQUIRED_POINTS_IN_TIER_TO_UNLOCK_NEXT} points dans l'étage précédent)`
						: `Spécialisations verrouillées (niv ${def.specUnlockLevel})`);

					const iconSrc = escapeHtml(PASSIVE_ICON_SRC);
					const imgFilter = learned
						? 'filter:drop-shadow(0 2px 6px rgba(0,0,0,0.35));'
						: canLearn
							? 'filter:grayscale(1) brightness(0.70) contrast(0.95) drop-shadow(0 0 10px rgba(255,215,0,0.90)) drop-shadow(0 0 18px rgba(255,215,0,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.35));'
							: 'filter:grayscale(1) brightness(0.55) contrast(0.95) drop-shadow(0 2px 6px rgba(0,0,0,0.35));';

					const label = passiveDef?.name
						? passiveDef.name
						: isCorePassive
							? `Passif central ${n.label || ''}`
							: `Passif ${specName} : étage ${tier}`;
					let tooltipText = `${label}\n${title}\nCoût: 1 point`;
					if (passiveDef?.description) tooltipText += `\n\n${passiveDef.description}`;
					const tooltip = encodeURIComponent(tooltipText);
					const btnStyle = `all:unset;display:block;width:${PASSIVE_ICON_SIZE}px;height:${PASSIVE_ICON_SIZE}px;cursor:${disabled ? 'not-allowed' : 'pointer'};pointer-events:auto;`;
					return `
						<div style="position:absolute;left:${n.x}px;top:${n.y}px;transform:translate(-50%,-50%);">
							<button type="button" data-passive-id="${escapeHtml(n.id)}" ${disabled ? 'disabled' : ''} data-skill-desc="${escapeHtml(tooltip)}"
								style="${btnStyle}">
								<img src="${iconSrc}" alt="${escapeHtml(label)}" style="width:${PASSIVE_ICON_SIZE}px;height:${PASSIVE_ICON_SIZE}px;object-fit:contain;${imgFilter}" />
							</button>
						</div>
					`;
				}

				// spec placeholder nodes
				const specId = String(n.specId ?? '');
				const tier = Math.max(1, Math.floor(Number(n.tier ?? 1)));
				const slot = Math.max(0, Math.floor(Number(n.slot ?? 0)));
				const unlockedTier = isTierUnlocked(p, state, classId, specId, tier, def.specUnlockLevel);
				const skillId = String(n.skillId ?? '').trim();
			let learned = isSpecNodeLearned(state, n.id);
			let label = `Spécialisation ${escapeHtml(specNames.get(specId) ?? 'Spé')} : étage ${tier}`;
			let iconSrc = escapeHtml(GENERIC_NODE_ICON_SRC);
			if (skillId) {
				try {
					const s: any = createSkill(skillId as SkillId);
					if (s?.name) label = s.name;
					iconSrc = getSkillIconSrc(s);
				} catch {
					// ignore if skill not found
				}
				// if the player already has the skill, treat the node as learned
				if (hasLearnedSkillId(p, skillId, n.label)) learned = true;
			}
				const canLearn = unlockedTier && !learned && havePts;
				const disabled = !canLearn;

				const specName = escapeHtml(specNames.get(specId) ?? 'Spé');
				const title = canUseSpecTree(p, def.specUnlockLevel)
					? unlockedTier
						? (learned ? 'Déjà appris' : havePts ? 'Cliquer pour apprendre (1 point)' : 'Pas assez de points')
						: `Étage verrouillé (dépenser ${REQUIRED_POINTS_IN_TIER_TO_UNLOCK_NEXT} points dans l'étage précédent)`
					: `Spécialisations verrouillées (niv ${def.specUnlockLevel})`;

			let tooltip = `${label}\n${title}\nCoût: 1 point`;
			if (skillId) {
				try {
					const s: any = createSkill(skillId as SkillId);
					const desc = String(s?.description ?? '');
					if (desc) tooltip += `\n\n${desc}`;
				} catch {
					// ignore
				}
			}
			const encodedTooltip = encodeURIComponent(tooltip);

			const imgFilter = learned
				? 'filter:drop-shadow(0 2px 6px rgba(0,0,0,0.35));'
				: canLearn
					? 'filter:grayscale(1) brightness(0.70) contrast(0.95) drop-shadow(0 0 10px rgba(255,215,0,0.90)) drop-shadow(0 0 18px rgba(255,215,0,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.35));'
					: 'filter:grayscale(1) brightness(0.55) contrast(0.95) drop-shadow(0 2px 6px rgba(0,0,0,0.35));';

			// spec icon size increased 10% (hitbox == icon size)
			const btnStyle = `all:unset;display:block;width:${SKILL_ICON_SIZE}px;height:${SKILL_ICON_SIZE}px;cursor:${disabled ? 'not-allowed' : 'pointer'};pointer-events:auto;`;
			return `
				<div style="position:absolute;left:${n.x}px;top:${n.y}px;transform:translate(-50%,-50%);">
					<button type="button" data-talent-id="${escapeHtml(n.id)}" ${disabled ? 'disabled' : ''} data-spec-skill-id="${escapeHtml(skillId)}" data-skill-desc="${escapeHtml(encodedTooltip)}"
						style="${btnStyle}">
						<img src="${iconSrc}" alt="${escapeHtml(label)}" style="width:${SKILL_ICON_SIZE}px;height:${SKILL_ICON_SIZE}px;object-fit:contain;${imgFilter}" />
						</button>
					</div>
				`;
			})
			.join('');

		nodesHost.innerHTML = nodeHtml;
		installHoverTooltip(nodesHost, { selector: '[data-skill-desc]' });

		(document.getElementById('talentMemberSelect') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
			selectedIdx = Number((e.target as HTMLSelectElement).value) as PartyIndex;
			render();
		});

		document.getElementById('talentBackBtn')?.addEventListener('click', () => {
			options.onBack?.(selectedIdx);
		});

		document.getElementById('talentResetBtn')?.addEventListener('click', () => {
			const ok = window.confirm('Réinitialiser l\'arbre de talents ? Les points dépensés seront remboursés.');
			if (!ok) return;
			const refund = (state.learnedSpecNodeIds ?? []).length
				+ ((state as any).learnedCoreSkillIds ?? []).length
				+ (((state as any).learnedPassiveNodeIds ?? []) as string[]).length;
			state.learnedSpecNodeIds = [];
			const learnedPassiveNodes = (((state as any).learnedPassiveNodeIds ?? []) as string[]).slice();
			removeGrantedPassivesForTalentNodes(p, learnedPassiveNodes);
			(state as any).learnedPassiveNodeIds = [];
			const coreIds = Array.isArray((state as any).learnedCoreSkillIds) ? ((state as any).learnedCoreSkillIds as string[]) : [];
			removeLearnedSkillsById(p, coreIds);
			(state as any).learnedCoreSkillIds = [];
			setSkillPoints(p, getSkillPoints(p) + refund);
			render();
		});

		(nodesHost.querySelectorAll('[data-talent-id]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
			btn.addEventListener('click', () => {
				const id = String(btn.getAttribute('data-talent-id') ?? '');
				if (!id) return;
				if (isSpecNodeLearned(state, id)) return;
				if (getSkillPoints(p) < 1) return;

				// Learn
				state.learnedSpecNodeIds = [...(state.learnedSpecNodeIds ?? []), id];

				// If this spec node grants a real skill, teach it and record it on the talent state so it can be removed on reset
				const skillId = String(btn.getAttribute('data-spec-skill-id') ?? '').trim();
				if (skillId) {
					const res = learnSkill(p, skillId as SkillId);
					if (res.ok) {
						(state as any).learnedCoreSkillIds = Array.isArray((state as any).learnedCoreSkillIds) ? [...(state as any).learnedCoreSkillIds, skillId] : [skillId];
					}
				}

				setSkillPoints(p, getSkillPoints(p) - 1);
				render();
			});
		});

		(nodesHost.querySelectorAll('[data-passive-id]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
			btn.addEventListener('click', () => {
				const id = String(btn.getAttribute('data-passive-id') ?? '');
				if (!id) return;
				if (isPassiveNodeLearned(state as any, id)) return;
				if (getSkillPoints(p) < 1) return;
				const can = canLearnPassiveNodeForPlayer(p, state as any, id);
				if (!can.ok) {
					window.alert(can.message);
					return;
				}
				const applied = applyGrantedPassiveFromTalentNode(p, id);
				if (!applied.ok) {
					window.alert(applied.message);
					return;
				}

				(state as any).learnedPassiveNodeIds = Array.isArray((state as any).learnedPassiveNodeIds)
					? [...(state as any).learnedPassiveNodeIds, id]
					: [id];
				setSkillPoints(p, getSkillPoints(p) - 1);
				render();
			});
		});

		(nodesHost.querySelectorAll('[data-core-skill-id]') as NodeListOf<HTMLButtonElement>).forEach((btn) => {
			btn.addEventListener('click', () => {
				const skillId = String(btn.getAttribute('data-core-skill-id') ?? '').trim();
				if (!skillId) return;
				if (getSkillPoints(p) < 1) return;

				const res = learnSkill(p, skillId as SkillId);
				if (!res.ok) return;
				(state as any).learnedCoreSkillIds = Array.isArray((state as any).learnedCoreSkillIds)
					? [...new Set([...(state as any).learnedCoreSkillIds, skillId])]
					: [skillId];
				setSkillPoints(p, getSkillPoints(p) - 1);
				render();
			});
		});
	};

	render();
}
