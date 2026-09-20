import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

function requireProductionApiConfig(): Plugin {
  return {
    name: 'require-production-api-config',
    config(_config, environment) {
      if (environment.command !== 'build' || environment.mode !== 'production') return;

      const fileEnv = loadEnv(environment.mode, process.cwd(), '');
      const mockFlag = process.env.VITE_USE_MOCK_API ?? fileEnv.VITE_USE_MOCK_API;
      const apiBaseUrl = (process.env.VITE_API_BASE_URL ?? fileEnv.VITE_API_BASE_URL ?? '').trim();

      if (mockFlag !== 'true' && !apiBaseUrl) {
        throw new Error(
          'Production API configuration is missing: VITE_API_BASE_URL is required when VITE_USE_MOCK_API is not "true".',
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [requireProductionApiConfig(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
