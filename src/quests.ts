export type QuestId = string;

export type QuestEvent =
    | { type: 'talk_npc'; npcId: string }
    | { type: 'win_tactical'; enemyId: string; enemyCount: number; enemyLevel: number }
    | { type: 'give_wood'; amount: number }
    | { type: 'create_campfire' };
export type QuestObjectiveType = 'flag' | 'counter';

export type QuestObjectiveDef = {
    id: string;
    description: string;
    type: QuestObjectiveType;
    eventType: QuestEvent['type'];
    target?: number; // required for counter
    match?: (e: QuestEvent) => boolean;
    amount?: (e: QuestEvent) => number; // counter increment
};

export type QuestStepDef = {
    id: string;
    title?: string;
    objectives: QuestObjectiveDef[];
};

export type QuestRewards = {
    xp?: number;
    gold?: number;
    wood?: number;
    herb?: number;
    skillPoints?: number;
    campfire?: number; // number of campfires to grant
};

export type QuestDef = {
    id: QuestId;
    name: string;
    description: string;
    autoStart?: boolean;
    /**
     * If set, the quest cannot be started until this prerequisite quest is CLAIMED.
     * (Used for inn chain quests.)
     */
    prerequisiteClaimedQuestId?: QuestId;
    /**
     * If set, the quest should not be shown in the Quêtes list until the prerequisite quest is CLAIMED.
     */
    hiddenUntilClaimedQuestId?: QuestId;
    /**
     * If false, the quest cannot be manually started from the Quêtes menu and should be
     * started by in-game triggers (e.g., entering a location). Default: true
     */
    manualStartAllowed?: boolean;
    steps: QuestStepDef[];
    rewards?: QuestRewards;
};

export type QuestStatus = 'active' | 'completed' | 'claimed';

export type QuestProgress = {
    status: QuestStatus;
    stepIndex: number;
    // objectiveId -> progress (number for counter, 0/1 for flag)
    objectives: Record<string, number>;
};

// Example quests (you can add as many as you want here)
export const QUEST_DEFS: Record<string, QuestDef> = {
    auberge_demarrage: {
        id: 'auberge_demarrage',
        name: "Premiers pas à l'auberge",
        description: "Parle aux PNJ de l'auberge puis gagne un combat contre des gobelins.",
        // autoStart: true, (starts when the player first enters the auberge)
        manualStartAllowed: false,
        steps: [
            {
                id: 'win_gobelins',
                title: 'Premier combat',
                objectives: [
                    {
                        id: 'win_gobelin',
                        description: 'Gagner un combat contre des gobelins',
                        type: 'counter',
                        eventType: 'win_tactical',
                        target: 1,
                        match: (e) => e.type === 'win_tactical' && e.enemyId === 'gobelin',
                        amount: () => 1,
                    },
                ],
            },
            {
                id: 'talk_aubergiste',
                title: "Rencontre",
                objectives: [
                    {
                        id: 'talk_aubergiste',
                        description: "Parler à l'aubergiste",
                        type: 'flag',
                        eventType: 'talk_npc',
                        match: (e) => e.type === 'talk_npc' && e.npcId === 'aubergiste',
                    },
                ],
            },
        ],
        rewards: { xp: 50, gold: 20, campfire: 1 },
    },
    bring_wood_festival: {
        id: 'bring_wood_festival',
        name: 'Bois pour la fête',
        description: "Récupère 5 bois et rapporte-les à l'aubergiste pour préparer la fête.",
        // Indisponible manuellement au départ : débloquée après "auberge_demarrage"
        prerequisiteClaimedQuestId: 'auberge_demarrage',
        hiddenUntilClaimedQuestId: 'auberge_demarrage',
        manualStartAllowed: false,
        steps: [
            {
                id: 'bring_wood',
                title: 'Collecte de bois',
                objectives: [
                    {
                        id: 'bring_wood',
                        description: 'Rapporte 5 bois à l\'aubergiste',
                        type: 'counter',
                        eventType: 'give_wood',
                        target: 5,
                        amount: (e) => (e as any).amount ?? 0,
                    },
                ],
            },
        ],
        rewards: { xp: 80, gold: 30 },
    },
    build_campfire: {
        id: 'build_campfire',
        name: 'Création feu de camp',
        description: 'Créer un feu de camp en utilisant du bois.',
        // Doit être disponible après la quête "Bois pour la fête"
        prerequisiteClaimedQuestId: 'bring_wood_festival',
        hiddenUntilClaimedQuestId: 'bring_wood_festival',
        manualStartAllowed: false,
        steps: [
            {
                id: 'create_campfire',
                title: 'Allumer le feu',
                objectives: [
                    {
                        id: 'create_campfire',
                        description: 'Créer un feu de camp',
                        type: 'flag',
                        eventType: 'create_campfire',
                    },
                ],
            },
        ],
        rewards: { xp: 100, gold: 40, campfire: 1 },
    },
    kill_gobelin_lvl5: {
        id: 'kill_gobelin_lvl5',
        name: 'Chasse gobelinesque',
        description: 'Tue un gobelin de niveau 5 (ou plus).',
        // Indisponible manuellement au départ : débloquée après "auberge_demarrage"
        prerequisiteClaimedQuestId: 'auberge_demarrage',
        hiddenUntilClaimedQuestId: 'auberge_demarrage',
        manualStartAllowed: false,
        steps: [
            {
                id: 'kill_gobelin_5',
                title: 'Cible: Gobelin niv.5',
                objectives: [
                    {
                        id: 'kill_gobelin_5',
                        description: 'Tue un gobelin de niveau >= 5',
                        type: 'counter',
                        eventType: 'win_tactical',
                        target: 1,
                        match: (e) => e.type === 'win_tactical' && e.enemyId === 'gobelin' && (e as any).enemyLevel >= 5,
                        amount: () => 1,
                    },
                ],
            },
        ],
        rewards: { xp: 150, gold: 50 },
    }
};
