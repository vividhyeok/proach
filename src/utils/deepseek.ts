export type DeepseekRole = 'system' | 'user' | 'assistant';

export interface DeepseekMessage {
  role: DeepseekRole;
  content: string;
}

export interface DeepseekChatOptions {
  temperature?: number;
  responseFormat?: 'json' | 'text';
}

function ensureApiKey() {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Deepseek API key (VITE_DEEPSEEK_API_KEY) is not set.');
  }
  return apiKey;
}

export async function deepseekChat(
  messages: DeepseekMessage[],
  options: DeepseekChatOptions = {}
): Promise<string> {
  const apiKey = ensureApiKey();
  const endpoint = import.meta.env.VITE_DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat';

  const body = {
    model,
    temperature: options.temperature ?? 0.35,
    messages,
    response_format: options.responseFormat === 'json' ? { type: 'json_object' } : undefined,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Deepseek API request failed';
    throw new Error(message);
  }

  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Deepseek API did not return any content.');
  }
  return content.trim();
}

export function extractJsonBlock(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
