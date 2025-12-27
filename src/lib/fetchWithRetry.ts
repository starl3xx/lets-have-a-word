/**
 * Fetch with Retry and Error Handling
 * Provides consistent fetch behavior with automatic retries and error parsing
 */

import {
  AppError,
  AppErrorCodes,
  AppErrorCode,
  parseApiError,
  getBackoffDelay,
  sleep,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
  ApiResponse,
} from './appErrors';

// =============================================================================
// Fetch Configuration
// =============================================================================

export interface FetchWithRetryOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Retry configuration */
  retry?: Partial<RetryConfig>;
  /** Whether to automatically retry on failure (default: true for GET, false for POST) */
  autoRetry?: boolean;
  /** Custom error code to use if fetch fails entirely */
  fallbackErrorCode?: AppErrorCode;
}

// =============================================================================
// Timeout Wrapper
// =============================================================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = 10000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(AppErrorCodes.REQUEST_TIMEOUT, {
        message: `Request to ${url} timed out after ${timeout}ms`,
        metadata: { url, timeout },
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// Main Fetch Function
// =============================================================================

/**
 * Fetch with automatic retry logic and standardized error handling
 *
 * @param url - The URL to fetch
 * @param options - Fetch options including retry and timeout config
 * @returns The parsed JSON response
 * @throws AppError with appropriate error code
 */
export async function fetchWithRetry<T = unknown>(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<T> {
  const {
    timeout = 10000,
    retry = {},
    autoRetry = options.method?.toUpperCase() !== 'POST',
    fallbackErrorCode = AppErrorCodes.SERVER_ERROR,
    ...fetchOptions
  } = options;

  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...retry,
  };

  const maxAttempts = autoRetry ? retryConfig.maxRetries + 1 : 1;
  let lastError: AppError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Wait before retry (not on first attempt)
      if (attempt > 0) {
        await sleep(getBackoffDelay(attempt - 1, retryConfig));
      }

      const response = await fetchWithTimeout(url, {
        timeout,
        ...fetchOptions,
      });

      // Parse response
      let data: unknown;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // Handle error responses
      if (!response.ok) {
        throw parseApiError(data, response.status);
      }

      return data as T;
    } catch (error) {
      // Convert to AppError if needed
      if (error instanceof AppError) {
        lastError = error;
      } else if (error instanceof TypeError && error.message.includes('fetch')) {
        // Network error (no internet, DNS failure, etc.)
        lastError = new AppError(AppErrorCodes.NETWORK_UNAVAILABLE, {
          message: 'Network unavailable',
          metadata: { url, originalError: error.message },
        });
      } else {
        lastError = new AppError(fallbackErrorCode, {
          message: error instanceof Error ? error.message : 'Unknown error',
          metadata: { url },
        });
      }

      // Don't retry on certain errors
      if (!shouldRetry(lastError.code)) {
        throw lastError;
      }
    }
  }

  throw lastError || new AppError(fallbackErrorCode, { metadata: { url } });
}

/**
 * Determine if an error code is retryable
 */
function shouldRetry(code: AppErrorCode): boolean {
  const nonRetryableCodes: AppErrorCode[] = [
    AppErrorCodes.RATE_LIMITED,
    AppErrorCodes.AUTHENTICATION_REQUIRED,
    AppErrorCodes.USER_QUALITY_BLOCKED,
    AppErrorCodes.INVALID_WORD,
    AppErrorCodes.WORD_ALREADY_GUESSED,
    AppErrorCodes.OUT_OF_GUESSES,
    AppErrorCodes.MAX_PACKS_REACHED,
    AppErrorCodes.SHARE_ALREADY_CLAIMED,
    AppErrorCodes.ROUND_CLOSED,
  ];

  return !nonRetryableCodes.includes(code);
}

// =============================================================================
// Typed API Fetchers
// =============================================================================

/**
 * Fetch round state with retry
 */
export async function fetchRoundState(devRoundId?: number): Promise<{
  roundId: number;
  prizePoolEth: string;
  prizePoolUsd: string;
  globalGuessCount: number;
  lastUpdatedAt: string;
  top10LockAfterGuesses: number;
  top10GuessesRemaining: number;
  top10Locked: boolean;
}> {
  const url = devRoundId
    ? `/api/round-state?devRoundId=${devRoundId}`
    : '/api/round-state';

  return fetchWithRetry(url, {
    fallbackErrorCode: AppErrorCodes.ROUND_STATE_UNAVAILABLE,
    timeout: 8000,
  });
}

/**
 * Fetch user state with retry
 */
export async function fetchUserState(fid: number): Promise<{
  fid: number;
  freeGuessesRemaining: number;
  paidGuessesRemaining: number;
  totalGuessesRemaining: number;
  clanktonBonusActive: boolean;
  paidPacksPurchased: number;
  maxPaidPacksPerDay: number;
  canBuyMorePacks: boolean;
  hasSharedToday: boolean;
  isClanktonHolder: boolean;
}> {
  return fetchWithRetry(`/api/user-state?fid=${fid}`, {
    fallbackErrorCode: AppErrorCodes.USER_STATE_UNAVAILABLE,
    timeout: 8000,
  });
}

/**
 * Fetch wheel state with retry
 */
export async function fetchWheelState(fid: number): Promise<{
  wheelStartIndex: number;
  roundId: number;
}> {
  return fetchWithRetry(`/api/wheel?fid=${fid}`, {
    fallbackErrorCode: AppErrorCodes.WHEEL_UNAVAILABLE,
    timeout: 8000,
  });
}

// =============================================================================
// Safe Fetch (Never Throws)
// =============================================================================

export interface SafeFetchResult<T> {
  data: T | null;
  error: AppError | null;
  ok: boolean;
}

/**
 * Fetch that never throws - returns result object instead
 * Useful for non-critical fetches where you want to handle errors gracefully
 */
export async function safeFetch<T>(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<SafeFetchResult<T>> {
  try {
    const data = await fetchWithRetry<T>(url, options);
    return { data, error: null, ok: true };
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(AppErrorCodes.SERVER_ERROR, {
            message: error instanceof Error ? error.message : 'Unknown error',
          });

    return { data: null, error: appError, ok: false };
  }
}

// =============================================================================
// Fire and Forget Fetch (For Analytics/Logging)
// =============================================================================

/**
 * Fire and forget fetch - never blocks, never throws
 * Use for analytics, logging, and other non-critical operations
 */
export function fireAndForget(url: string, options: RequestInit = {}): void {
  fetch(url, options).catch(() => {
    // Silently ignore errors
  });
}
