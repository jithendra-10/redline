import type { RedactionResult } from '@redline/core/src/types';
import { PLACEHOLDER_RE } from '@redline/core/src/placeholders';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.card {
  --bg:#fffdf7; --ink:#1d1b16; --muted:#6b6558; --line:#e3dccb; --red:#c8102e; --redsoft:#fbe3e6;
  --green:#1f7a4d; --greensoft:#e1f2e8; --amber:#fbf0d6;
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  width: min(460px, calc(100vw - 32px)); max-height: min(70vh, 560px);
  display: flex; flex-direction: column; gap: 10px; padding: 14px 16px;
  background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,.28); font: 14px/1.45 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  animation: in .16s ease-out;
}
@media (prefers-color-scheme: dark) {
  .card { --bg:#1f1d17; --ink:#f1ede2; --muted:#a39d8e; --line:#3a362d; --red:#ff5468; --redsoft:#3a1a1f;
          --green:#5fd39a; --greensoft:#16301f; --amber:#3a3018; }
}
@keyframes in { from { opacity: 0; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } .pulse { animation: none !important; } }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.logo { font: 700 17px/1 Georgia, "Times New Roman", serif; text-decoration: underline; text-decoration-color: var(--red);
        text-decoration-thickness: 2px; text-underline-offset: 4px; }
.chip { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--greensoft); color: var(--green); white-space: nowrap; }
.chip.warn { background: var(--amber); color: var(--muted); }
.pulse { animation: p 1.2s ease-in-out infinite; } @keyframes p { 50% { opacity: .5; } }
.text { margin: 0; padding: 10px; border-radius: 8px; background: color-mix(in srgb, var(--line) 35%, transparent);
        white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; max-height: 260px; font-size: 13px; transition: opacity .2s; }
.text.draft { opacity: .55; }
mark { background: var(--greensoft); color: var(--green); border-radius: 4px; padding: 0 3px; font: 600 12px ui-monospace, Menlo, monospace; }
.meta { font-size: 12px; color: var(--muted); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
button { font: 600 13px/1 inherit; font-family: inherit; border-radius: 8px; padding: 9px 12px; cursor: pointer; border: 1px solid var(--line);
         background: transparent; color: var(--ink); }
button.primary { background: var(--red); border-color: var(--red); color: #fff; }
button:disabled { opacity: .5; cursor: default; }
kbd { font: 11px ui-monospace, Menlo, monospace; opacity: .8; margin-left: 4px; }
.warnline { font-size: 12px; background: var(--amber); border-radius: 6px; padding: 6px 8px; }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function highlight(text: string): string {
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + esc(text.slice(last));
}

export interface OverlayActions {
  onInsertRedacted(): void;
  onInsertOriginal(): void;
  onCancel(): void;
}

export class Overlay {
  private host = document.createElement('redline-overlay');
  private root = this.host.attachShadow({ mode: 'closed' });
  private card: HTMLDivElement;
  private final = false;
  private pendingInsert = false;

  constructor(private actions: OverlayActions, private allowOverride: boolean, anchor?: DOMRect) {
    const style = document.createElement('style');
    style.textContent = CSS;
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', 'Redline redaction');
    // Never steal focus from the chat input: keep the caret where the user pasted.
    this.card.addEventListener('mousedown', (e) => e.preventDefault());
    // Sit just above the chat box that received the paste, right-aligned with it,
    // so the composer stays visible. Fall back to the bottom-right corner.
    if (anchor && anchor.top > 240) {
      this.card.style.bottom = `${Math.max(12, window.innerHeight - anchor.top + 10)}px`;
      this.card.style.right = `${Math.max(12, window.innerWidth - anchor.right)}px`;
    }
    this.root.append(style, this.card);
    document.documentElement.append(this.host);
    this.render(null);
  }

  get isFinal() {
    return this.final;
  }

  update(result: RedactionResult, final: boolean) {
    this.final = final;
    this.render(result);
    if (final && this.pendingInsert) this.actions.onInsertRedacted();
  }

  error(message: string) {
    this.card.innerHTML = `
      <div class="head"><span class="logo">Redline</span><span class="chip warn">Error</span></div>
      <div class="warnline">${esc(message)}</div>
      <div class="row"><button data-a="cancel">Close <kbd>Esc</kbd></button></div>`;
    this.bind();
  }

  /** Enter while Nano is still working: insert as soon as it finishes. */
  requestInsert() {
    if (this.final) this.actions.onInsertRedacted();
    else {
      this.pendingInsert = true;
      const btn = this.root.querySelector<HTMLButtonElement>('[data-a="redacted"]');
      if (btn) btn.textContent = 'Inserting when Nano finishes…';
    }
  }

  destroy() {
    this.host.remove();
  }

  private render(r: RedactionResult | null) {
    const count = r ? Object.keys(r.mapping).length : 0;
    const nanoStep = r?.trace.find((s) => s.step.includes('Nano'));
    const status = !r
      ? `<span class="chip pulse">🔒 Redacting on-device…</span>`
      : !this.final
        ? `<span class="chip pulse">🔒 Gemini Nano reviewing…</span>`
        : r.reducedProtection
          ? `<span class="chip warn">Patterns only</span>`
          : `<span class="chip">🔒 On-device · ${count} redacted</span>`;
    this.card.innerHTML = `
      <div class="head"><span class="logo">Redline</span>${status}</div>
      ${r ? `<pre class="text ${this.final ? '' : 'draft'}">${highlight(r.redacted)}</pre>` : `<pre class="text draft">Checking your paste…</pre>`}
      ${r && this.final && r.reducedProtection
        ? `<div class="warnline">Gemini Nano wasn't available, so only emails, numbers, IDs and amounts were removed. Names may remain.</div>`
        : ''}
      <div class="meta">${
        this.final
          ? `Your original text never left this device.${nanoStep?.ms ? ` Nano took ${(nanoStep.ms / 1000).toFixed(1)} s.` : ''}`
          : 'Numbers and emails are already removed; names and companies take a few seconds.'
      }</div>
      <div class="row">
        <button class="primary" data-a="redacted" ${r ? '' : 'disabled'}>${this.pendingInsert ? 'Inserting when Nano finishes…' : 'Insert redacted'} <kbd>Enter</kbd></button>
        ${this.allowOverride ? `<button data-a="original">Insert original</button>` : ''}
        <button data-a="cancel">Cancel <kbd>Esc</kbd></button>
      </div>`;
    this.bind();
  }

  private bind() {
    this.root.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'redacted') this.requestInsert();
        else if (a === 'original') this.actions.onInsertOriginal();
        else this.actions.onCancel();
      }),
    );
  }
}
