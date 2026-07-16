import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        mockReset: true,
        setupFiles: ['./src/__tests__/setup.ts'],
    },
});
