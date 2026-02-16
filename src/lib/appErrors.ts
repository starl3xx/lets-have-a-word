/**
 * App Error System
 * Centralized error handling for "bad but possible" states
 *
 * Goals:
 * - Clear human-readable messages
 * - Single next action (Retry, Refresh, Connect, Learn more)
 * - No loss of user credits
 * - No stuck UI states
 * - Structured logging for debugging
 */

// =============================================================================
// Error Codes - Stable identifiers for all error states
// =============================================================================

export const AppErrorCodes = {
  // Network / Service Failures
  NETWORK_UNAVAILABLE: 'NETWORK_UNAVAILABLE',
  SERVER_ERROR: 'SERVER_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',

  // Round State Issues
  ROUND_STATE_UNAVAILABLE: 'ROUND_STATE_UNAVAILABLE',
  ROUND_STALE: 'ROUND_STALE',
  ROUND_CLOSED: 'ROUND_CLOSED',
  ROUND_NOT_ACTIVE: 'ROUND_NOT_ACTIVE',

  // Price / External Service Issues
  USD_PRICE_UNAVAILABLE: 'USD_PRICE_UNAVAILABLE',
  COINGECKO_RATE_LIMITED: 'COINGECKO_RATE_LIMITED',

  // User State Issues
  USER_STATE_UNAVAILABLE: 'USER_STATE_UNAVAILABLE',
  USER_QUALITY_BLOCKED: 'USER_QUALITY_BLOCKED',
  FARCASTER_CONTEXT_MISSING: 'FARCASTER_CONTEXT_MISSING',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',

  // Guess Issues
  WHEEL_UNAVAILABLE: 'WHEEL_UNAVAILABLE',
  GUESS_FAILED: 'GUESS_FAILED',
  OUT_OF_GUESSES: 'OUT_OF_GUESSES',
  INVALID_WORD: 'INVALID_WORD',
  WORD_ALREADY_GUESSED: 'WORD_ALREADY_GUESSED',

  // Share Issues
  SHARE_FAILED: 'SHARE_FAILED',
  SHARE_ALREADY_CLAIMED: 'SHARE_ALREADY_CLAIMED',

  // Purchase Issues
  PURCHASE_FAILED: 'PURCHASE_FAILED',
  PURCHASE_TX_REJECTED: 'PURCHASE_TX_REJECTED',
  PURCHASE_TX_TIMEOUT: 'PURCHASE_TX_TIMEOUT',
  MAX_PACKS_REACHED: 'MAX_PACKS_REACHED',
  PRICING_UNAVAILABLE: 'PRICING_UNAVAILABLE',

  // Wallet Issues
  WALLET_READ_FAILED: 'WALLET_READ_FAILED',
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',

  // Archive / Verify Issues
  ARCHIVE_UNAVAILABLE: 'ARCHIVE_UNAVAILABLE',
  VERIFY_RPC_FAILED: 'VERIFY_RPC_FAILED',
  CONTRACT_READ_FAILED: 'CONTRACT_READ_FAILED',

  // Game Operational
  GAME_PAUSED: 'GAME_PAUSED',
  GAME_BETWEEN_ROUNDS: 'GAME_BETWEEN_ROUNDS',
} as const;

export type AppErrorCode = typeof AppErrorCodes[keyof typeof AppErrorCodes];

// =============================================================================
// CTA Action Types
// =============================================================================

export type ErrorCtaAction =
  | 'retry_fetch'
  | 'refresh_round'
  | 'refresh_page'
  | 'connect_wallet'
  | 'open_help'
  | 'dismiss'
  | 'wait'
  | 'none';

// =============================================================================
// Banner Variants
// =============================================================================

export type ErrorBannerVariant = 'error' | 'warning' | 'info';

// =============================================================================
// Error Display Configuration
// =============================================================================

export interface ErrorDisplayConfig {
  userTitle: string;
  userBody?: string;
  primaryCtaLabel: string;
  primaryCtaAction: ErrorCtaAction;
  bannerVariant: ErrorBannerVariant;
  /** If true, the error is recoverable and should auto-retry */
  autoRetry?: boolean;
  /** Maximum auto-retry attempts before showing manual CTA */
  maxAutoRetries?: number;
  /** If true, this error should be logged to analytics */
  logToAnalytics?: boolean;
}

