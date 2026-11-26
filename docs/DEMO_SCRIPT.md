# Demo video script (3:00 max, English)

**Setup before recording**
- Chrome with only the Redline tabs you need: Gemini (fresh chat), the Firebase console on Remote Config, and `redline-hybrid.web.app/admin` (signed in).
- Reload the extension, then reload the Gemini tab. Paste once and discard, so Nano is warm.
- Have the sample texts in a notepad, ready to copy.
- Record at 1080p. Zoom the browser to 110–125% so the card is readable.
- Keep voice-over to the lines below; they're about 2:45 spoken at a normal pace.

---

### 0:00–0:15 · The problem (talking over the Gemini tab)
> "Every day, lawyers, doctors and HR teams paste confidential text into AI chatbots. One paste can break client privilege or health privacy. Banning AI doesn't work, and cloud filters have to see the secret to find it."

### 0:15–0:55 · Paste → on-device redaction
**Do:** copy the legal sample and paste it into Gemini. The card appears; let the "Gemini Nano reviewing" moment show.
> "Redline is a Chrome extension. When I paste, it holds the text and runs Gemini Nano, on this laptop, through Firebase AI Logic. Names, case number, company, phone and email are replaced before anything is sent."

**Point at** `[FINANCIAL_1 · $1M–10M]` and `[ORG_1 · company]`:
> "The placeholders keep the meaning, so Gemini knows it's a multi-million settlement without seeing the number."

**Do:** press Enter, then send.

### 0:55–1:20 · The cloud only sees redacted text
**Do:** paste the same text again, then click **Check re-identification risk**.
> "This is the hybrid part. The redacted text, and only that, goes to Gemini in the cloud, which spots that 'the only female partner in our Austin office' still identifies her. If the cloud isn't available, Firebase falls back to Nano automatically, and the card tells you where it ran."

**Do:** click **Also redact "Austin"**, then Esc.

### 1:20–1:40 · Real names come back, locally
**Do:** scroll to Gemini's reply to the first message and click **Show real names**.
> "Gemini answered with placeholders. Redline puts the real names back, only in my tab. The mapping never leaves this browser."

### 1:40–2:05 · Typing, and staying out of the way
**Do:** type "how do I grow a YouTube channel with a 1k budget". The chip turns green, *Nothing sensitive*. Press Enter; it sends.
> "It also checks what I type, while I type. Everyday questions go straight through."

**Do:** type "Email Priya Shah at priya@acme.io about the contract". The chip shows *2 items*. Press Enter and the card is instant.
> "Anything identifying gets caught, and because it was checked while I typed, there's no wait."

### 2:05–2:35 · Organisation control: Remote Config + Firestore
**Do:** in the Firebase console, set `redline_allow_override` to `false` and publish. Switch to Gemini and paste: **Insert original** is gone.
> "Admins set policy in Remote Config. It reaches every laptop in seconds, with no update."

**Do:** show the admin dashboard tiles and "What was removed".
> "The audit log in Firestore stores counts only. Our security rules make it impossible to store what anyone pasted, and we test that."

### 2:35–2:55 · Proof and close
**Do:** show the eval page summary (pre-run) or the README accuracy table.
> "On 30 labelled legal, medical and HR samples, rules alone catch 36%. With Gemini Nano on-device, 96 to 99%, in about five seconds. Redline: use AI at work without handing it your clients' secrets."

---

**Captions:** upload English subtitles (YouTube auto-captions, then fix names like "Redline" and "Gemini Nano").
**Upload:** YouTube, **Public** (not unlisted), then add the link to Devpost.
