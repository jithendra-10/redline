# Redline setup (≈15 minutes)

You need a Firebase project, a web app registered in it, AI Logic enabled, and an App Check debug token.

## 1. Firebase project
1. Go to https://console.firebase.google.com → **Add project** → name it `redline-hybrid` (Google Analytics: optional).
2. **Project settings → General → Your apps → Web (`</>`)** → register app `redline-web`. Copy the config values.
3. Copy `.env.example` to `.env` in the repo root and paste the values into the `VITE_FIREBASE_*` lines.

## 2. Firebase AI Logic
1. Console → **AI Logic** (Build menu) → **Get started**.
2. Choose the **Gemini Developer API** (free tier). It enables the API and creates the key for you.
3. Leave the cloud model as the default. Redline uses `gemini-3.5-flash-lite`, which you can change with the Remote Config key `redline_cloud_model`.

## 3. App Check (required by AI Logic)
1. Console → **AI Logic → Register for App Check** (or **Security → App Check → Apps → redline-web**). Pick one provider:
   - **reCAPTCHA v3 (simplest, no billing):** go to https://www.google.com/recaptcha/admin/create, choose type *Score based (v3)*, and add domains `localhost`, `redline-hybrid.web.app` and `redline-hybrid.firebaseapp.com`. Paste the **secret key** into the Firebase dialog and the **site key** into `VITE_RECAPTCHA_V3_SITE_KEY`.
   - **reCAPTCHA Enterprise:** create a Website key with the same domains at https://console.cloud.google.com/security/recaptcha?project=redline-hybrid, paste the key ID into the Firebase dialog and into `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
2. In the same app row: **⋮ → Manage debug tokens → Add debug token**. Generate a UUID, save it, and put it in `VITE_APPCHECK_DEBUG_TOKEN`. The Chrome extension *needs* this, because extensions can't load reCAPTCHA. The hackathon rules accept debug tokens.
3. **App Check → APIs → Firebase AI Logic → Enforce**, once the app works.

## 4. Remote Config (policy)
Console → **Remote Config → Create configuration**, then add these parameters. Real-time updates reach open clients within seconds.

| Key | Example value |
|---|---|
| `redline_strictness` | `balanced` (`lenient` / `strict`) |
| `redline_entity_types` | `["PERSON","ORG","CLIENT_ID","EMAIL","PHONE","MEDICAL_CONDITION","MEDICATION","FINANCIAL"]` |
| `redline_reid_check_mode` | `cloud` (`on_device` / `off`) |
| `redline_min_paste_chars` | `40` |
| `redline_nano_confidence_threshold` | `0.5` |
| `redline_cloud_model` | `gemini-3.5-flash-lite` |
| `redline_keep_meaning` | `true` (hints like `[ORG_1 · hospital]`; `false` = bare placeholders) |

## 5. Chrome with Gemini Nano
- Use Chrome **138+** on desktop (Windows/macOS/Linux) with **22 GB free disk space** and a GPU with more than 4 GB VRAM (or a 16 GB RAM / 4-core CPU).
- Open `chrome://on-device-internals` to check the model status.
- If the Prompt API is not available to web pages on `localhost` in your Chrome version, enable `chrome://flags/#prompt-api-for-gemini-nano` and restart. Extensions get it without flags.
- The first run downloads Nano. Click **Download Nano** in Redline (Chrome requires a click to start the download).

## 6. Run
```powershell
npm install
npm run dev:web          # Playground at http://localhost:5173 (accuracy eval: /eval.html)
npm run build            # builds apps/web/dist and apps/extension/dist
npm test                 # core unit tests
```
**Load the extension:** go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `apps/extension/dist`. After every `npm run build`, click the extension's reload icon there.

**Use it:** paste anything longer than 40 characters into ChatGPT, Gemini, Claude, Copilot or Perplexity. The Redline card shows the on-device redaction:
- **Enter** inserts the redacted text (if Nano is still working, it waits and inserts the final version).
- **Esc** cancels and inserts nothing.
- **Insert original** is available unless `redline_allow_override` is `false`.

After your first redacted paste, a **Redline · Show real names** pill appears top-right. It swaps placeholders in the AI's replies back to real values, in that tab only.

**No account handy?** Open `http://localhost:5173/mock-chat.html` (with `npm run dev:web` running). It is a ChatGPT-like page whose "AI" echoes your message, and the extension works on it too.

## 7. Audit log, admin console and Hosting (Day 4)

All of these are free on the Spark plan; no billing is needed.

1. **Firestore:** Console → **Build → Firestore Database → Create database**. Choose a location near you (e.g. `asia-south1`, Mumbai) and start in **production mode**. Our rules replace the defaults on deploy.
2. **Authentication:** Console → **Build → Authentication → Get started → Sign-in method**. Enable:
   - **Anonymous**: the extension signs in anonymously to write audit events.
   - **Google**: admins sign in to the console. Pick your support email when asked.
3. **Deploy rules + site** (in a terminal, from the `Redline` folder):
   ```powershell
   npx firebase login
   ```
   ```powershell
   npm run deploy
   ```
   This builds the web app and deploys `firestore.rules` and Firebase Hosting. The Playground is then at `https://redline-hybrid.web.app`, the admin console at `/admin`, and the eval at `/eval`.
4. **Make yourself admin:** open `https://redline-hybrid.web.app/admin` (or `http://localhost:5173/admin.html`) and sign in with Google. The page shows your user ID. In the Console, go to **Firestore → Start collection** `admins`, set the **Document ID** to that user ID, add a field `role` = `admin`, and save. Then reload the admin page.

**Testing locally without touching the real project:**
```powershell
npm run emulators
```
```powershell
npm run dev:web:emu
```
Then open `http://localhost:5174/admin.html`. To test the security rules:
```powershell
npm run test:rules
```
