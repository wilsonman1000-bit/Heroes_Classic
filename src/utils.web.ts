// Fonctions utilitaires diverses

export function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

export function escapeHtml(s: string): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function installHoverTooltip(container: HTMLElement, opts?: { selector?: string; tooltipId?: string }) {
    const selector = opts?.selector ?? '[data-skill-desc]';
    const tooltipId = opts?.tooltipId ?? 'skill-tooltip';

    let tooltip = document.getElementById(tooltipId) as HTMLDivElement | null;
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = tooltipId;
        tooltip.style.position = 'fixed';
        tooltip.style.background = 'rgba(0,0,0,0.85)';
        tooltip.style.border = '1px solid rgba(255,255,255,0.12)';
        tooltip.style.color = '#fff';
        tooltip.style.padding = '10px 12px';
        tooltip.style.borderRadius = '10px';
        tooltip.style.boxShadow = '0 10px 30px rgba(0,0,0,0.55)';
        tooltip.style.fontSize = '0.95em';
        tooltip.style.maxWidth = '380px';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.display = 'none';
        tooltip.style.zIndex = '9999';
        tooltip.style.textAlign = 'left';
        document.body.appendChild(tooltip);
    }

    let currentEl: HTMLElement | null = null;

    const positionTooltip = (e: MouseEvent) => {
        const offset = 14;
        tooltip!.style.left = `${e.clientX + offset}px`;
        tooltip!.style.top = `${e.clientY + offset}px`;
    };

    const onOver = (ev: MouseEvent) => {
        const target = ev.target as HTMLElement | null;
        const el = target?.closest?.(selector) as HTMLElement | null;
        if (!el) return;

        const encoded = el.getAttribute('data-skill-desc');
        const desc = encoded ? decodeURIComponent(encoded) : '';
        if (!desc) return;

        currentEl = el;
        tooltip!.textContent = desc;
        tooltip!.style.display = 'block';
        positionTooltip(ev);
    };

    const onMove = (ev: MouseEvent) => {
        if (tooltip!.style.display !== 'block') return;
        positionTooltip(ev);
    };

    const onOut = (ev: MouseEvent) => {
        if (!currentEl) return;
        const related = ev.relatedTarget as Node | null;
        if (related && currentEl.contains(related)) return;

        const target = ev.target as HTMLElement | null;
        const leftFrom = target?.closest?.(selector) as HTMLElement | null;
        if (leftFrom !== currentEl) return;

        currentEl = null;
        tooltip!.style.display = 'none';
    };

    container.addEventListener('mouseover', onOver);
    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseout', onOut);
}
