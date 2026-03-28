import type { Player } from './player.js';
import { Campfire } from './item.js';
import { showTemporaryMessage } from './uiNotifications.js';
import type { QuestDef, QuestEvent, QuestId, QuestProgress, QuestRewards } from './quests.js';

function clampInt(n: unknown, min = 0): number {
    const v = Math.floor(Number(n ?? 0) || 0);
    return Math.max(min, v);
}

function createInitialProgress(def: QuestDef): QuestProgress {
    const firstStep = def.steps[0];
    const objectives: Record<string, number> = {};

    if (!firstStep) {
        // Defensive: a quest with no steps is immediately claimable.
        return { status: 'claimed', stepIndex: 0, objectives: {} };
    }

    for (const obj of firstStep.objectives) objectives[obj.id] = 0;
    return { status: 'active', stepIndex: 0, objectives };
}

function stepObjectivesAreComplete(def: QuestDef, progress: QuestProgress): boolean {
    const step = def.steps[progress.stepIndex];
    if (!step) return true;
    for (const obj of step.objectives) {
        const cur = clampInt(progress.objectives[obj.id], 0);
        if (obj.type === 'flag') {
            if (cur < 1) return false;
        } else {
            const target = clampInt(obj.target, 1);
            if (cur < target) return false;
        }
    }
    return true;
}

function initNextStepObjectives(def: QuestDef, progress: QuestProgress): void {
    const step = def.steps[progress.stepIndex];
    progress.objectives = {};
    if (!step) return;
    for (const obj of step.objectives) progress.objectives[obj.id] = 0;
}


function applyRewards(hero: Player, rewards: QuestRewards, log: (msg: string) => void): string | null {
    const xp = clampInt(rewards.xp, 0);
    const gold = clampInt(rewards.gold, 0);
    const wood = clampInt(rewards.wood, 0);
    const herb = clampInt(rewards.herb, 0);
    const skillPoints = clampInt(rewards.skillPoints, 0);

    if (xp > 0) hero.gainXP(xp);
    if (gold > 0) hero.gold = clampInt((hero.gold ?? 0) + gold, 0);
    if (wood > 0) (hero as any).wood = clampInt(((hero as any).wood ?? 0) + wood, 0);
    if (herb > 0) (hero as any).herb = clampInt(((hero as any).herb ?? 0) + herb, 0);
    if (skillPoints > 0) hero.skillPoints = clampInt((hero.skillPoints ?? 0) + skillPoints, 0);

    const parts: string[] = [];
    if (xp) parts.push(`+${xp} XP`);
    if (gold) parts.push(`+${gold} or`);
    if (wood) parts.push(`+${wood} bois`);
    if (herb) parts.push(`+${herb} herbe(s)`);
    if (skillPoints) parts.push(`+${skillPoints} point(s) de compétence`);

    // Campfire reward: create Campfire item(s) and add to the hero's inventory
    const campfireCount = clampInt((rewards as any).campfire ?? 0, 0);
    if (campfireCount > 0) {
        for (let i = 0; i < campfireCount; i++) {
            hero.addItem(new Campfire());
        }
        parts.push(`+${campfireCount} feu(s) de camp`);
    }

    if (parts.length) log(`Récompenses de quête: ${parts.join(', ')}.`);

    return parts.length ? parts.join(', ') : null;
}

export class QuestManager {
    private readonly hero: Player;
    private readonly defs: Record<string, QuestDef>;

    constructor(hero: Player, defs: Record<string, QuestDef>) {
        this.hero = hero;
        this.defs = defs;

        // Ensure storage exists on hero
        if (!(this.hero as any).quests || typeof (this.hero as any).quests !== 'object') {
            (this.hero as any).quests = {};
        }

        // Auto-start quests if needed
        for (const def of Object.values(this.defs)) {
            if (!def.autoStart) continue;
            const existing = this.getProgress(def.id);
            if (!existing) this.start(def.id);
        }
    }

    getProgress(id: QuestId): QuestProgress | null {
        const all = (this.hero as any).quests as Record<string, QuestProgress>;
        const q = all?.[String(id)];
        if (!q) return null;
        if (q.status !== 'active' && q.status !== 'completed' && q.status !== 'claimed') return null;
        return q;
    }

    getAll(): Array<{ def: QuestDef; progress: QuestProgress | null }> {
        return Object.values(this.defs).map((def) => ({ def, progress: this.getProgress(def.id) }));
    }

    start(id: QuestId): { ok: true } | { ok: false; error: string } {
        const def = this.defs[String(id)];
        if (!def) return { ok: false, error: `Quête inconnue: ${String(id)}` };

        // Prerequisite gating (must be claimed)
        const prereq = (def as any).prerequisiteClaimedQuestId as QuestId | undefined;
        if (prereq) {
            const p = this.getProgress(prereq);
            if (!p || p.status !== 'claimed') {
                return { ok: false, error: `Quête verrouillée. Termine et valide d'abord: ${String(prereq)}` };
            }
        }

        const all = (this.hero as any).quests as Record<string, QuestProgress>;
        if (all[String(id)]) return { ok: true };
        all[String(id)] = createInitialProgress(def);
        // UI notice: quest begun
        try {
            showTemporaryMessage(`Nouvelle quête: ${def.name}`, 4000);
        } catch (e) {
            // noop
        }
        return { ok: true };
    }

