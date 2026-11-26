export {};
// A tiny ChatGPT-like page for testing the Redline extension without an account.
// The composer is a contenteditable (like ChatGPT/Claude); the "AI" echoes placeholders back.
const log = document.getElementById('log')!;
const composer = document.getElementById('prompt')!;
const form = document.getElementById('f') as HTMLFormElement;

function add(who: 'me' | 'ai', text: string) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  const label = document.createElement('span');
  label.className = 'who';
  label.textContent = who === 'me' ? 'You' : 'Mock AI';
  div.append(label, document.createTextNode(text));
  log.append(div);
  div.scrollIntoView({ block: 'end' });
}

// Like real editors: handle paste ourselves (plain text only).
composer.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') ?? '';
  document.execCommand('insertText', false, text);
});

function send() {
  const text = composer.innerText.trim();
  if (!text) return;
  add('me', text);
  composer.textContent = '';
  const placeholders = [...new Set(text.match(/\[[A-Z_]+_\d+(?: · [^\]]+)?\]/g) ?? [])];
  const reply = placeholders.length
    ? `Here's a tighter version:\n\n${text}\n\n(I only saw ${placeholders.length} placeholders, never the real values.)`
    : `Here's a tighter version:\n\n${text}`;
  // Stream the reply like a real chatbot, so Reveal is tested on live updates.
  const div = document.createElement('div');
  div.className = 'msg ai';
  const label = document.createElement('span');
  label.className = 'who';
  label.textContent = 'Mock AI';
  const body = document.createTextNode('');
  div.append(label, body);
  log.append(div);
  let i = 0;
  const timer = setInterval(() => {
    i = Math.min(reply.length, i + 12);
    body.nodeValue = reply.slice(0, i);
    div.scrollIntoView({ block: 'end' });
    if (i >= reply.length) clearInterval(timer);
  }, 30);
}

form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
