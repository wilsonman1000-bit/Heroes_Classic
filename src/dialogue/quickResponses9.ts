import type { DialogueChoice, DialogueChoiceFeedback, DialogueContext } from './dialogueTypes.js';

export type QuickResponse9Id =
    | 'intimider'
    | 'ordonner'
    | 'impressionner'
    | 'ruser'
    | 'seduire'
    | 'provoquer'
    | 'compassion'
    | 'implorer'
    | 'raisonner';

export const QUICK_RESPONSES_9: ReadonlyArray<{ id: QuickResponse9Id; label: string }> = [
    { id: 'intimider', label: 'Intimider' },
    { id: 'ordonner', label: 'Ordonner' },
    { id: 'impressionner', label: 'Impressionner' },
    { id: 'ruser', label: 'Ruser' },
    { id: 'seduire', label: 'Séduire' },
    { id: 'provoquer', label: 'Provoquer' },
    { id: 'compassion', label: 'Compassion' },
    { id: 'implorer', label: 'Implorer' },
    { id: 'raisonner', label: 'Raisonner' },
];

export function quickResponses9Choices(opts: {
    onPick?: (ctx: DialogueContext, id: QuickResponse9Id) => void;
    nextById?: Partial<Record<QuickResponse9Id, string>>;
    nextDefault?: string;
    feedbackById?: Partial<Record<QuickResponse9Id, DialogueChoiceFeedback>>;
    feedbackDefault?: DialogueChoiceFeedback;
    feedbackDelayMs?: number;
}): DialogueChoice[] {
    const { onPick, nextById, nextDefault, feedbackById, feedbackDefault, feedbackDelayMs } = opts;

    return QUICK_RESPONSES_9.map(({ id, label }) => {
        const next = nextById?.[id] ?? nextDefault;
        const feedback = feedbackById?.[id] ?? feedbackDefault;
        const choice: DialogueChoice = {
            id,
            text: label,
            onSelect: (ctx) => {
                try {
                    onPick?.(ctx, id);
                } catch {
                    // noop
                }
            },
        };
        if (feedback) choice.feedback = feedback;
        if (typeof feedbackDelayMs === 'number') choice.feedbackDelayMs = feedbackDelayMs;
        if (next) choice.next = next;
        return choice;
    });
}