    /**
     * Claim a completed quest to receive rewards and mark it as claimed.
     */
    claim(id: QuestId): { ok: true } | { ok: false; error: string } {
        const def = this.defs[String(id)];
        if (!def) return { ok: false, error: `Quête inconnue: ${String(id)}` };

        const all = (this.hero as any).quests as Record<string, QuestProgress>;
        const progress = all?.[String(id)];
        if (!progress) return { ok: false, error: `Quête non démarrée: ${String(id)}` };
        if (progress.status === 'claimed') return { ok: true };
        if (progress.status !== 'completed') return { ok: false, error: `Quête non terminée: ${def.name}` };

        let rewardText: string | null = null;
        if (def.rewards) {
            rewardText = applyRewards(this.hero, def.rewards, (m) => this.log(m));
        }
        progress.status = 'claimed';

        try {
            const msg = rewardText ? `Quête validée : ${def.name} — ${rewardText}` : `Quête validée : ${def.name}`;
            showTemporaryMessage(msg, 4000);
        } catch {
            // noop
        }

        // Dispatch a DOM event so other systems (ex: aubergiste) can react
        try {
            const ev = new CustomEvent('quest:claimed', { detail: { id: def.id, name: def.name } });
            document.dispatchEvent(ev);
        } catch {
            // noop
        }

        // Déblocage conditionnel : si l'auberge_demarrage est validée, débloquer manuellement les quêtes liées
        try {
            if (String(def.id) === 'auberge_demarrage') {
                const b = this.defs['bring_wood_festival'];
                const k = this.defs['kill_gobelin_lvl5'];
                if (b) {
                    (b as any).manualStartAllowed = true;
                    (b as any).__newlyUnlocked = true;
                }
                if (k) {
                    (k as any).manualStartAllowed = true;
                    (k as any).__newlyUnlocked = true;
                }
                try {
                    showTemporaryMessage("L'aubergiste propose de nouvelles quêtes (disponibles dans le panneau Quêtes).", 4000);
                } catch {
                    // noop
                }
                try {
                    const ev = new CustomEvent('quest:unlocked', { detail: { ids: ['bring_wood_festival', 'kill_gobelin_lvl5'] } });
                    document.dispatchEvent(ev);
                } catch {
                    // noop
                }
            }

                    // Si la quête 'bring_wood_festival' est validée, débloquer la quête de création de feu de camp
                    if (String(def.id) === 'bring_wood_festival') {
                        try {
                            const b = this.defs['build_campfire'];
                            if (b) {
                                (b as any).manualStartAllowed = true;
                                (b as any).__newlyUnlocked = true;
                            }
                            try {
                                showTemporaryMessage("Nouvelle quête disponible : Création feu de camp (panneau Quêtes).", 4000);
                            } catch {
                                // noop
                            }
                            try {
                                const ev = new CustomEvent('quest:unlocked', { detail: { ids: ['build_campfire'] } });
                                document.dispatchEvent(ev);
                            } catch {
                                // noop
                            }
                        } catch {
                            // noop
                        }
                    }
                } catch {
                    // noop
                }

                return { ok: true };
            }

            private log(msg: string) {
                // Central place for quest notifications; can be wired to UI later.
                console.log('[Quest]', msg);
            }

            // Emit quest events to update progress
            emit(event: QuestEvent): void {
                const all = (this.hero as any).quests as Record<string, QuestProgress>;
                if (!all) return;

                for (const def of Object.values(this.defs)) {
                    const progress = all[String(def.id)];
                    if (!progress) continue;
                    if (progress.status !== 'active') continue;

                    const step = def.steps[progress.stepIndex];
                    if (!step) continue;

                    let touched = false;

                    for (const obj of step.objectives) {
                if (obj.eventType !== event.type) continue;
                if (obj.match && !obj.match(event)) continue;

                const cur = clampInt(progress.objectives[obj.id], 0);
                if (obj.type === 'flag') {
                    if (cur < 1) {
                        progress.objectives[obj.id] = 1;
                        touched = true;
                    }
                } else {
                    const inc = obj.amount ? clampInt(obj.amount(event), 0) : 1;
                    if (inc > 0) {
                        progress.objectives[obj.id] = cur + inc;
                        touched = true;
                    }
                }
            }

            if (touched) {
                this.log(`Progression: ${def.name}`);

                // Step completion => advance or finish
                if (stepObjectivesAreComplete(def, progress)) {
                    progress.stepIndex++;

                    if (progress.stepIndex >= def.steps.length) {
                        progress.status = 'completed';
                        this.log(`Quête terminée (à valider): ${def.name}`);

                        // Show a temporary UI notification (rewards are granted on claim)
                        try {
                            showTemporaryMessage(`Quête terminée : ${def.name} (à valider)`, 4000);
                        } catch {
                            // noop
                        }

                        // Optional: event for UIs that want to react on completion
                        try {
                            const ev = new CustomEvent('quest:completed', { detail: { id: def.id, name: def.name } });
                            document.dispatchEvent(ev);
                        } catch {
                            // noop
                        }
                    } else {
                        initNextStepObjectives(def, progress);
                        const nextTitle = def.steps[progress.stepIndex]?.title;
                        this.log(`Étape suivante: ${nextTitle ?? def.steps[progress.stepIndex]?.id ?? ''}`);
                    }
                }
            }
        }
    }
}
