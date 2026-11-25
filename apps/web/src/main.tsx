import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configFromEnv, Playground } from '@redline/ui';
import '@redline/ui/src/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground config={configFromEnv(import.meta.env, 'web')} surface="web" />
  </StrictMode>,
);