// =============================================================================
// Error Code to Display Config Mapping
// =============================================================================

export const ErrorDisplayConfigs: Record<AppErrorCode, ErrorDisplayConfig> = {
  // Network / Service Failures
  [AppErrorCodes.NETWORK_UNAVAILABLE]: {
    userTitle: 'Connection issue',
    userBody: 'Unable to reach the server. Check your connection.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    autoRetry: true,
    maxAutoRetries: 3,
    logToAnalytics: true,
  },
  [AppErrorCodes.SERVER_ERROR]: {
    userTitle: 'Something went wrong',
    userBody: 'Our servers are having trouble. Please try again.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    autoRetry: true,
    maxAutoRetries: 2,
    logToAnalytics: true,
  },
  [AppErrorCodes.REQUEST_TIMEOUT]: {
    userTitle: 'Request timed out',
    userBody: 'The server took too long to respond.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'warning',
    autoRetry: true,
    maxAutoRetries: 2,
    logToAnalytics: true,
  },
  [AppErrorCodes.RATE_LIMITED]: {
    userTitle: 'Too many requests',
    userBody: 'Please wait a moment before trying again.',
    primaryCtaLabel: 'Wait',
    primaryCtaAction: 'wait',
    bannerVariant: 'warning',
    logToAnalytics: false,
  },

  // Round State Issues
  [AppErrorCodes.ROUND_STATE_UNAVAILABLE]: {
    userTitle: 'Round info unavailable',
    userBody: 'Unable to load round details.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'warning',
    autoRetry: true,
    maxAutoRetries: 3,
    logToAnalytics: true,
  },
  [AppErrorCodes.ROUND_STALE]: {
    userTitle: 'New round started',
    userBody: 'Loading the latest round...',
    primaryCtaLabel: 'Refresh',
    primaryCtaAction: 'refresh_round',
    bannerVariant: 'info',
    autoRetry: true,
    maxAutoRetries: 1,
    logToAnalytics: true,
  },
  [AppErrorCodes.ROUND_CLOSED]: {
    userTitle: 'Round ended',
    userBody: 'This round has been won! Loading the new round...',
    primaryCtaLabel: 'Refresh',
    primaryCtaAction: 'refresh_round',
    bannerVariant: 'info',
    autoRetry: true,
    maxAutoRetries: 1,
    logToAnalytics: true,
  },
  [AppErrorCodes.ROUND_NOT_ACTIVE]: {
    userTitle: 'No active round',
    userBody: 'Waiting for the next round to start.',
    primaryCtaLabel: 'Refresh',
    primaryCtaAction: 'refresh_round',
    bannerVariant: 'info',
    logToAnalytics: false,
  },

  // Price / External Service Issues
  [AppErrorCodes.USD_PRICE_UNAVAILABLE]: {
    userTitle: 'USD estimate unavailable',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'info',
    logToAnalytics: true,
  },
  [AppErrorCodes.COINGECKO_RATE_LIMITED]: {
    userTitle: 'Price service busy',
    userBody: 'USD prices temporarily unavailable.',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'info',
    logToAnalytics: true,
  },

  // User State Issues
  [AppErrorCodes.USER_STATE_UNAVAILABLE]: {
    userTitle: 'Unable to load your stats',
    userBody: 'Your guess counts may not be accurate.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'warning',
    autoRetry: true,
    maxAutoRetries: 3,
    logToAnalytics: true,
  },
  [AppErrorCodes.USER_QUALITY_BLOCKED]: {
    userTitle: 'Account verification needed',
    userBody: 'Your account needs a higher Neynar score to play.',
    primaryCtaLabel: 'Learn more',
    primaryCtaAction: 'open_help',
    bannerVariant: 'warning',
    logToAnalytics: true,
  },
  [AppErrorCodes.FARCASTER_CONTEXT_MISSING]: {
    userTitle: 'Open in Warpcast',
    userBody: 'This feature requires the Warpcast app.',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'info',
    logToAnalytics: false,
  },
  [AppErrorCodes.AUTHENTICATION_REQUIRED]: {
    userTitle: 'Sign in required',
    userBody: 'Please open this app in Warpcast to play.',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'warning',
    logToAnalytics: false,
  },

  // Guess Issues
  [AppErrorCodes.WHEEL_UNAVAILABLE]: {
    userTitle: 'Word wheel unavailable',
    userBody: 'Unable to load the game. Please try again.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    autoRetry: true,
    maxAutoRetries: 3,
    logToAnalytics: true,
  },
  [AppErrorCodes.GUESS_FAILED]: {
    userTitle: 'Guess not submitted',
    userBody: 'Something went wrong. Your guess was not counted.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    logToAnalytics: true,
  },
  [AppErrorCodes.OUT_OF_GUESSES]: {
    userTitle: 'No guesses left today',
    userBody: 'Share on Farcaster for a bonus guess, or buy a pack!',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'warning',
    logToAnalytics: false,
  },
  [AppErrorCodes.INVALID_WORD]: {
    userTitle: 'Invalid word',
    userBody: 'That word is not in our dictionary.',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'warning',
    logToAnalytics: false,
  },
  [AppErrorCodes.WORD_ALREADY_GUESSED]: {
    userTitle: 'Already guessed',
    userBody: 'That word has already been tried this round.',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'warning',
    logToAnalytics: false,
  },

  // Share Issues
  [AppErrorCodes.SHARE_FAILED]: {
    userTitle: 'Share not recorded',
    userBody: 'Unable to grant bonus guess. Please try again.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    logToAnalytics: true,
  },
  [AppErrorCodes.SHARE_ALREADY_CLAIMED]: {
    userTitle: 'Bonus already claimed',
    userBody: "You've already earned today's share bonus.",
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'info',
    logToAnalytics: false,
  },

  // Purchase Issues
  [AppErrorCodes.PURCHASE_FAILED]: {
    userTitle: 'Purchase not completed',
    userBody: 'Something went wrong. You were not charged.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    logToAnalytics: true,
  },
  [AppErrorCodes.PURCHASE_TX_REJECTED]: {
    userTitle: 'Transaction cancelled',
    userBody: 'You cancelled the transaction.',
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'info',
    logToAnalytics: true,
  },
  [AppErrorCodes.PURCHASE_TX_TIMEOUT]: {
    userTitle: 'Transaction pending',
    userBody: 'Your transaction is taking longer than expected.',
    primaryCtaLabel: 'Refresh',
    primaryCtaAction: 'refresh_page',
    bannerVariant: 'warning',
    logToAnalytics: true,
  },
  [AppErrorCodes.MAX_PACKS_REACHED]: {
    userTitle: 'Daily limit reached',
    userBody: "You've purchased the maximum packs for today.",
    primaryCtaLabel: 'Dismiss',
    primaryCtaAction: 'dismiss',
    bannerVariant: 'info',
    logToAnalytics: false,
  },
  [AppErrorCodes.PRICING_UNAVAILABLE]: {
    userTitle: 'Pricing unavailable',
    userBody: 'Unable to load pack prices. Please try again.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    autoRetry: true,
    maxAutoRetries: 2,
    logToAnalytics: true,
  },

  // Wallet Issues
  [AppErrorCodes.WALLET_READ_FAILED]: {
    userTitle: 'Wallet check failed',
    userBody: 'Unable to verify token balance.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'warning',
    autoRetry: true,
    maxAutoRetries: 2,
    logToAnalytics: true,
  },
  [AppErrorCodes.WALLET_NOT_CONNECTED]: {
    userTitle: 'Wallet not connected',
    userBody: 'Connect your wallet to check $WORD balance.',
    primaryCtaLabel: 'Connect',
    primaryCtaAction: 'connect_wallet',
    bannerVariant: 'info',
    logToAnalytics: false,
  },

  // Archive / Verify Issues
  [AppErrorCodes.ARCHIVE_UNAVAILABLE]: {
    userTitle: 'Archive unavailable',
    userBody: 'Unable to load round history.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    autoRetry: true,
    maxAutoRetries: 3,
    logToAnalytics: true,
  },
  [AppErrorCodes.VERIFY_RPC_FAILED]: {
    userTitle: 'Verification unavailable',
    userBody: 'Unable to connect to Base network.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    autoRetry: true,
    maxAutoRetries: 2,
    logToAnalytics: true,
  },
  [AppErrorCodes.CONTRACT_READ_FAILED]: {
    userTitle: 'Contract read failed',
    userBody: 'Unable to verify onchain data.',
    primaryCtaLabel: 'Retry',
    primaryCtaAction: 'retry_fetch',
    bannerVariant: 'error',
    autoRetry: true,
    maxAutoRetries: 2,
    logToAnalytics: true,
  },

  // Game Operational
  [AppErrorCodes.GAME_PAUSED]: {
    userTitle: 'Game paused',
    userBody: 'The game is temporarily paused.',
    primaryCtaLabel: 'Refresh',
    primaryCtaAction: 'refresh_page',
    bannerVariant: 'warning',
    logToAnalytics: true,
  },
  [AppErrorCodes.GAME_BETWEEN_ROUNDS]: {
    userTitle: 'Between rounds',
    userBody: 'Waiting for the next round to start.',
    primaryCtaLabel: 'Refresh',
    primaryCtaAction: 'refresh_page',
    bannerVariant: 'info',
    logToAnalytics: false,
  },
};

