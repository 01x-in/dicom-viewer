import type { DicomWebRequest } from '../data/request';
import type { FrameRequestPolicy } from '../data/types';

/** What the wadors loader returns: a promise, and a way to cancel it. Extra fields pass through. */
interface LoadResult<T> {
  readonly promise: Promise<T>;
  readonly cancelFn?: () => void;
  readonly decache?: () => void;
}

type Load<T> = (imageId: string, options?: Record<string, unknown>) => LoadResult<T>;

export interface FrameRequests {
  /** Makes the host's headers and refresh hook apply to frames whose image id starts with the policy's prefix. */
  register(policy: FrameRequestPolicy): () => void;
  /** The headers to add to one frame request. Called by the loader just before it sends. */
  headersFor(imageId: string, defaultHeaders: Record<string, string>): Record<string, string>;
  /** Wraps the loader so a 401 refreshes the credentials and retries the frame once. */
  wrap<T>(load: Load<T>): Load<T>;
}

/** The loader rejects with the XMLHttpRequest, or with an Error that carries the status. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

function urlOf(imageId: string): string {
  // The loader requests everything after the `wadors:` scheme, and a fragment is never sent.
  const url = imageId.slice(imageId.indexOf(':') + 1);
  const fragment = url.indexOf('#');
  return fragment === -1 ? url : url.slice(0, fragment);
}

interface Sent {
  readonly request: DicomWebRequest;
  readonly generation: number;
}

export function createFrameRequests(): FrameRequests {
  // Each source owns its own image ids, so credentials never cross between viewers.
  const policies: FrameRequestPolicy[] = [];
  const sent = new Map<string, Sent>();

  function find(imageId: string): FrameRequestPolicy | undefined {
    return policies.find((policy) => policy.owns(imageId));
  }

  return {
    register(policy): () => void {
      policies.push(policy);
      return (): void => {
        const index = policies.indexOf(policy);
        if (index !== -1) policies.splice(index, 1);
      };
    },
    headersFor(imageId, defaultHeaders): Record<string, string> {
      const policy = find(imageId);
      if (policy === undefined) return {};
      const request: DicomWebRequest = {
        url: urlOf(imageId),
        accept: defaultHeaders['Accept'] ?? '',
      };
      sent.set(imageId, { request, generation: policy.generation() });
      return policy.headers(request);
    },
    wrap<T>(load: Load<T>): Load<T> {
      return (imageId, options) => {
        const first = load(imageId, options);
        // Cancelling must reach whichever request is running, and stop a retry that has not started.
        let active: LoadResult<T> = first;
        const cancellation = {
          cancelled: false,
          // A call, so the check after an await is not narrowed by the one before it.
          isCancelled(): boolean {
            return this.cancelled;
          },
        };
        const promise = first.promise.catch(async (error: unknown): Promise<T> => {
          const policy = find(imageId);
          const origin = sent.get(imageId);
          if (statusOf(error) !== 401 || policy === undefined || cancellation.cancelled)
            throw error;
          const request = origin?.request ?? { url: urlOf(imageId), accept: '' };
          if (!(await policy.refresh(request, origin?.generation ?? policy.generation()))) {
            throw error;
          }
          // Cancelled while the credentials were refreshing.
          if (cancellation.isCancelled()) throw error;
          active = load(imageId, options);
          return active.promise;
        });
        const forget = (): void => {
          sent.delete(imageId);
        };
        promise.then(forget, forget);
        return {
          ...first,
          promise,
          cancelFn: (): void => {
            cancellation.cancelled = true;
            active.cancelFn?.();
          },
        };
      };
    },
  };
}
