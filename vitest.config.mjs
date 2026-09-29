import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/Cyber_Chat_Terminal/**', '**/dist/**', '**/electron/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js', 'public/crypto.js'],
      exclude: ['node_modules/**', 'tests/**', 'electron/**', 'Cyber_Chat_Terminal/**']
    }
  }
});
