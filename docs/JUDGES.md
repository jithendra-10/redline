# Trying Redline (about 2 minutes)

## Option A: the extension (the real product)

**You need:** desktop Chrome 138 or newer. For on-device AI, check `chrome://on-device-internals` → **Use Cases** → `prompt_api` = **Available**. If it isn't, Redline still works, using pattern detection only, and says so.

1. Download **`redline-extension-1.0.0.zip`** from this repository's [Releases](https://github.com/jithendra-10/redline/releases) page and unzip it.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
4. Pin Redline from the puzzle-piece menu, then click its icon to open the side panel.
5. Open **https://gemini.google.com** (or ChatGPT or Claude). If the tab was already open, reload it.

**Things to try:**

| Do this | You'll see |
|---|---|
| Paste the sample below into the chat box | A **Redline card**: names, case number, company, amount, phone and email replaced on-device, with hints like `[FINANCIAL_1 · $1M–10M]`. Press **Enter** to insert the redacted version. |
| Send it, then click **Show real names** (top right) | The AI's reply shows the real names, in your tab only |
| Click **Check re-identification risk** in the card | Gemini reviews the **redacted** text (in the cloud, or on-device if the cloud is unavailable) and flags clues like "the only female partner in our Austin office" |
| Type *"how do I grow a YouTube channel with a 1k budget"* | The chip says **Nothing sensitive**, and Enter sends it with no interruption |
| Type a message with a person's name and email, then press Enter | The card opens instantly, because it was already checked while you typed |
| Open the side panel | Protection status, Pause for this site, this chat's redacted items, the active policy |

**Sample text:**
```
Hi, please tighten this email to opposing counsel:
"Our client Priya Shah (matter #LGL-2291) will not accept the Acme Corp settlement of $4.2M. As the only female partner in our Austin office, Ms. Shah has asked that all calls go to her cell +1 512-555-0148 or priya.shah@shahlegal.com."
```

No AI account? Use **https://redline-hybrid.web.app/mock-chat**, a test page whose "AI" just echoes your message. The extension works there too.

## Option B: no install

- **Playground:** https://redline-hybrid.web.app. Paste text and see the redaction, the routing trace (🔒 on-device / ☁ cloud) and local re-hydration. On-device AI in a normal web page may need `chrome://flags/#prompt-api` set to **Enabled**. Without it, only the pattern detectors run.
- **Accuracy eval:** https://redline-hybrid.web.app/eval. Runs 30 labelled legal, medical and HR samples on your device.
- **Admin console:** https://redline-hybrid.web.app/admin. The organisation's view: live policy and the content-free audit log (requires an admin account).

## What to look for in the code

- Hybrid routing and the privacy invariant: [`packages/core/src/ai.ts`](../packages/core/src/ai.ts), [`packages/core/src/pipeline.ts`](../packages/core/src/pipeline.ts), [`packages/core/src/placeholders.ts`](../packages/core/src/placeholders.ts) (`assertNoLeak`)
- Extension flow: [`apps/extension/src/content/index.ts`](../apps/extension/src/content/index.ts) (paste, send, quiet mode) and [`apps/extension/src/offscreen.ts`](../apps/extension/src/offscreen.ts) (the on-device worker)
- Tests: `npm test` (unit) and `npm run test:rules` (Firestore rules against the emulator)

---

### For the maintainer: building the release zip

1. In the Firebase console go to **App Check → Apps → ⋮ → Manage debug tokens → Add**, name it `judges`, and copy the value.
2. Create `Redline/.env.judges` (gitignored) containing one line: `VITE_APPCHECK_DEBUG_TOKEN=<that value>`.
3. Run `npm run package:extension`. The zip is written to `release/`.
4. Attach the zip to a GitHub Release. **Delete the `judges` debug token after judging ends.**
