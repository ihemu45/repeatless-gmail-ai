/** Small concurrency + backoff utilities (no external deps). */

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A minimal p-limit style concurrency gate. Caps how many async tasks run at
 * once — important for Gmail's per-user rate limits (we fan out message.get
 * calls but never more than `concurrency` in flight).
 */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active--;
    const resume = queue.shift();
    if (resume) resume();
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * Retry with exponential backoff + jitter. `shouldRetry` decides which errors
 * are transient (e.g. HTTP 429 / 5xx). Caps at `maxRetries` attempts.
 */
export async function withBackoff<T>(
  task: () => Promise<T>,
  opts: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (err: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    maxRetries = 5,
    baseDelayMs = 500,
    maxDelayMs = 16_000,
    shouldRetry = () => true,
  } = opts;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await task();
    } catch (err) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(err)) {
        throw err;
      }
      const expo = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.random() * expo * 0.25;
      await sleep(expo + jitter);
    }
  }
}
