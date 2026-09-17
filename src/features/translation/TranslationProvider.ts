export interface TranslationProvider {
  translate(text: string): Promise<string>;
}

export class MockTranslationProvider implements TranslationProvider {
  async translate(text: string): Promise<string> {
    // Simulate network delay (300ms - 800ms)
    const delay = 300 + Math.random() * 500;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    // Simulate rare failure (5% chance)
    if (Math.random() < 0.05) {
      throw new Error('Mock translation network error');
    }

    return `[Bản dịch Mock] ${text}`;
  }
}

export class ApiTranslationProvider implements TranslationProvider {
  async translate(text: string): Promise<string> {
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${API_BASE_URL}/api/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        sourceLanguage: 'zh',
        targetLanguage: 'vi'
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.translation;
  }
}

// Development fallback to mock if API env is not set or explicitly says mock
const useMock = import.meta.env.VITE_USE_MOCK_API === 'true' || import.meta.env.VITE_USE_MOCK_API === undefined;

export const translationProvider = useMock 
  ? new MockTranslationProvider() 
  : new ApiTranslationProvider();
