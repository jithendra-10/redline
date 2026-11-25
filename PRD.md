# Redline — Product Requirements Document

**Hackathon:** #BuildHybridAI 2026 (Firebase AI Logic Hybrid Inference)
**Track:** Best Web/Chrome App (primary) · Grand Prize (eligible)
**Platform:** Chrome Extension (Manifest V3) + hosted web "Playground & Admin Console"
**Deadline:** Dec 1, 2026
**Status:** Draft v1 — 2026-11-25

---

## 1. One-liner

**Redline is a privacy firewall for AI chat.** When a professional pastes confidential text into ChatGPT, Gemini, Claude or any AI chat box, Redline uses **Gemini Nano on-device** to strip names, client IDs, diagnoses and salaries *before the text leaves the laptop*. It only escalates **already-redacted** text to Gemini in the cloud for a deeper "is this still re-identifiable?" check.

> Using on-device AI to protect you from cloud AI.

## 2. Problem

- Lawyers, clinicians, HR staff, consultants and finance teams paste sensitive data into public AI tools daily ("shadow AI"). One paste can breach attorney–client privilege, HIPAA, GDPR or an NDA.
- Current options all fail in some way:
  - **Ban AI tools:** employees use them anyway on personal devices.
  - **Cloud DLP / redaction APIs:** you have to send the secret to *another* cloud to find out it's secret. That's the same problem again.
  - **Regex-only redaction:** misses context ("the only female partner in our Austin office", "the patient in bed 4 with the rare condition").
- **Audience:** small and mid-size professional firms (law firms, clinics, HR consultancies) that have no enterprise DLP budget.

## 3. Why hybrid (the core argument for judges)

| Concern | Pure cloud | Pure local | **Redline hybrid** |
|---|---|---|---|
| Privacy | ❌ Raw secret leaves device to be scanned | ✅ | ✅ Raw text **never** leaves the device |
| Latency on every paste | ❌ 1–3 s round trip on each paste | ✅ | ✅ Nano redacts in-line |
| Cost at scale (every paste, every employee) | ❌ Expensive | ✅ Free | ✅ ~90% of calls are free/local |
| Subtle re-identification reasoning | ✅ | ❌ Nano too small | ✅ Cloud sees **only placeholders** |
| Device without Nano (old laptop, unsupported Chrome) | ✅ | ❌ Broken | ✅ Falls back; see §7.3 |

**Routing rule:** sensitive raw text → on-device only. Abstracted or redacted text → cloud allowed.

## 4. Goals and non-goals

**Goals (MVP)**
1. Intercept pastes into AI chat inputs on supported sites and redact them on-device in under 2 s on a typical Nano-capable laptop.
2. Use consistent, reversible placeholders (`[PERSON_1]`, `[CLIENT_ID_1]`) so the AI's answer can be **re-hydrated locally** with the real values.
3. Run a cloud "re-identification risk" check on the *redacted* text, giving a score with reasons.
4. Let an org admin push redaction policy to all users instantly via **Remote Config**.
5. Keep a privacy-safe audit trail (counts and categories only, never content) in **Firestore**.
6. Provide a hosted **Playground** so judges can try it without installing the extension.

**Non-goals (MVP)**
- File uploads, images or PDFs (text paste only).
- Enterprise SSO, MDM deployment or SIEM export.
- A guarantee of compliance. Redline reduces risk; it is not legal certification.
- Mobile (Android port listed as a stretch goal, §12).

## 5. Personas

- **Priya, associate lawyer:** wants ChatGPT to tighten a client email without leaking the client's name or matter number.
- **Dr. Mehta, clinic physician:** wants an AI summary of a referral letter without sending patient identifiers.
- **Sam, IT/ops lead at a 40-person firm:** wants one switch to enforce "always redact health data" for everyone, and proof that it's working.

## 6. User stories

| # | As a… | I want… | So that… |
|---|---|---|---|
| U1 | User | my paste into an AI chat to be redacted automatically | secrets never leave my machine |
| U2 | User | to see a before/after diff and approve or undo it | I stay in control |
| U3 | User | the AI's reply to show real names again (locally) | the output is usable |
| U4 | User | a risk score saying whether the redacted text could still identify someone | I catch what regex and Nano missed |
| U5 | User | it to still work offline or on a plane (local redaction) | privacy doesn't depend on network |
| U6 | Admin | to set which entity types are redacted, plus strictness | policy fits our industry |
| U7 | Admin | a dashboard of redaction counts per category, with no content | I can prove compliance |
| U8 | Judge or visitor | to try it in a web page with no install | I can evaluate it quickly |

## 7. Functional requirements

