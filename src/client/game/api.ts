/** Typed fetch layer. All state lives on the server — never in this webview. */
import type {
  EntryRequest,
  EntryResponse,
  LeaderboardResponse,
  LeaderboardScope,
  OkResponse,
  ProfileResponse,
  QuestionSubmission,
  RevealPayload,
  StateResponse,
} from '../../shared/types';
import { COPY } from '../../shared/copy';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError('network', COPY.err_network, 0);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('network', COPY.err_network, res.status);
  }
  if (!res.ok) {
    const e = body as { code?: string; message?: string };
    throw new ApiError(
      e.code ?? 'error',
      e.message ?? COPY.err_network,
      res.status
    );
  }
  return body as T;
}

export const api = {
  state: () => call<StateResponse>('/api/state'),
  lockIn: (entry: EntryRequest) =>
    call<EntryResponse>('/api/entry', {
      method: 'POST',
      body: JSON.stringify(entry),
    }),
  onRecord: () =>
    call<OkResponse>('/api/on-record', { method: 'POST', body: '{}' }),
  reveal: (day: number) => call<RevealPayload>(`/api/reveal/${day}`),
  celebrated: (day: number) =>
    call<OkResponse>('/api/celebrated', {
      method: 'POST',
      body: JSON.stringify({ day }),
    }),
  seenHow: () =>
    call<OkResponse>('/api/seen-how', { method: 'POST', body: '{}' }),
  leaderboard: (scope: LeaderboardScope) =>
    call<LeaderboardResponse>(`/api/leaderboard?scope=${scope}`),
  profile: () => call<ProfileResponse>('/api/profile'),
  question: (q: QuestionSubmission) =>
    call<OkResponse>('/api/question', {
      method: 'POST',
      body: JSON.stringify(q),
    }),
  share: (day: number) =>
    call<OkResponse>('/api/share', {
      method: 'POST',
      body: JSON.stringify({ day }),
    }),
};

let clockOffsetMs = 0;
export function syncClock(serverNowMs: number): void {
  clockOffsetMs = serverNowMs - Date.now();
}
export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

/** HH:MM:SS. */
export function countdown(untilMs: number): string {
  const total = Math.max(0, Math.floor((untilMs - serverNow()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function oneDp(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1);
}
