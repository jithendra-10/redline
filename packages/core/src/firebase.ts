import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import {
  activate,
  fetchAndActivate,
  getRemoteConfig,
  getString,
  onConfigUpdate,
  type RemoteConfig,
} from 'firebase/remote-config';
import { policyFromValues, RC_DEFAULTS, type Policy } from './policy';

export interface RedlineConfig {
  firebase: FirebaseOptions;
  appCheck: {
    /** Web app only. Chrome extensions cannot load reCAPTCHA (MV3 remote-code ban). */
    recaptchaEnterpriseSiteKey?: string;
    /** Web app only. Classic reCAPTCHA v3 alternative (no billing account needed). */
    recaptchaV3SiteKey?: string;
    /** Registered in Firebase console > App Check > Manage debug tokens. */
    debugToken?: string;
  };
}

export interface RedlineFirebase {
  app: FirebaseApp;
  appCheck: AppCheck;
  ai: AI;
  remoteConfig: RemoteConfig;
}

export function initRedline(cfg: RedlineConfig): RedlineFirebase {
  if (cfg.appCheck.debugToken) {
    // Must be set before initializeAppCheck. Debug tokens are accepted by the hackathon rules.
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      cfg.appCheck.debugToken;
  }
  const app = initializeApp(cfg.firebase);

  // App Check still calls provider.initialize() in debug mode, so the extension uses a
  // CustomProvider that never loads remote scripts; the debug token is what gets exchanged.
  const provider = cfg.appCheck.recaptchaEnterpriseSiteKey
    ? new ReCaptchaEnterpriseProvider(cfg.appCheck.recaptchaEnterpriseSiteKey)
    : cfg.appCheck.recaptchaV3SiteKey
    ? new ReCaptchaV3Provider(cfg.appCheck.recaptchaV3SiteKey)
    : new CustomProvider({
        getToken: () =>
          Promise.reject(new Error('No App Check attestation provider: set VITE_APPCHECK_DEBUG_TOKEN.')),
      });
  const appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const remoteConfig = getRemoteConfig(app);
  remoteConfig.defaultConfig = RC_DEFAULTS;
  remoteConfig.settings.minimumFetchIntervalMillis = 60_000;

  return { app, appCheck, ai, remoteConfig };
}

/**
 * Loads the org policy and keeps it live: Remote Config real-time updates push
 * policy changes to every open client without a reload or extension update.
 */
export async function watchPolicy(
  rc: RemoteConfig,
  onPolicy: (p: Policy) => void,
): Promise<() => void> {
  const read = () => policyFromValues((k) => getString(rc, k));
  try {
    await fetchAndActivate(rc);
  } catch (e) {
    console.warn('[redline] Remote Config fetch failed, using defaults', e);
  }
  onPolicy(read());
  try {
    return onConfigUpdate(rc, {
      next: async () => {
        await activate(rc);
        onPolicy(read());
      },
      error: (e) => console.warn('[redline] Remote Config realtime error', e),
      complete: () => {},
    });
  } catch (e) {
    console.warn('[redline] Remote Config realtime unavailable', e);
    return () => {};
  }
}
