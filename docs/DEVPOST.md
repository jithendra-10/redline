# Devpost submission text

Copy each section into the matching Devpost field.

---

## Project name
Redline: Privacy Firewall for AI Chat

## Elevator pitch (200 characters max)
Paste into ChatGPT without leaking secrets. Gemini Nano redacts names, IDs and health data on-device; only redacted text reaches Gemini in the cloud for a re-identification check.

## Platform
Web (Chrome): Chrome extension + web app

---

## Inspiration
Every day, lawyers paste client emails into ChatGPT, clinicians paste referral letters, and HR teams paste termination notes. Each paste can break privilege, health-privacy rules or an NDA, and banning AI tools just pushes people onto personal devices. The existing fixes have a built-in contradiction: cloud data-loss-prevention services have to *see* the secret in order to find it. We wanted protection that runs **before** anything leaves the laptop. That's exactly what on-device AI makes possible.

## What it does
Redline is a Chrome extension that sits between you and AI chatbots (ChatGPT, Gemini, Claude, Copilot, Perplexity).

- **Catches pastes and typed messages.** A small chip on the chat box shows Redline is on and checks the message in the background while you type.
- **Redacts on-device with Gemini Nano.** Names, case and patient numbers, contacts, addresses, diagnoses, medications, account numbers and project codenames are replaced before anything is sent.
- **Keeps the meaning.** Placeholders carry safe hints, such as `[ORG_1 · hospital]`, `[FINANCIAL_1 · $1M–10M]` or `[DATE_OF_BIRTH_1 · born 1960s]`, so the chatbot's answer stays useful.
- **Stays quiet for everyday questions.** If nothing identifies anyone, the message goes through with no interruption.
- **Checks re-identification in the cloud, safely.** Only the *redacted* text goes to Gemini in the cloud, which catches clues like "the only female partner in our Austin office". If the cloud is unavailable, the SDK falls back to Nano automatically.
- **Restores real names locally.** "Show real names" swaps the placeholders in the AI's reply back to real values, in your tab only.
- **Gives organisations control.** Admins set policy live through Remote Config and see a privacy-safe audit log (counts only, never content) in a web console.

## How we built it
- **Firebase AI Logic hybrid inference** is the core:
  - entity extraction runs with `InferenceMode.ONLY_ON_DEVICE`, so raw text can physically only go to Gemini Nano;
  - the re-identification check uses `PREFER_IN_CLOUD`, with the SDK's automatic fallback to Nano;
  - each response's `inferenceSource` drives the 🔒/☁ labels in the UI, so the routing shown is what actually happened.
- **Privacy invariant in code:** `assertNoLeak` checks every cloud payload against the original values and refuses to send. The extraction model rejects any response that didn't run on-device.
- **Hybrid within the device, too:** deterministic pattern detectors (emails, phones, IDs, IBANs, amounts) run first and are authoritative. Nano handles what patterns can't. Sanity rules reject implausible Nano labels, and Nano is pinned to deterministic decoding inside the extension.
- **MV3 architecture:** a ~31 KB content script on chat sites (no Firebase) talks over an internal port to an offscreen worker that hosts Firebase and Gemini Nano.
- **Remote Config** delivers the organisation's policy live (strictness, entity types, quiet mode, keep-meaning, allow override).
- **Firestore** holds the audit log. Its security rules make it impossible to store text: every field is typed, and this is verified by emulator tests that try to smuggle text in.
- **App Check** (reCAPTCHA Enterprise on the web, a debug token in the extension), **Authentication** (anonymous for the extension, Google for admins) and **Hosting** (Playground, admin, eval, mock chat).
- TypeScript monorepo, React, Vite. 46 unit tests plus 9 security-rules tests.

## Challenges we ran into
- **Making a small on-device model trustworthy.** Nano's labels vary from run to run, and it sometimes mislabels short words ("no" as a medical condition, "10k" as a person). We built a labelled eval of 30 samples and 137 spans and fixed every failure class it revealed, with rules Nano can't override.
- **Hung on-device calls.** A timed-out Nano call kept running and blocked every call queued behind it. We found that the SDK passes `promptOptions` by reference to Chrome's `session.prompt()`, attached a real `AbortSignal` per call, and queued on-device work.
- **Keeping meaning without leaking.** Bare placeholders make chatbot answers worse. Meaning hints help, but a hint must never echo the original ("Mary's hospital" for "St. Mary's Hospital"), so every hint is checked against the value it replaces.
- **Rewriting text inside other sites' editors** (ProseMirror, Quill) without breaking them. Redline re-dispatches the site's own paste event.

## Accomplishments that we're proud of
- **35.8% → 95.6–99.3% recall**: pattern rules alone versus rules plus on-device Gemini Nano, over three runs, with a ~5.5 s median, and nothing leaving the laptop.
- Real hybrid routing, visible in the product: when the cloud call failed, the SDK fell back to Nano and the card said so honestly.
- An audit log whose security rules are tested against attempts to sneak text in.

## What we learned
On-device AI is at its best as one layer of a system: fast, private and free, but bounded by deterministic rules and measured with a real eval. Hybrid inference isn't only "offline fallback". The most useful split was **raw data stays local, abstracted data may go to the cloud**.

## What's next
- File and PDF uploads, and Google Docs and Gmail compose.
- Per-industry policy presets (legal, healthcare, HR) and enterprise rollout through Chrome policy.
- Android: the same core, using Firebase AI Logic's on-device inference on Android.

## Built with
firebase-ai-logic, gemini-nano, gemini, firebase-app-check, firebase-remote-config, cloud-firestore, firebase-authentication, firebase-hosting, chrome-extension, prompt-api, typescript, react, vite

## Links
- Live app: https://redline-hybrid.web.app
- Code: https://github.com/jithendra-10/redline
- Try it: docs/JUDGES.md in the repo
