import { logger } from '@/src/utils/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postUsage } from './ingest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('postUsage', () => {
  it('sends device identity and reads the registered machine', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, machine: 'my-device', upserted: 1, sessionsUpserted: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(logger, 'log').mockImplementation(() => {});

    const result = await postUsage({ url: 'https://example.test/ingest', token: 'secret', source: { hardwareId: 'abc123', name: 'my-host' }, tz: 'Asia/Shanghai', days: [], sessions: [] });

    expect(result).toEqual({ ok: true, status: 200, machine: 'my-device' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ hardwareId: 'abc123', name: 'my-host', tz: 'Asia/Shanghai', days: [], sessions: [] });
  });

  it('sends a service source and tolerates a non-JSON success body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(logger, 'log').mockImplementation(() => {});

    const result = await postUsage({ url: 'https://example.test/ingest', token: 'secret', source: { machine: 'cursor' }, tz: 'Asia/Shanghai', days: [], sessions: [] });

    expect(result).toEqual({ ok: true, status: 200, machine: undefined });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ machine: 'cursor', tz: 'Asia/Shanghai', days: [], sessions: [] });
  });
});
