import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configFromEnv, Playground } from '@redline/ui';
import '@redline/ui/src/styles.css';

// Day-1 spike: proves Firebase AI Logic hybrid inference + App Check run inside an MV3 extension page.
// Day 3 adds the content script that intercepts pastes on AI chat sites.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground config={configFromEnv(import.meta.env, 'extension')} surface="extension" />
  </StrictMode>,
);
