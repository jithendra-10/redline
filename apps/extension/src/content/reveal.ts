import { rehydrate } from '@redline/core/src/placeholders';

const PH_HINT = /\[\s*[A-Za-z_]+_\d+/;

const CSS = `
:host { all: initial; }
.pill { position: fixed; right: 20px; top: 72px; z-index: 2147483646; display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 999px; border: 1px solid #e3dccb; background: #fffdf7; color: #1d1b16;
  box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 600 13px/1 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; }
.pill[aria-pressed="true"] { background: #1f7a4d; border-color: #1f7a4d; color: #fff; }
@media (prefers-color-scheme: dark) { .pill { background: #1f1d17; color: #f1ede2; border-color: #3a362d; } }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #c8102e; }
.pill[aria-pressed="true"] .dot { background: #fff; }
`;

/**
 * Shows real values in place of placeholders in the AI's replies — in this tab's DOM only.
 * Nothing is sent anywhere; turning it off restores the exact placeholder text.
 */
export class Reveal {
  private host = document.createElement('redline-reveal');
  private root = this.host.attachShadow({ mode: 'closed' });
  private btn = document.createElement('button');
  private on = false;
  private originals = new Map<Text, string>();
  private observer = new MutationObserver((records) => this.onMutations(records));
  private scheduled = false;

  constructor(private getSession: () => Record<string, string>, private exclude: () => Element[]) {
    const style = document.createElement('style');
    style.textContent = CSS;
    this.btn.className = 'pill';
    this.btn.setAttribute('aria-pressed', 'false');
    this.btn.innerHTML = '<span class="dot"></span><span class="label">Redline · Show real names</span>';
    this.btn.addEventListener('mousedown', (e) => e.preventDefault());
    this.btn.addEventListener('click', () => this.toggle());
    this.root.append(style, this.btn);
  }

  get isOn() {
    return this.on;
  }

  show() {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  toggle() {
    this.on = !this.on;
    this.btn.setAttribute('aria-pressed', String(this.on));
    this.btn.querySelector('.label')!.textContent = this.on ? 'Redline · Showing real names (local)' : 'Redline · Show real names';
    if (this.on) {
      this.scan(document.body);
      this.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    } else {
      this.observer.disconnect();
      for (const [node, text] of this.originals) if (node.isConnected) node.nodeValue = text;
      this.originals.clear();
    }
  }

  /** Re-apply after new pastes (session grew). */
  refresh() {
    if (this.on) this.scan(document.body);
  }

  private skip(node: Node): boolean {
    const el = node.parentElement;
    if (!el) return true;
    if (el.closest('[contenteditable="true"], [contenteditable=""], textarea, input, script, style')) return true;
    return this.exclude().some((x) => x.contains(el));
  }

  private scan(root: Node) {
    const session = this.getSession();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const value = n.nodeValue ?? '';
      if (!PH_HINT.test(value) || this.skip(n)) continue;
      const replaced = rehydrate(value, session);
      if (replaced !== value) {
        if (!this.originals.has(n)) this.originals.set(n, value);
        n.nodeValue = replaced;
      }
    }
  }

  private onMutations(records: MutationRecord[]) {
    if (this.scheduled) return;
    this.scheduled = true;
    // Replies stream in token by token; batch work to one pass per frame.
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.observer.disconnect();
      for (const r of records) {
        if (r.type === 'characterData') {
          const t = r.target as Text;
          this.originals.delete(t); // streaming changed it; re-capture
          this.scan(t.parentNode ?? t);
        } else r.addedNodes.forEach((n) => this.scan(n));
      }
      this.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  }
}
