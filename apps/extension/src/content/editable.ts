/** Helpers for reading/writing the chat input on ChatGPT, Gemini, Claude, Copilot, Perplexity. */

export type Editable = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

export function editableFrom(target: EventTarget | null): Editable | null {
  if (!(target instanceof Element)) return null;
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'search')) return target;
  const ce = target.closest<HTMLElement>('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
  return ce ?? null;
}

export interface SavedSelection {
  restore(): void;
}

export function saveSelection(el: Editable): SavedSelection {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    return {
      restore() {
        el.focus();
        el.setSelectionRange(start, end);
      },
    };
  }
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  return {
    restore() {
      el.focus();
      if (range) {
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      }
    },
  };
}

/**
 * Insert text the way the site's own editor expects. We re-dispatch a synthetic
 * paste (ProseMirror/Quill/Lexical all handle it natively, keeping line breaks).
 * If the editor ignores it, fall back to setRangeText / insertText.
 * Our paste listener ignores untrusted events, so this never loops.
 */
export function insertText(el: Editable, saved: SavedSelection, text: string): void {
  saved.restore();
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  const handledByEditor = !el.dispatchEvent(ev);
  if (handledByEditor) return;

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  document.execCommand('insertText', false, text);
}

/** Current text of a chat composer. */
export function getText(el: Editable): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.innerText ?? el.textContent ?? '';
}

/** Selects the whole composer so the next insert replaces everything. */
export function selectAll(el: Editable): SavedSelection {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.setSelectionRange(0, el.value.length);
  } else {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  return saveSelection(el);
}

/** Send buttons on ChatGPT, Gemini, Claude, Copilot, Perplexity and generic forms. */
const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="Submit" i]',
  'button.send-button',
  'button[type="submit"]',
].join(',');

export function isSendButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLButtonElement>(SEND_SELECTORS);
}

/** Finds the send button that belongs to this composer (nearest form / container). */
export function findSendButton(el: Editable): HTMLButtonElement | null {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    const btn = node.querySelector<HTMLButtonElement>(SEND_SELECTORS);
    if (btn) return btn;
  }
  return document.querySelector<HTMLButtonElement>(SEND_SELECTORS);
}

/** Submits the composer: click its send button, or fall back to an Enter keypress. */
export function submit(el: Editable): void {
  const btn = findSendButton(el);
  if (btn && !btn.disabled) {
    btn.click();
    return;
  }
  el.focus();
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
}
