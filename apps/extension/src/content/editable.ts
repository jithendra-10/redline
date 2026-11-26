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
