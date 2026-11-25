import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addRedactions,
  checkReidRisk,
  createModels,
  DEFAULT_POLICY,
  extractEntitiesOnDevice,
  getDeviceStatus,
  initRedline,
  prepareDevice,
  redact,
  reviewRisk,
  warmUpDevice,
  watchPolicy,
  type DeviceStatus,
  type Entity,
  type Policy,
  type RedactionResult,
  type RedlineConfig,
  type RedlineFirebase,
  type RiskReport,
} from '@redline/core';

let singleton: RedlineFirebase | null = null;
function getFirebase(config: RedlineConfig | null): RedlineFirebase | null {
  if (!config) return null;
  singleton ??= initRedline(config);
  return singleton;
}

export interface Stats {
  localCalls: number;
  cloudCalls: number;
  bytesKeptLocal: number;
  bytesSentToCloud: number;
}

export function useRedline(config: RedlineConfig | null) {
  const fb = getFirebase(config);
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [policyLive, setPolicyLive] = useState(false);
  const [device, setDevice] = useState<DeviceStatus>('unsupported');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats>({ localCalls: 0, cloudCalls: 0, bytesKeptLocal: 0, bytesSentToCloud: 0 });
  const unsub = useRef<() => void>();

  useEffect(() => {
    getDeviceStatus().then(setDevice);
    if (!fb) return;
    watchPolicy(fb.remoteConfig, (p) => {
      setPolicy(p);
      setPolicyLive(true);
    }).then((u) => (unsub.current = u));
    return () => unsub.current?.();
  }, [fb]);

  const models = useMemo(() => (fb ? createModels(fb.ai, policy) : null), [fb, policy]);

  // Load Nano into memory as soon as it's available, so the first paste isn't slow.
  const [warm, setWarm] = useState<'idle' | 'warming' | 'ready'>('idle');
  useEffect(() => {
    if (!models || device !== 'available' || warm !== 'idle') return;
    setWarm('warming');
    warmUpDevice(models.extractor)
      .then((ms) => console.info(`[redline] Nano warm-up ${ms} ms`))
      .catch((e) => console.warn('[redline] Nano warm-up failed', e))
      .finally(() => setWarm('ready'));
  }, [models, device, warm]);

  /** Must run from a click: Chrome requires a user gesture to download Nano. */
  const downloadNano = useCallback(async () => {
    if (!models) return;
    setDownloadProgress(0);
    try {
      await prepareDevice(models.extractor, (p) => setDownloadProgress(p));
    } finally {
      setDownloadProgress(null);
      setDevice(await getDeviceStatus());
    }
  }, [models]);

  const runRedact = useCallback(
    async (text: string, onPatterns?: (partial: RedactionResult) => void): Promise<RedactionResult> => {
      const result = await redact(text, policy, {
        onPatterns,
        extractLocal:
          models && device === 'available'
            ? (t, enabled) => extractEntitiesOnDevice(models.extractor, t, enabled)
            : undefined,
      });
      const onDevice = result.trace.some((s) => s.location === 'on_device');
      setStats((s) => ({
        ...s,
        localCalls: s.localCalls + (onDevice ? 1 : 0),
        bytesKeptLocal: s.bytesKeptLocal + new TextEncoder().encode(text).length,
      }));
      return result;
    },
    [models, policy, device],
  );

  const runRisk = useCallback(
    async (result: RedactionResult): Promise<RiskReport | null> => {
      if (!models || policy.reidCheckMode === 'off') return null;
      const report = await reviewRisk(result, { checkRisk: (r) => checkReidRisk(models.riskChecker, r) });
      if (report) {
        setStats((s) => ({
          ...s,
          localCalls: s.localCalls + (report.location === 'on_device' ? 1 : 0),
          cloudCalls: s.cloudCalls + (report.location === 'in_cloud' ? 1 : 0),
          bytesSentToCloud:
            s.bytesSentToCloud + (report.location === 'in_cloud' ? new TextEncoder().encode(result.redacted).length : 0),
        }));
      }
      return report;
    },
    [models, policy],
  );

  const applySuggestions = useCallback(
    (result: RedactionResult, suggestions: RiskReport['suggestedRedactions']) =>
      addRedactions(
        result,
        suggestions.map<Entity>((s) => ({ ...s, confidence: 1, source: 'cloud_suggestion' })),
      ),
    [],
  );

  return {
    configured: !!fb,
    policy,
    policyLive,
    device,
    warm,
    downloadProgress,
    stats,
    downloadNano,
    runRedact,
    runRisk,
    applySuggestions,
  };
}
