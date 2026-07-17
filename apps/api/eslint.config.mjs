import nestjsConfig from '@smartlogistica/eslint-config/nestjs.js';

export default [
  ...nestjsConfig,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
