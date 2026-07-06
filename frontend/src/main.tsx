import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider, resolveBrand, loadBrand, BASE_DOMAIN } from './brand';
import { env, isDev } from './config/env';

// Resolución de marca fuera del árbol (síncrona en el Provider): el subdominio
// (prod) o `?brand=` (local y deploy dev, ADR 18) decide la key; `loadBrand` la
// trae de S3 y cae al default genérico ante cualquier fallo. Nunca rompe el
// arranque.
const brandKey = resolveBrand({
  hostname: window.location.hostname,
  search: window.location.search,
  isDev,
  baseDomain: BASE_DOMAIN,
  defaultBrand: env.defaultBrand,
  appEnv: env.appEnv,
});

const brand = await loadBrand(brandKey, { isDev });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider config={brand}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
