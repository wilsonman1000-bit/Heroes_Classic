import type { DialogueChoice, DialogueContext, DialogueNode, DialogueScript } from './dialogueTypes.js';
import { DIALOGUES } from './dialogues.js';

const STYLE_ID = 'dialogue-overlay-style';
const ROOT_ID = 'dialogue-overlay-root';

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}{position:fixed;inset:0;z-index:9999;display:none;}
#${ROOT_ID}[data-open="1"]{display:block;}
#${ROOT_ID} .dlg-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);}
#${ROOT_ID} .dlg-panel{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);width:min(980px,92vw);display:flex;gap:16px;align-items:flex-end;pointer-events:auto;}
#${ROOT_ID} .dlg-panel.right{flex-direction:row-reverse;}
#${ROOT_ID} .dlg-panel{--dlg-portrait-size:min(280px,34vw,34vh);} 
#${ROOT_ID} .dlg-portrait{width:var(--dlg-portrait-size);height:var(--dlg-portrait-size);flex:0 0 var(--dlg-portrait-size);border-radius:14px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.35);}
#${ROOT_ID} .dlg-portrait img{width:100%;height:100%;object-fit:cover;display:block;}
#${ROOT_ID} .dlg-bubble{flex:1;min-width:0;background:rgba(15,15,18,0.92);color:#fff;border-radius:16px;padding:14px 16px;box-shadow:0 12px 30px rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.16);}
#${ROOT_ID} .dlg-speaker{font-weight:900;letter-spacing:0.2px;margin-bottom:6px;color:#ffe08a;}
#${ROOT_ID} .dlg-text{white-space:pre-wrap;line-height:1.45;color:#f1f1f1;}
#${ROOT_ID} .dlg-choices{margin-top:12px;display:flex;flex-wrap:wrap;gap:10px;}
#${ROOT_ID} .dlg-choices.grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));}
#${ROOT_ID} .dlg-choices.grid-3 .dlg-choice{width:100%;text-align:left;}
#${ROOT_ID} .dlg-choice{appearance:none;border:0;border-radius:12px;padding:10px 12px;background:rgba(255,255,255,0.10);color:#fff;cursor:pointer;font-weight:700;transition:transform .06s ease, background .12s ease;}
#${ROOT_ID} .dlg-choice:hover{background:rgba(255,255,255,0.16);}
#${ROOT_ID} .dlg-choice:active{transform:translateY(1px);}
#${ROOT_ID} .dlg-choice[disabled]{opacity:0.45;cursor:not-allowed;}

/* Choice feedback (good/bad/medium) */
#${ROOT_ID} .dlg-choice[data-feedback]{opacity:1;}
#${ROOT_ID} .dlg-choice[data-feedback="good"]{background:rgba(46,204,113,0.28);outline:2px solid rgba(46,204,113,0.75);}
#${ROOT_ID} .dlg-choice[data-feedback="bad"]{background:rgba(231,76,60,0.26);outline:2px solid rgba(231,76,60,0.70);}
#${ROOT_ID} .dlg-choice[data-feedback="medium"]{background:rgba(241,196,15,0.22);outline:2px solid rgba(241,196,15,0.72);}
#${ROOT_ID} .dlg-hint{margin-top:10px;font-size:12px;color:rgba(255,255,255,0.62);}

/* Floating texts (like tactical damage numbers) */
#${ROOT_ID} .dlg-float{
    position:fixed;
    left:0;
    top:0;
    transform: translate(-50%, -50%);
    font-weight: 900;
    font-size: 26px;
    letter-spacing: 0.2px;
    pointer-events: none;
    user-select: none;
    z-index: 10010;
    text-shadow:
        0 2px 0 rgba(0,0,0,0.45),
        0 10px 18px rgba(0,0,0,0.55);
    filter: drop-shadow(0 10px 18px rgba(0,0,0,0.55));
    animation: dlgFloatUp 2000ms cubic-bezier(0.12, 0.92, 0.18, 1) forwards;
    will-change: transform, opacity;
}

@keyframes dlgFloatUp {
    0%   { opacity: 0; transform: translate(-50%, -25%) scale(0.92); }
    8%   { opacity: 1; transform: translate(-50%, -70%) scale(1.10); }
    45%  { opacity: 1; transform: translate(-50%, -205%) scale(1.04); }
    100% { opacity: 0; transform: translate(-50%, -285%) scale(1.02); }
}
`;
    document.head.appendChild(style);
}

function ensureRoot(): HTMLElement {
    let root = document.getElementById(ROOT_ID) as HTMLElement | null;
    if (root) return root;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
<div class="dlg-backdrop" data-dlg-close="1"></div>
<div class="dlg-panel">
  <div class="dlg-portrait" data-dlg-portrait-wrap="1"><img data-dlg-portrait="1" alt="Portrait"></div>
  <div class="dlg-bubble">
    <div class="dlg-speaker" data-dlg-speaker="1"></div>
    <div class="dlg-text" data-dlg-text="1"></div>
    <div class="dlg-choices" data-dlg-choices="1"></div>
    <div class="dlg-hint">Échap: fermer — 1-9: choisir</div>
  </div>
</div>`;

    document.body.appendChild(root);
    return root;
}

