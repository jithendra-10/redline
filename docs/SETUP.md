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
1. Console → **App Check → Apps → redline-web → reCAPTCHA Enterprise** → create a key for `localhost` (and your Hosting domain later). Put the site key in `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
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

## 5. Chrome with Gemini Nano
- Use Chrome **138+** on desktop (Windows/macOS/Linux) with **22 GB free disk space** and a GPU with more than 4 GB VRAM (or a 16 GB RAM / 4-core CPU).
- Open `chrome://on-device-internals` to check the model status.
- If the Prompt API is not available to web pages on `localhost` in your Chrome version, enable `chrome://flags/#prompt-api-for-gemini-nano` and restart. Extensions get it without flags.
- The first run downloads Nano. Click **Download Nano** in Redline (Chrome requires a click to start the download).

## 6. Run
```powershell
npm install
npm run dev:web          # Playground at http://localhost:5173
npm run build            # builds apps/web/dist and apps/extension/dist
npm test                 # core unit tests
```
**Load the extension:** go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `apps/extension/dist`. Then click the Redline icon to open the side panel.
