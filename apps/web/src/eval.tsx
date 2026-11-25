import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configFromEnv, EvalPage } from '@redline/ui';
import '@redline/ui/src/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EvalPage config={configFromEnv(import.meta.env, 'web')} />
  </StrictMode>,
);
