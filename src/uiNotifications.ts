export function showTemporaryMessage(msg: string, ms = 2000) {
    let el = document.getElementById('temp-notice') as HTMLElement | null;
    if (!el) {
        el = document.createElement('div');
        el.id = 'temp-notice';
        el.style.position = 'fixed';
        el.style.left = '50%';
        el.style.top = '6%';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '60';
        el.style.background = 'rgba(0,0,0,0.85)';
        el.style.color = '#fff';
        el.style.padding = '10px 18px';
        el.style.borderRadius = '8px';
        el.style.boxShadow = '0 4px 20px rgba(0,0,0,0.6)';
        el.style.opacity = '0';
        el.style.transition = 'opacity 200ms ease';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    // Force paint then show
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetHeight;
    el.style.opacity = '1';
    setTimeout(() => {
        el!.style.opacity = '0';
        setTimeout(() => el?.remove(), 220);
    }, ms);
}