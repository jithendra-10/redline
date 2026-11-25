import type { RedlineConfig } from '@redline/core';

/** Builds the Firebase config from Vite env vars. Returns null when not configured. */
export function configFromEnv(env: Record<string, string | undefined>, surface: 'web' | 'extension'): RedlineConfig | null {
  if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_APP_ID) return null;
  return {
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    },
    appCheck: {
      // Extensions can't load reCAPTCHA; they rely on the debug token.
      recaptchaEnterpriseSiteKey: surface === 'web' ? env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || undefined : undefined,
      recaptchaV3SiteKey: surface === 'web' ? env.VITE_RECAPTCHA_V3_SITE_KEY || undefined : undefined,
      debugToken: env.VITE_APPCHECK_DEBUG_TOKEN || undefined,
    },
  };
}