// =============================================================================
// App Error Class
// =============================================================================

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly httpStatus?: number;
  public readonly metadata?: Record<string, unknown>;
  public readonly displayConfig: ErrorDisplayConfig;

  constructor(
    code: AppErrorCode,
    options?: {
      message?: string;
      httpStatus?: number;
      metadata?: Record<string, unknown>;
    }
  ) {
    const displayConfig = ErrorDisplayConfigs[code];
    super(options?.message || displayConfig.userTitle);

    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.metadata = options?.metadata;
    this.displayConfig = displayConfig;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Get the display configuration for this error
   */
  getDisplayConfig(): ErrorDisplayConfig {
    return this.displayConfig;
  }

  /**
   * Convert to a JSON-serializable object for API responses
   */
  toJSON(): {
    ok: false;
    error: AppErrorCode;
    message: string;
    metadata?: Record<string, unknown>;
  } {
    return {
      ok: false,
      error: this.code,
      message: this.message,
      ...(this.metadata && { metadata: this.metadata }),
    };
  }
}

// =============================================================================
// Standard API Response Types
// =============================================================================

export interface ApiSuccessResponse<T = unknown> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: AppErrorCode;
  message: string;
  metadata?: Record<string, unknown>;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a response is an API error
 */
export function isApiError(response: unknown): response is ApiErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'ok' in response &&
    (response as { ok: unknown }).ok === false &&
    'error' in response
  );
}

