import { DataSourceError } from './errors';

/** What a header or refresh hook gets to know about a request. */
export interface DicomWebRequest {
  readonly url: string;
  readonly accept: string;
}

export interface RetryOptions {
  /** Extra attempts after a 5xx answer. Default 2. */
  readonly retries?: number;
  /** The first backoff; each further retry doubles it. Default 250 ms. */
  readonly baseDelayMs?: number;
}

export interface RequesterOptions {
  /** Called synchronously for every request, so a token that rotates is always read fresh. */
  readonly getRequestHeaders?: (request: DicomWebRequest) => Record<string, string>;
  /** Called after a 401. Refresh the credentials here; the request is then retried once. */
  readonly onUnauthorized?: (request: DicomWebRequest) => void | Promise<void>;
  readonly retry?: RetryOptions;
  /** Injected for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Injected for tests. Defaults to `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface Requester {
  /** GET with the host's headers, one refresh on 401, and backoff on 5xx. Never retries 403 or 404. */
  get(url: string, accept: string): Promise<Response>;
  /** How many refreshes have finished. A request notes this when it is sent. */
  generation(): number;
  /**
   * Runs the host's refresh hook after a 401, sharing one run between callers that ask while it is
   * in flight. When `sentAt` (the `generation()` when the request was sent) is behind, a refresh
   * already finished since, so the hook does not run again. Resolves to `false` when the host gave
   * no hook.
   */
  refresh(request: DicomWebRequest, sentAt?: number): Promise<boolean>;
  /** The host's headers for one request, for the frame loader, which does its own fetching. */
  headers(request: DicomWebRequest): Record<string, string>;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRequester(options: RequesterOptions = {}): Requester {
  const rawFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const retries = options.retry?.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  // Counts completed refreshes. A 401 for a request that was sent before the latest refresh already
  // has fresh credentials waiting: it retries without refreshing again.
  let generation = 0;
  let refreshing: Promise<void> | undefined;

  function headers(request: DicomWebRequest): Record<string, string> {
    return options.getRequestHeaders?.(request) ?? {};
  }

  async function refresh(request: DicomWebRequest, sentAt?: number): Promise<boolean> {
    const hook = options.onUnauthorized;
    if (hook === undefined) return false;
    if (sentAt !== undefined && sentAt !== generation) return true;
    refreshing ??= (async (): Promise<void> => {
      try {
        await hook(request);
      } catch (error) {
        throw new DataSourceError(`Refreshing credentials failed: ${message(error)}`, 401);
      }
    })().finally(() => {
      // Runs after `refreshing` is assigned, even when the hook throws synchronously.
      generation += 1;
      refreshing = undefined;
    });
    await refreshing;
    return true;
  }

  async function send(request: DicomWebRequest): Promise<Response> {
    try {
      // The Accept header is the request's own; host headers cannot replace it.
      return await rawFetch(request.url, {
        headers: { ...headers(request), Accept: request.accept },
      });
    } catch (error) {
      // Network, CORS, and abort failures reject with native errors; callers only handle DataSourceError.
      if (error instanceof DataSourceError) throw error;
      throw new DataSourceError(`The DICOMweb request failed: ${message(error)}`);
    }
  }

  return {
    headers,
    refresh,
    generation: () => generation,
    async get(url, accept): Promise<Response> {
      const request: DicomWebRequest = { url, accept };
      let retried = 0;
      let refreshed = false;
      for (;;) {
        const sentAt = generation;
        const response = await send(request);
        if (response.ok) return response;
        // Free the connection; the body of an error is not used.
        void response.body?.cancel().catch(() => undefined);

        if (response.status === 401 && !refreshed && options.onUnauthorized !== undefined) {
          refreshed = true;
          await refresh(request, sentAt);
          continue;
        }
        if (response.status >= 500 && retried < retries) {
          await sleep(baseDelayMs * 2 ** retried);
          retried += 1;
          continue;
        }
        throw new DataSourceError(
          `The DICOMweb server answered HTTP ${response.status.toString()} for ${url}.`,
          response.status,
        );
      }
    },
  };
}