### 7.1 Paste interception (content script)
- FR1: Listen for `paste` events on `textarea` and `contenteditable` inputs on a site allowlist (chatgpt.com, gemini.google.com, claude.ai, copilot.microsoft.com, perplexity.ai). The list is configurable via Remote Config.
- FR2: Pastes under a minimum length (default 40 characters, Remote Config) pass through untouched.
- FR3: Otherwise, prevent the default paste, show a **Redline overlay** (shadow DOM) and run the redaction pipeline.
- FR4: The user chooses **Insert redacted** (default, Enter), **Insert original** (logged as override) or **Cancel**.

### 7.2 Redaction pipeline (on-device first)
1. **Deterministic pass (local, instant):** regex and checksum detectors for email, phone, credit card (Luhn), IBAN, SSN/Aadhaar/NHS-style IDs, dates of birth and URLs with tokens.
2. **Semantic pass (Gemini Nano via Firebase AI Logic hybrid, `ONLY_ON_DEVICE` for raw text):** prompt with a JSON schema returning `{entities:[{text, type, confidence}]}` for types such as PERSON, ORG, CLIENT/MATTER, MEDICAL_CONDITION, MEDICATION, SALARY/FINANCIAL, ADDRESS and PROJECT_CODENAME, filtered by policy.
3. **Placeholder mapping:** consistent per session (`Acme Corp` → `[ORG_1]` everywhere). The mapping is stored only in `chrome.storage.session`, never synced.
4. **Raw text is never sent to the cloud.** If Nano is unavailable, Redline falls back to the deterministic pass only and shows a "Reduced protection" badge (see §7.3).

### 7.3 Hybrid routing and fallback
- Raw-text calls use **only on-device** inference. This is a hard privacy invariant enforced in code and called out in the demo.
- Redacted-text calls use **prefer on-device**, falling back to cloud. The re-identification check uses **cloud** by default because it needs stronger reasoning. Remote Config can switch it to on-device for "air-gapped mode".
- If Nano is unavailable or still downloading, the user gets the regex-only redaction plus an option to "Ask cloud to review **redacted** draft". The cloud never sees the original.
- The UI shows where each step ran: 🔒 *On-device* / ☁️ *Cloud (redacted only)*.

### 7.4 Re-identification risk check (cloud)
- FR5: Send the redacted text plus entity-type summary to Gemini (cloud) through Firebase AI Logic and get back `{risk: low|medium|high, reasons[], suggested_extra_redactions[]}`.
- FR6: Show suggestions as one-click extra redactions.

### 7.5 Local re-hydration
- FR7: A "Reveal" toggle in the overlay or extension side panel swaps placeholders in the AI's visible reply back to the real values, **in the local DOM only**.

### 7.6 Policy via Remote Config
Parameters (per org, by condition):
- `redline_entity_types` (JSON list), `redline_strictness` (`lenient|balanced|strict`)
- `redline_min_paste_chars`, `redline_site_allowlist`
- `redline_reid_check_mode` (`cloud|on_device|off`), `redline_allow_override` (bool)
- `redline_nano_confidence_threshold` (below this, the entity is flagged for user review)

### 7.7 Audit log (Firestore)
- Doc per event: `{orgId, uidHash, ts, site, entityCounts:{PERSON:2,...}, routing:{local:n, cloud:m}, riskLevel, override:bool}`.
- **No text, no placeholders, no mapping values.** Firestore Security Rules enforce the schema (reject any doc with string fields over 64 chars).

### 7.8 Web app (Firebase Hosting)
- **Playground:** paste box, the same pipeline, a visual diff and an on-device/cloud routing trace. This is the zero-install demo for judges.
- **Admin Console:** sign-in (Auth), edit org policy (writes to a Firestore `policies` doc mirrored to Remote Config; for the MVP this can be done directly in the Firebase console), and an audit dashboard of counts by category, override rate and local vs. cloud ratio with an estimated "$ saved / bytes kept local".

## 8. Firebase stack

| Product | Role |
|---|---|
| **Firebase AI Logic (Hybrid Inference)** | Nano on-device redaction and cloud re-identification check, one SDK, with explicit inference modes per call |
| **App Check** | Protects AI Logic and Firestore. A debug token is used in the extension (allowed by rules). The web app uses reCAPTCHA Enterprise. |
| **Remote Config** | Org redaction policy, site allowlist, routing mode and thresholds, all live without an extension update |
| **Firestore** | Content-free audit events and org/user profile |
| **Authentication** | Google sign-in for the admin console and to link the extension to an org |
| **Hosting** | Playground and admin console URL for judges |

## 9. Architecture

```
┌──────────── Chrome (user's laptop) ─────────────────────────────┐
│ Content script (chat sites) ──paste──▶ Overlay UI (shadow DOM)   │
│        │                                                         │
│        ▼                                                         │
│ Offscreen doc / side panel: Redline Core (shared TS package)     │
│   1. Regex detectors ───────────────────────── local             │
│   2. Firebase AI Logic ── ONLY_ON_DEVICE ──▶ Gemini Nano  🔒      │
│   3. Placeholder map (chrome.storage.session)                    │
│   4. Firebase AI Logic ── cloud, REDACTED text only ──▶ Gemini ☁️ │
│   5. Remote Config (policy) · Firestore (counts) · App Check     │
└──────────────────────────────────────────────────────────────────┘
Hosted web app (Firebase Hosting): Playground + Admin, same Redline Core.
```

