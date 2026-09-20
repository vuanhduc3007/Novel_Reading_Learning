const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

// Mock behavior is opt-in. A missing flag must never silently select mock in
// production, because Vite replaces these values at build time.
export const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true';

if (import.meta.env.PROD && !useMockApi && !configuredApiBaseUrl) {
  throw new Error(
    'Production API configuration is missing: set VITE_API_BASE_URL or explicitly enable VITE_USE_MOCK_API=true.',
  );
}

export const apiBaseUrl = configuredApiBaseUrl || 'http://localhost:3000';
