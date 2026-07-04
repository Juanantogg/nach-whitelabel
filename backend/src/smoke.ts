/**
 * Smoke de carga en runtime (ESM), NO un test unitario.
 *
 * Los tests de endpoint mockean los services y NUNCA importan los modelos
 * reales, así que un import roto en runtime (p.ej. un named export que no existe
 * bajo ESM, como `import { models } from 'mongoose'`) pasa lint + typecheck +
 * vitest y solo revienta al hacer `pnpm dev`. Este script cierra ese hueco:
 * importa la app real (routes → controllers → services → models) y los modelos
 * directamente, SIN mocks. Si algún módulo no carga, Node lanza y el proceso
 * sale con código ≠ 0. No conecta a Mongo ni valida env: solo comprueba que el
 * grafo de imports de producción se resuelve.
 */
await import('./app.js');
await import('./models/counter.model.js');
await import('./models/record.model.js');

console.info('SMOKE_OK: la app y los modelos cargan en runtime sin errores de import');
