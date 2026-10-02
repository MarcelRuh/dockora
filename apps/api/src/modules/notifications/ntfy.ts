import { request } from 'undici';

export interface NtfyMessage {
  baseUrl: string;
  topic: string;
  token?: string;
  title: string;
  message: string;
  priority?: '3' | '4' | '5';
}

const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;

export function ntfyEndpoint(baseUrl: string, topic: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(base)) {
    throw new Error('ntfy server URL must start with http:// or https://');
  }
  const name = topic.trim();
  if (!TOPIC.test(name)) {
    throw new Error('ntfy topic must be 1–64 letters, numbers, _ or -');
  }
  return `${base}/${encodeURIComponent(name)}`;
}

export function ntfyPriority(severity: string | undefined): '3' | '4' | '5' {
  if (severity === 'error') return '5';
  if (severity === 'warning') return '4';
  return '3';
}

export async function sendNtfy(message: NtfyMessage): Promise<void> {
  const url = ntfyEndpoint(message.baseUrl, message.topic);
  const headers: Record<string, string> = {
    Title: message.title.slice(0, 180),
    Priority: message.priority ?? '3',
  };
  const token = message.token?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await request(url, {
    method: 'POST',
    headers,
    body: message.message.slice(0, 4000),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`ntfy responded ${res.statusCode}`);
  }
}