/**
 * Get display config for an error code
 */
export function getErrorDisplayConfig(code: AppErrorCode): ErrorDisplayConfig {
  return ErrorDisplayConfigs[code] || ErrorDisplayConfigs[AppErrorCodes.SERVER_ERROR];
}

/**
 * Map HTTP status codes to error codes
 */
export function httpStatusToErrorCode(status: number): AppErrorCode {
  switch (status) {
    case 400:
      return AppErrorCodes.INVALID_WORD;
    case 401:
      return AppErrorCodes.AUTHENTICATION_REQUIRED;
    case 403:
      return AppErrorCodes.USER_QUALITY_BLOCKED;
    case 404:
      return AppErrorCodes.ROUND_NOT_ACTIVE;
    case 408:
      return AppErrorCodes.REQUEST_TIMEOUT;
    case 429:
      return AppErrorCodes.RATE_LIMITED;
    case 500:
    case 502:
    case 503:
    case 504:
      return AppErrorCodes.SERVER_ERROR;
    default:
      return AppErrorCodes.SERVER_ERROR;
  }
}

/**
 * Parse an error response from the API and return the appropriate AppError
 */
export function parseApiError(
  response: unknown,
  httpStatus?: number
): AppError {
  // Already an ApiErrorResponse
  if (isApiError(response)) {
    return new AppError(response.error as AppErrorCode, {
      message: response.message,
      httpStatus,
      metadata: response.metadata,
    });
  }

  // Legacy error format with 'error' string
  if (
    typeof response === 'object' &&
    response !== null &&
    'error' in response
  ) {
    const legacyError = response as { error: string; [key: string]: unknown };
    const errorCode = mapLegacyErrorToCode(legacyError.error);
    return new AppError(errorCode, {
      message: legacyError.error,
      httpStatus,
      metadata: response as Record<string, unknown>,
    });
  }

  // Fallback to generic server error
  return new AppError(
    httpStatus ? httpStatusToErrorCode(httpStatus) : AppErrorCodes.SERVER_ERROR,
    { httpStatus }
  );
}

