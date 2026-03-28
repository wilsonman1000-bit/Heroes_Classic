import type { DialogueContext, DialogueScript } from './dialogueTypes.js';
import { quickResponses9Choices } from './quickResponses9.js';
import { gainVirtue } from './virtueGainDialogueFx.js';

const PORTRAIT_AUBERGE_PNJ3 = 'ImagesRPG/imagespersonnage/portrait1.1.png';

function notify(ctx: DialogueContext, message: string, ms = 3500): void {
    try {
        ctx.notify?.(message, ms);
    } catch {
        // noop
    }
}

function tryStartQuest(ctx: DialogueContext, questId: string): void {
    try {
        const qm = ctx.questManager;
        if (!qm?.start) return;
        qm.start(questId);
    } catch {
        // noop
    }
}

function isQuestClaimed(ctx: DialogueContext, id: string): boolean {
    try {
        const p = ctx.questManager?.getProgress?.(id);
        return p?.status === 'claimed';
    } catch {
        return false;
    }
}

function isQuestActiveOrDone(ctx: DialogueContext, id: string): boolean {
    try {
        const p = ctx.questManager?.getProgress?.(id);
        return Boolean(p);
    } catch {
        return false;
    }
}

export const DIALOGUES: Record<string, DialogueScript> = {
    auberge_pnj1: {
        id: 'auberge_pnj1',
        start: 'start',
        nodes: {
            start: {
                id: 'start',
                speaker: 'Aubergiste',
                side: 'left',
                text: "Bienvenue ! Bois, soupe, lit… et parfois des ennuis à régler.",
                onEnter: (ctx) => {
                    try {
                        ctx.questManager?.emit?.({ type: 'talk_npc', npcId: 'aubergiste' });
                    } catch {
                        // noop
                    }
                },
                choices: (ctx) => {
                    const qm = ctx.questManager;
                    const hero = ctx.hero as any;
                    const choices: any[] = [];

                    // Claimables
                    let claimableCount = 0;
                    try {
                        const all = qm?.getAll?.() ?? [];
                        claimableCount = all.filter((x) => x?.progress?.status === 'completed').length;
                    } catch {
                        claimableCount = 0;
                    }
                    choices.push({
                        text: claimableCount > 0 ? `Valider des quêtes (${claimableCount})` : 'Valider des quêtes',
                        enabled: () => claimableCount > 0,
                        next: 'claim',
                    });

                    // Offers
                    choices.push({ text: 'Voir les quêtes disponibles', next: 'offers' });

                    // Deliver wood
                    const wood = Math.max(0, Math.floor(Number(hero?.wood ?? 0)));
                    const bringWoodActive = qm?.getProgress?.('bring_wood_festival')?.status === 'active';
                    if (bringWoodActive) {
                        choices.push({
                            text: wood > 0 ? `Donner le bois (${wood})` : 'Donner le bois',
                            enabled: () => wood > 0,
                            onSelect: (ctx2: DialogueContext) => {
                                const h = ctx2.hero as any;
                                const w = Math.max(0, Math.floor(Number(h?.wood ?? 0)));
                                if (w <= 0) {
                                    notify(ctx2, "Vous n'avez pas de bois.", 2200);
                                    return;
                                }
                                try {
                                    ctx2.questManager?.emit?.({ type: 'give_wood', amount: w });
                                    h.wood = 0;
                                    notify(ctx2, "Vous remettez le bois à l'aubergiste.", 3000);
                                } catch {
                                    notify(ctx2, "Impossible de remettre le bois.", 2600);
                                }
                            },
                            next: 'start',
                        });
                    }

                    choices.push({ text: 'Au revoir.' });
                    return choices;
                },
            },

            claim: {
                id: 'claim',
                speaker: 'Aubergiste',
                side: 'left',
                text: 'Voyons voir ce que tu as accompli…',
                choices: (ctx) => {
                    const qm = ctx.questManager;
                    const all = qm?.getAll?.() ?? [];
                    const claimables = all.filter((x) => x?.progress?.status === 'completed');
                    const choices: any[] = [];
                    for (const c of claimables.slice(0, 7)) {
                        const id = String(c?.def?.id ?? '');
                        const label = String(c?.def?.name ?? id);
                        if (!id) continue;
                        choices.push({
                            text: `Valider : ${label}`,
                            onSelect: (ctx2: DialogueContext) => {
                                try {
                                    const res = ctx2.questManager?.claim?.(id);
                                    if (res && (res as any).ok === false) {
                                        notify(ctx2, String((res as any).error ?? 'Impossible de valider.'), 3500);
                                    } else {
                                        notify(ctx2, `Quête validée : ${label}`, 3000);
                                    }
                                } catch {
                                    notify(ctx2, 'Erreur de validation.', 2600);
                                }
                            },
                            next: 'claim',
                        });
                    }
                    if (choices.length === 0) {
                        choices.push({ text: 'Rien à valider.', next: 'start' });
                    } else {
                        choices.push({ text: 'Retour', next: 'start' });
                    }
                    return choices;
                },
            },

            offers: {
                id: 'offers',
                speaker: 'Aubergiste',
                side: 'left',
                text: "J'ai deux services à te proposer. Si tu es partant, je note ça.",
                choices: (ctx) => {
                    const qm = ctx.questManager;
                    const choices: any[] = [];

                    const has = (id: string) => Boolean(qm?.getProgress?.(id));
                    const claimed = (id: string) => qm?.getProgress?.(id)?.status === 'claimed';
                    const canStart = (id: string) => {
                        if (has(id)) return false;
                        // Manual gating via prerequisite quests (as defined in quests.ts)
                        if (id === 'bring_wood_festival' || id === 'kill_gobelin_lvl5') return claimed('auberge_demarrage');
                        if (id === 'build_campfire') return claimed('bring_wood_festival');
                        return true;
                    };

                    choices.push({
                        text: 'Quête : Bois pour la fête',
                        enabled: () => canStart('bring_wood_festival'),
                        onSelect: (ctx2: DialogueContext) => {
                            const res = ctx2.questManager?.start?.('bring_wood_festival');
                            if (res && (res as any).ok === false) notify(ctx2, String((res as any).error ?? 'Quête verrouillée.'), 3800);
                            else notify(ctx2, 'Quête acceptée : Bois pour la fête', 3200);
                        },
                        next: 'offers',
                    });

                    choices.push({
                        text: 'Quête : Chasse gobelinesque',
                        enabled: () => canStart('kill_gobelin_lvl5'),
                        onSelect: (ctx2: DialogueContext) => {
                            const res = ctx2.questManager?.start?.('kill_gobelin_lvl5');
                            if (res && (res as any).ok === false) notify(ctx2, String((res as any).error ?? 'Quête verrouillée.'), 3800);
                            else notify(ctx2, 'Quête acceptée : Chasse gobelinesque', 3200);
                        },
                        next: 'offers',
                    });

                    // Optional third quest, if you want to expose it here once unlocked
                    choices.push({
                        text: 'Quête : Création feu de camp',
                        enabled: () => canStart('build_campfire'),
                        onSelect: (ctx2: DialogueContext) => {
                            const res = ctx2.questManager?.start?.('build_campfire');
                            if (res && (res as any).ok === false) notify(ctx2, String((res as any).error ?? 'Quête verrouillée.'), 3800);
                            else notify(ctx2, 'Quête acceptée : Création feu de camp', 3200);
                        },
                        next: 'offers',
                    });

                    choices.push({ text: 'Retour', next: 'start' });
                    return choices;
                },
            },
        },
    },

    auberge_pnj2: {
        id: 'auberge_pnj2',
        start: 'start',
        nodes: {
            start: {
                id: 'start',
                speaker: 'Fille du tavernier',
                side: 'left',
                text: "Tu veux un indice pour l'énigme ?",
                onEnter: (ctx) => {
                    try {
                        ctx.questManager?.emit?.({ type: 'talk_npc', npcId: 'fille_tavernier' });
                    } catch {
                        // noop
                    }
                },
                choices: [
                    { text: 'Oui, donne-moi un indice.', next: 'hint' },
                    { text: 'Non merci.' },
                ],
            },
            hint: {
                id: 'hint',
                speaker: 'Fille du tavernier',
                side: 'left',
                text: "Regarde bien les détails… Souvent, la réponse est dans ce qu'on croit évident.",
                choices: [{ text: 'Merci !', next: 'start' }, { text: 'Fermer' }],
            },
        },
    },

    auberge_pnj4: {
        id: 'auberge_pnj4',
        start: 'start',
        nodes: {
            start: {
                id: 'start',
                speaker: 'Vieux sage',
                side: 'left',
                text: 'Si tu veux des conseils, approche.',
                onEnter: (ctx) => {
                    try {
                        ctx.questManager?.emit?.({ type: 'talk_npc', npcId: 'vieux_sage' });
                    } catch {
                        // noop
                    }
                },
                choices: [
                    { text: 'Un conseil pour survivre ?', next: 'advice' },
                    { text: 'Au revoir.' },
                ],
            },
            advice: {
                id: 'advice',
                speaker: 'Vieux sage',
                side: 'left',
                text: "Ne cours pas après la victoire : prépare-la. Équipe-toi, observe, et replie-toi si nécessaire.",
                choices: [{ text: 'Je m’en souviendrai.', next: 'start' }, { text: 'Fermer' }],
            },
        },
    },

    auberge_pnj3: {
        id: 'auberge_pnj3',
        start: 'start',
        nodes: {
            start: {
                id: 'start',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: "Ah, un visage nouveau. Approche… J’ai des histoires et des rumeurs.",
                onEnter: (ctx) => {
                    // Count as having talked to this NPC for quests.
                    try {
                        ctx.questManager?.emit?.({ type: 'talk_npc', npcId: 'barde' });
                    } catch {
                        // noop
                    }
                },
                choices: [
                    { text: 'Tu as des rumeurs intéressantes ?', next: 'rumors' },
                    { text: 'Je cherche du travail (quête).', next: 'quest' },
                    { text: 'Raconte-moi une histoire.', next: 'story' },
                    { text: 'Qui êtes-vous vraiment ?', next: 'who_really' },
                    { text: 'Au revoir.', next: 'end' },
                ],
            },

            who_really: {
                id: 'who_really',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: 'Comment ça ?',
                choicesLayout: 'grid-3',
                choices: quickResponses9Choices({
                    onPick: (ctx, id) => {
                        if (id !== 'implorer') return;
                        gainVirtue(ctx, 'honneur', 10);
                    },
                    nextById: { implorer: 'who_really_implorer' },
                    nextDefault: 'who_really_other',
                    feedbackById: { implorer: 'good' },
                    feedbackDefault: 'bad',
                    feedbackDelayMs: 2000,
                }),
            },

            who_really_implorer: {
                id: 'who_really_implorer',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: 'Je suis une légende des champs de bataille.',
                choices: [{ text: 'Revenir…', next: 'start' }],
            },

            who_really_other: {
                id: 'who_really_other',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: 'Demande à ta mère.',
                choices: [{ text: 'Revenir…', next: 'start' }],
            },

            rumors: {
                id: 'rumors',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: "Des gobelins rôdent près des chemins. On dit qu’un chef plus coriace mène la bande…",
                choices: [
                    { text: 'Ça sent l’embuscade. Merci.', next: 'start' },
                    { text: 'Je vais m’en occuper.', next: 'quest' },
                ],
            },

            quest: {
                id: 'quest',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: "Si tu veux prouver ta valeur, traque un gobelin d’un bon niveau. Mais l’aubergiste préfère d’abord voir de quoi tu es capable.",
                choices: [
                    {
                        text: 'Je suis prêt. Donne-moi la mission.',
                        enabled: (ctx) => isQuestClaimed(ctx, 'auberge_demarrage') && !isQuestActiveOrDone(ctx, 'kill_gobelin_lvl5'),
                        onSelect: (ctx) => tryStartQuest(ctx, 'kill_gobelin_lvl5'),
                        next: 'quest_started',
                    },
                    {
                        text: "Je ne peux pas encore ?",
                        enabled: (ctx) => !isQuestClaimed(ctx, 'auberge_demarrage'),
                        next: 'quest_locked',
                    },
                    {
                        text: 'Je l’ai déjà acceptée.',
                        enabled: (ctx) => isQuestActiveOrDone(ctx, 'kill_gobelin_lvl5'),
                        next: 'quest_already',
                    },
                    { text: 'Revenons aux questions…', next: 'start' },
                ],
            },

            quest_locked: {
                id: 'quest_locked',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: "Parle à l’aubergiste et fais tes premiers pas ici. Ensuite, reviens me voir.",
                choices: [{ text: 'Compris.', next: 'start' }],
            },

            quest_started: {
                id: 'quest_started',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: "Parfait. Reviens avec la preuve que tu as vaincu un gobelin d’un bon niveau, et je chanterai ton nom.",
                choices: [{ text: 'Je pars en chasse.', next: 'end' }],
            },

            quest_already: {
                id: 'quest_already',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: "Alors, qu’attends-tu ? Les routes ne se sécurisent pas toutes seules.",
                choices: [{ text: 'Je m’y mets.', next: 'end' }, { text: 'Autre chose…', next: 'start' }],
            },

            story: {
                id: 'story',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: "On raconte qu’un feu de camp bien placé sauve plus de vies qu’une lame trop lourde…",
                choices: [
                    { text: 'Je vois. Merci.', next: 'start' },
                    { text: 'Au revoir.', next: 'end' },
                ],
            },

            end: {
                id: 'end',
                speaker: 'Barde',
                side: 'left',
                portraitSrc: PORTRAIT_AUBERGE_PNJ3,
                text: 'Que la route te soit douce.',
                choices: [{ text: 'Fermer' }],
            },
        },
    },
};
