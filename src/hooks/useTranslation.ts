/**
 * useTranslation Hook
 * Milestone 6.3: Localization Scaffolding
 *
 * React hook for accessing translations in components.
 * Provides t() function and locale utilities.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  t as translate,
  tArray,
  getCurrentLocale,
  initI18n,
  getRandomInterjection,
  type SupportedLocale,
} from '../lib/i18n';

interface UseTranslationReturn {
  /**
   * Translate a key to the current locale
   * @param key - Dot-notation key (e.g., 'common.close')
   * @param variables - Optional variables for interpolation
   */
  t: (key: string, variables?: Record<string, string | number>) => string;

  /**
   * Get an array of translations
   * @param key - Dot-notation key pointing to an array
   */
  tArray: (key: string) => string[];

  /**
   * Current locale code
   */
  locale: string;

  /**
   * Get a random interjection
   */
  getRandomInterjection: () => string;
}

/**
 * Hook for accessing translations in React components
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { t, getRandomInterjection } = useTranslation();
 *
 *   return (
 *     <div>
 *       <h1>{t('guessPack.title')}</h1>
 *       <p>{t('guessPack.limitIndicator', { count: 2 })}</p>
 *       <span>{getRandomInterjection()} {t('anotherGuess.title')}</span>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTranslation(): UseTranslationReturn {
  const [locale, setLocale] = useState<string>('en');

  // Initialize i18n on mount
  useEffect(() => {
    initI18n();
    setLocale(getCurrentLocale());
  }, []);

  // Memoized translation function
  const t = useCallback(
    (key: string, variables?: Record<string, string | number>): string => {
      return translate(key, variables);
    },
    [locale]
  );

  // Memoized array translation function
  const tArrayFn = useCallback(
    (key: string): string[] => {
      return tArray(key);
    },
    [locale]
  );

  return {
    t,
    tArray: tArrayFn,
    locale,
    getRandomInterjection,
  };
}

export default useTranslation;