- Monorepo: `packages/core` (pipeline, prompts, schema), `apps/extension` (MV3, Vite/CRXJS), `apps/web` (Vite + React).
- **Spike on Day 1:** confirm the Firebase AI Logic hybrid SDK runs inside an MV3 extension context (side panel or offscreen doc) with Nano available. If not, run the core in the side panel page, which is a normal extension page with Prompt API access.

## 10. UX principles
- **Zero-friction default:** Enter inserts the redacted text. Protection should cost one keypress.
- **Show the boundary:** every result shows a 🔒/☁️ trace and "0 bytes of raw text sent to cloud".
- **Calm, legal-pad aesthetic:** red underline motif (the "redline"), diff view similar to tracked changes.

## 11. Success metrics (demo-level)
- Redaction recall on a 30-sample seeded test set (legal, medical, HR): **≥ 90%** with deterministic + Nano, ≥ 95% after the cloud suggestion pass.
- Median on-device redaction latency **< 2 s** for under 1,500 characters.
- **100%** of cloud calls contain zero original entity strings, verified by an automated test that scans outbound payloads.
- Local vs. cloud call ratio of at least 3:1 in the demo session.

## 12. Scope and 5-day plan

| Day | Deliverable |
|---|---|
| **1 (Nov 26)** | Firebase project, AI Logic, App Check debug token. Hybrid SDK spike in extension and web. Monorepo scaffold. |
| **2 (Nov 27)** | Core pipeline: regex + Nano entity extraction (JSON schema), placeholder map, unit tests and seeded dataset. |
| **3 (Nov 28)** | Content script paste interception, overlay diff UI, cloud re-identification check, re-hydration. |
| **4 (Nov 29)** | Remote Config policy, Firestore audit + rules, Auth, admin dashboard, Playground on Hosting. |
| **5 (Nov 30)** | Polish, airplane-mode path, README, **make repo public + Apache-2.0**, record the 3-minute video. Submit by Dec 1. |

**Stretch (only if ahead):** an Android companion (share-sheet "Redact before sharing") using the Firebase AI Logic Android hybrid SDK, to strengthen the multi-platform Grand Prize case.

**Cut order if behind:** re-hydration → admin dashboard charts → Auth (use anonymous) → site allowlist editing.

## 13. Demo video script (≤ 3:00)
1. **0:00–0:20 Hook:** "Last year, employees pasted confidential data into chatbots millions of times. Redline stops that, using AI that never leaves your laptop."
2. **0:20–1:10:** Lawyer pastes a client email into ChatGPT. The overlay shows the diff and the 🔒 on-device trace. Insert. ChatGPT replies with placeholders. Click Reveal and the real names appear locally.
3. **1:10–1:40:** Cloud re-identification check flags "only female partner in Austin office" as high risk. One-click extra redaction. Trace shows ☁️ received redacted text only.
4. **1:40–2:10:** Turn on airplane mode. Paste a medical note. Still redacted on-device.
5. **2:10–2:40:** Admin flips `strictness=strict` + adds MEDICATION in Remote Config. The next paste reflects it instantly. Dashboard shows counts, local:cloud ratio and zero bytes of raw text.
6. **2:40–3:00:** Architecture slide (hybrid split) and close.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hybrid SDK or Nano not usable in an MV3 context | Day-1 spike. Run the core in a side panel or extension page. The web Playground is the fallback demo. |
| Nano misses entities or returns bad JSON | Deterministic pass first, schema-constrained output, retry once, confidence threshold → user review |
| Chat sites' editors (ProseMirror, contenteditable) fight inserted text | Insert via `execCommand('insertText')` / synthetic `InputEvent`. Test ChatGPT and Gemini first, cut others if needed. |
| Nano model download takes time during the demo | Pre-download before recording. Show the "Reduced protection" fallback as a feature. |
| Judges can't install the extension | Hosted Playground plus an unpacked-install guide and a packaged zip in GitHub Releases |
| Repo must be public at submission | Created private now; **switch to public + Apache-2.0 before submitting** |

## 15. Submission checklist
- [ ] Working extension and hosted Playground URL
- [ ] **Public** GitHub repo with an Apache-2.0 LICENSE visible in the About section
- [ ] Firebase AI Logic imported **and called at runtime** (`packages/core/src/ai.ts`)
- [ ] App Check enabled (debug token documented in README setup)
- [ ] README: value proposition, setup, architecture, hybrid routing explanation
- [ ] Public YouTube demo of 3 minutes or less, in English
- [ ] Devpost text description: AI Logic usage, features, value proposition. Platform: Web/Chrome.