/**
 * Map legacy error strings to AppErrorCodes
 */
function mapLegacyErrorToCode(errorString: string): AppErrorCode {
  const lowerError = errorString.toLowerCase();

  if (lowerError.includes('insufficient_user_score') || lowerError.includes('quality')) {
    return AppErrorCodes.USER_QUALITY_BLOCKED;
  }
  if (lowerError.includes('rate') || lowerError.includes('too many')) {
    return AppErrorCodes.RATE_LIMITED;
  }
  if (lowerError.includes('timeout')) {
    return AppErrorCodes.REQUEST_TIMEOUT;
  }
  if (lowerError.includes('network') || lowerError.includes('connection')) {
    return AppErrorCodes.NETWORK_UNAVAILABLE;
  }
  if (lowerError.includes('authentication') || lowerError.includes('unauthorized')) {
    return AppErrorCodes.AUTHENTICATION_REQUIRED;
  }
  if (lowerError.includes('round_closed') || lowerError.includes('round closed')) {
    return AppErrorCodes.ROUND_CLOSED;
  }
  if (lowerError.includes('pack') && lowerError.includes('limit')) {
    return AppErrorCodes.MAX_PACKS_REACHED;
  }

  return AppErrorCodes.SERVER_ERROR;
}

// =============================================================================
// Retry Logic Helpers
// =============================================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

/**
 * Calculate exponential backoff delay
 */
export function getBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < config.maxRetries) {
        await sleep(getBackoffDelay(attempt, config));
      }
    }
  }

  throw lastError || new Error('Retry failed');
}

// =============================================================================
// Analytics Event Names for Errors
// =============================================================================

export const ErrorAnalyticsEvents = {
  // API Failures
  API_FAILURE_ROUND_STATE: 'api_failure_round_state',
  API_FAILURE_USER_STATE: 'api_failure_user_state',
  API_FAILURE_WHEEL: 'api_failure_wheel',
  API_FAILURE_GUESS: 'api_failure_guess',
  API_FAILURE_SHARE: 'api_failure_share',
  API_FAILURE_PURCHASE: 'api_failure_purchase',
  API_FAILURE_ARCHIVE: 'api_failure_archive',

  // External Service Failures
  PRICE_USD_UNAVAILABLE: 'price_usd_unavailable',
  COINGECKO_RATE_LIMITED: 'coingecko_rate_limited',
  WALLET_READ_FAILED: 'wallet_read_failed',
  RPC_FAILED: 'rpc_failed',

  // Game State Issues
  ROUND_STALE_DETECTED: 'round_stale_detected',
  ROUND_STALE_RECOVERY_SUCCESS: 'round_stale_recovery_success',
  ROUND_STALE_RECOVERY_FAILED: 'round_stale_recovery_failed',

  // User Issues
  USER_QUALITY_BLOCKED: 'user_quality_blocked',
  FARCASTER_CONTEXT_MISSING: 'farcaster_context_missing',

  // Purchase Issues
  PURCHASE_TX_REJECTED: 'purchase_tx_rejected',
  PURCHASE_TX_TIMEOUT: 'purchase_tx_timeout',
  PURCHASE_CREDITS_DELAYED: 'purchase_credits_delayed',

  // Share Issues
  SHARE_BONUS_FAILED: 'share_bonus_failed',
} as const;

export type ErrorAnalyticsEvent =
  typeof ErrorAnalyticsEvents[keyof typeof ErrorAnalyticsEvents];