function resolveNode(script: DialogueScript, nodeId: string): DialogueNode {
    const n = script.nodes[nodeId];
    if (!n) {
        throw new Error(`[dialogue] Unknown node '${nodeId}' for script '${script.id}'`);
    }
    return n;
}

export class DialogueManager {
    private root: HTMLElement | null = null;
    private open = false;
    private ctx: DialogueContext = {};
    private script: DialogueScript | null = null;
    private currentNodeId: string | null = null;
    private locked = false;
    private feedbackTimer: number | null = null;

    private onKeyDown = (ev: KeyboardEvent) => {
        if (!this.open) return;
        if (ev.key === 'Escape') {
            ev.preventDefault();
            this.close();
            return;
        }
        if (this.locked) return;
        const n = Number(ev.key);
        if (!Number.isFinite(n) || n < 1 || n > 9) return;
        const choices = this.getVisibleChoices();
        const choice = choices[n - 1];
        if (!choice) return;
        if (!this.isChoiceEnabled(choice)) return;
        ev.preventDefault();
        this.selectChoice(choice, n - 1);
    };

    start(dialogueId: string, ctx: DialogueContext = {}): void {
        const script = DIALOGUES[dialogueId];
        if (!script) throw new Error(`[dialogue] Unknown script '${dialogueId}'`);
        this.startScript(script, ctx);
    }

    startScript(script: DialogueScript, ctx: DialogueContext = {}): void {
        ensureStyle();
        this.root = ensureRoot();
        // Enrich context with UI FX helpers (centralized dialogue system)
        this.ctx = {
            ...ctx,
            dialogueFx: {
                floatText: (text: string, opts?: { color?: string }) => this.spawnFloatingText(text, opts),
            },
        };
        this.script = script;
        this.open = true;
        this.root.setAttribute('data-open', '1');

        // Backdrop close
        const closeEl = this.root.querySelector('[data-dlg-close="1"]');
        closeEl?.addEventListener(
            'click',
            (e) => {
                e.preventDefault();
                this.close();
            },
            { once: true }
        );

        // Keybinds
        window.addEventListener('keydown', this.onKeyDown);

        this.goTo(script.start);
    }

    private spawnFloatingText(text: string, opts?: { color?: string }): void {
        if (!this.root) return;
        if (!this.open) return;
        const msg = String(text ?? '').trim();
        if (!msg) return;

        try {
            const bubble = this.root.querySelector('.dlg-bubble') as HTMLElement | null;
            if (!bubble) return;
            const r = bubble.getBoundingClientRect();
            const jitterX = Math.max(-10, Math.min(10, Math.random() * 18 - 9));
            const jitterY = Math.max(-8, Math.min(8, Math.random() * 14 - 7));

            const el = document.createElement('div');
            el.className = 'dlg-float';
            el.textContent = msg;
            el.style.left = `${Math.round(r.right + 26 + jitterX)}px`;
            el.style.top = `${Math.round(r.top + Math.min(r.height * 0.25, 44) + jitterY)}px`;
            if (opts?.color) el.style.color = opts.color;
            this.root.appendChild(el);

            setTimeout(() => {
                try {
                    el.remove();
                } catch {
                    // noop
                }
            }, 2400);
        } catch {
            // noop
        }
    }

    close(): void {
        if (!this.root) return;

        if (this.feedbackTimer != null) {
            try {
                window.clearTimeout(this.feedbackTimer);
            } catch {
                // noop
            }
            this.feedbackTimer = null;
        }
        this.locked = false;
        this.open = false;
        this.script = null;
        this.currentNodeId = null;
        this.root.removeAttribute('data-open');
        window.removeEventListener('keydown', this.onKeyDown);
    }

