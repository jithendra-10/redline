/**
 * A small status chip pinned to the chat box the user is typing in, so Redline is
 * visibly "on" before anything is sent: idle / checking / clean / N items found.
 */
const CSS = `
:host { all: initial; }
.chip { position: fixed; z-index: 2147483645; display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: 999px; font: 600 11.5px/1.4 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #fffdf7; color: #1d1b16; border: 1px solid #e3dccb; box-shadow: 0 2px 8px rgba(0,0,0,.15);
  pointer-events: none; transition: opacity .2s; white-space: nowrap; }
.chip.found { background: #fbe3e6; color: #8a0f22; border-color: #f1b8c0; }
.chip.clean { background: #e1f2e8; color: #1f7a4d; border-color: #b9e0c9; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #c8102e; }
.chip.clean .dot { background: #1f7a4d; }
.chip.checking .dot { animation: p 1s ease-in-out infinite; }
@keyframes p { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .chip.checking .dot { animation: none; } }
@media (prefers-color-scheme: dark) {
  .chip { background: #1f1d17; color: #f1ede2; border-color: #3a362d; }
  .chip.found { background: #3a1a1f; color: #ffb3bd; border-color: #5a2530; }
  .chip.clean { background: #16301f; color: #8fe0b4; border-color: #24503a; }
}
`;

export type IndicatorState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'clean' }
  | { kind: 'found'; count: number }
  | { kind: 'hidden' };

export class Indicator {
  private host = document.createElement('redline-indicator');
  private root = this.host.attachShadow({ mode: 'closed' });
  private chip = document.createElement('div');
  private target: HTMLElement | null = null;
  private raf = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    this.chip.className = 'chip';
    this.chip.setAttribute('role', 'status');
    this.chip.setAttribute('aria-live', 'polite');
    this.root.append(style, this.chip);
    window.addEventListener('scroll', () => this.place(), true);
    window.addEventListener('resize', () => this.place());
  }

  attach(target: HTMLElement) {
    this.target = target;
    if (!this.host.isConnected) document.documentElement.append(this.host);
    this.place();
  }

  set(state: IndicatorState) {
    if (state.kind === 'hidden' || !this.target) {
      this.chip.style.opacity = '0';
      return;
    }
    this.chip.style.opacity = '1';
    this.chip.className = `chip ${state.kind}`;
    const label =
      state.kind === 'idle' ? 'Redline on'
      : state.kind === 'checking' ? 'Redline checking…'
      : state.kind === 'clean' ? 'Nothing sensitive'
      : `${state.count} item${state.count === 1 ? '' : 's'} will be redacted`;
    this.chip.innerHTML = `<span class="dot"></span><span>🔒 ${label}</span>`;
    this.place();
  }

  private place() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      if (!this.target?.isConnected) return;
      const r = this.target.getBoundingClientRect();
      const w = this.chip.offsetWidth || 120;
      this.chip.style.top = `${Math.max(4, r.top - 24)}px`;
      this.chip.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    });
  }
}
