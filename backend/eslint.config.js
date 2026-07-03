import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Evita que `console.log` de depuración se cuele en un commit.
      // Se permiten warn/error para logging legítimo (arranque, errores).
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  // En tests: prohíbe `.only` (desactivaría el resto de la suite en CI).
  {
    files: ['**/*.test.ts'],
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
    },
  },
  // Desactiva reglas de estilo que colisionan con Prettier (debe ir al final).
  prettier,
);