    private goTo(nodeId: string): void {
        if (!this.root) return;
        if (!this.script) return;

        this.currentNodeId = nodeId;
        const node = resolveNode(this.script, nodeId);

        try {
            node.onEnter?.(this.ctx);
        } catch {
            // noop
        }

        const panel = this.root.querySelector('.dlg-panel') as HTMLElement | null;
        const speakerEl = this.root.querySelector('[data-dlg-speaker="1"]') as HTMLElement | null;
        const textEl = this.root.querySelector('[data-dlg-text="1"]') as HTMLElement | null;
        const choicesEl = this.root.querySelector('[data-dlg-choices="1"]') as HTMLElement | null;
        const portraitImg = this.root.querySelector('[data-dlg-portrait="1"]') as HTMLImageElement | null;
        const portraitWrap = this.root.querySelector('[data-dlg-portrait-wrap="1"]') as HTMLElement | null;

        if (panel) {
            const side = node.side ?? 'left';
            panel.classList.toggle('right', side === 'right');
        }

        if (speakerEl) speakerEl.textContent = node.speaker;
        if (textEl) textEl.textContent = node.text;

        if (portraitImg && portraitWrap) {
            if (node.portraitSrc) {
                portraitWrap.style.display = '';
                portraitImg.src = node.portraitSrc;
            } else {
                portraitWrap.style.display = 'none';
                portraitImg.removeAttribute('src');
            }
        }

        if (choicesEl) {
            choicesEl.innerHTML = '';
            choicesEl.classList.toggle('grid-3', (node.choicesLayout ?? 'wrap') === 'grid-3');
            const visible = this.getVisibleChoices();
            visible.forEach((c, idx) => {
                const btn = document.createElement('button');
                btn.className = 'dlg-choice';
                btn.type = 'button';
                btn.setAttribute('data-choice-idx', String(idx));
                btn.textContent = `${idx + 1}. ${c.text}`;
                btn.disabled = !this.isChoiceEnabled(c);
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    if (btn.disabled) return;
                    this.selectChoice(c, idx);
                });
                choicesEl.appendChild(btn);
            });

            // If node has no choices, add a default close.
            if (visible.length === 0) {
                const btn = document.createElement('button');
                btn.className = 'dlg-choice';
                btn.type = 'button';
                btn.textContent = 'Fermer';
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    this.close();
                });
                choicesEl.appendChild(btn);
            }
        }
    }

    private getVisibleChoices(): DialogueChoice[] {
        if (!this.script || !this.currentNodeId) return [];
        const node = this.script.nodes[this.currentNodeId];
        if (!node?.choices) return [];
        if (typeof node.choices === 'function') {
            try {
                return node.choices(this.ctx) ?? [];
            } catch {
                return [];
            }
        }
        return node.choices;
    }

    private isChoiceEnabled(choice: DialogueChoice): boolean {
        try {
            if (!choice.enabled) return true;
            return choice.enabled(this.ctx);
        } catch {
            return true;
        }
    }

    private resolveFeedback(choice: DialogueChoice): 'good' | 'bad' | 'medium' | undefined {
        const fb = choice.feedback;
        if (!fb) return undefined;
        if (typeof fb === 'function') {
            try {
                return fb(this.ctx);
            } catch {
                return undefined;
            }
        }
        return fb;
    }

    private applyFeedbackUI(choiceIndex: number, verdict: 'good' | 'bad' | 'medium'): void {
        if (!this.root) return;
        const choicesEl = this.root.querySelector('[data-dlg-choices="1"]') as HTMLElement | null;
        if (!choicesEl) return;
        const btns = Array.from(choicesEl.querySelectorAll('button.dlg-choice')) as HTMLButtonElement[];
        btns.forEach((b) => {
            b.disabled = true;
            b.removeAttribute('data-feedback');
        });
        const selected = btns[choiceIndex];
        if (selected) selected.setAttribute('data-feedback', verdict);
    }

    private selectChoice(choice: DialogueChoice, choiceIndex?: number): void {
        if (this.locked) return;

        try {
            choice.onSelect?.(this.ctx);
        } catch {
            // noop
        }

        let next: string | undefined;
        if (typeof choice.next === 'function') {
            try {
                next = choice.next(this.ctx);
            } catch {
                next = undefined;
            }
        } else {
            next = choice.next;
        }

        if (!next) {
            const verdict = this.resolveFeedback(choice);
            if (verdict && choiceIndex != null) {
                this.locked = true;
                this.applyFeedbackUI(choiceIndex, verdict);
                const delay = Math.max(0, Math.min(10000, Number(choice.feedbackDelayMs ?? 2000)));
                this.feedbackTimer = window.setTimeout(() => {
                    this.feedbackTimer = null;
                    this.locked = false;
                    this.close();
                }, delay);
                return;
            }
            this.close();
            return;
        }

        const verdict = this.resolveFeedback(choice);
        if (verdict && choiceIndex != null) {
            this.locked = true;
            this.applyFeedbackUI(choiceIndex, verdict);
            const delay = Math.max(0, Math.min(10000, Number(choice.feedbackDelayMs ?? 2000)));
            this.feedbackTimer = window.setTimeout(() => {
                this.feedbackTimer = null;
                this.locked = false;
                this.goTo(next);
            }, delay);
            return;
        }

        this.goTo(next);
    }
}

export const dialogueManager = new DialogueManager();

export function startDialogue(dialogueId: string, ctx?: DialogueContext): void;
export function startDialogue(script: DialogueScript, ctx?: DialogueContext): void;
export function startDialogue(dialogueIdOrScript: string | DialogueScript, ctx: DialogueContext = {}): void {
    if (typeof dialogueIdOrScript === 'string') {
        dialogueManager.start(dialogueIdOrScript, ctx);
        return;
    }
    dialogueManager.startScript(dialogueIdOrScript, ctx);
}
