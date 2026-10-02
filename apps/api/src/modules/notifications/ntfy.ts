import { request } from 'undici';
import { assertNtfyBaseUrl, assertNtfyHostResolves } from './outbound-url.js';

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
  const url = assertNtfyBaseUrl(baseUrl);
  const name = topic.trim();
  if (!TOPIC.test(name)) {
    throw new Error('ntfy topic must be 1–64 letters, numbers, _ or -');
  }
  const base = url.toString().replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(name)}`;
}

function headerText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

export function ntfyPriority(severity: string | undefined): '3' | '4' | '5' {
  if (severity === 'error') return '5';
  if (severity === 'warning') return '4';
  return '3';
}

export async function sendNtfy(message: NtfyMessage): Promise<void> {
  const url = ntfyEndpoint(message.baseUrl, message.topic);
  await assertNtfyHostResolves(new URL(url).hostname);
  const headers: Record<string, string> = {
    Title: headerText(message.title, 180),
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
