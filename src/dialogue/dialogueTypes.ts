export type DialogueId = string;

export type DialogueSide = 'left' | 'right';

export type QuestEventLike =
    | { type: 'talk_npc'; npcId: string }
    | { type: 'win_tactical'; enemyId: string; enemyCount: number; enemyLevel: number }
    | { type: 'give_wood'; amount: number }
    | { type: 'create_campfire' };

export type QuestManagerLike = {
    getProgress?: (id: string) => { status: 'active' | 'completed' | 'claimed'; stepIndex: number; objectives: Record<string, number> } | null;
    start?: (id: string) => { ok: true } | { ok: false; error: string };
    claim?: (id: string) => { ok: true } | { ok: false; error: string };
    getAll?: () => Array<{ def: { id: string; name?: string }; progress: { status: 'active' | 'completed' | 'claimed'; stepIndex: number; objectives: Record<string, number> } | null }>;
    emit?: (event: QuestEventLike) => void;
};

export type DialogueContext = {
    questManager?: QuestManagerLike;
    flags?: Record<string, boolean>;
    hero?: any;
    notify?: (message: string, ms?: number) => void;
    dialogueFx?: {
        floatText: (text: string, opts?: { color?: string }) => void;
    };
};

export type DialogueChoiceFeedback = 'good' | 'bad' | 'medium';

export type DialogueChoice = {
    id?: string;
    text: string;
    next?: string | ((ctx: DialogueContext) => string | undefined);
    onSelect?: (ctx: DialogueContext) => void;
    enabled?: (ctx: DialogueContext) => boolean;
    /**
     * Optional immediate feedback shown on the selected choice.
     * When provided, the dialogue UI will keep choices visible briefly and
     * highlight the selected answer based on this verdict.
     */
    feedback?: DialogueChoiceFeedback | ((ctx: DialogueContext) => DialogueChoiceFeedback | undefined);
    /** Overrides the default feedback display duration (ms). */
    feedbackDelayMs?: number;
};

export type DialogueNode = {
    id: string;
    speaker: string;
    side?: DialogueSide;
    portraitSrc?: string;
    text: string;
    choicesLayout?: 'wrap' | 'grid-3';
    choices?: DialogueChoice[] | ((ctx: DialogueContext) => DialogueChoice[]);
    onEnter?: (ctx: DialogueContext) => void;
};

export type DialogueScript = {
    id: DialogueId;
    start: string;
    nodes: Record<string, DialogueNode>;
};
