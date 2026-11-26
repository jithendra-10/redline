import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage, configFromEnv } from '@redline/ui';
import '@redline/ui/src/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminPage config={configFromEnv(import.meta.env, 'web')} />
  </StrictMode>,
);
