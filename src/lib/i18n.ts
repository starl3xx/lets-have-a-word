/**
 * Internationalization (i18n) System
 * Milestone 6.3: Localization Scaffolding
 *
 * Provides translation functionality for the application.
 * - Default language: English
 * - Auto-detects browser language (falls back to English)
 * - Supports nested translation keys
 * - Supports variable interpolation ({{variable}})
 */

import enTranslations from '../../locales/en.json';

// Type for nested translation objects
type TranslationValue = string | string[] | { [key: string]: TranslationValue };
type Translations = { [key: string]: TranslationValue };

// Currently loaded translations (default to English)
let currentTranslations: Translations = enTranslations as Translations;
let currentLocale: string = 'en';

/**
 * Supported locales
 * Add new locales here as they become available
 */
export const SUPPORTED_LOCALES = ['en'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

/**
 * Get the user's preferred locale from browser
 * Falls back to 'en' if not supported
 */
export function detectBrowserLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'en';

  // Get browser language preferences
  const browserLang = navigator.language || (navigator as any).userLanguage || 'en';
  const langCode = browserLang.split('-')[0].toLowerCase();

  // Check if supported
  if (SUPPORTED_LOCALES.includes(langCode as SupportedLocale)) {
    return langCode as SupportedLocale;
  }

  // Default to English
  return 'en';
}

/**
 * Set the current locale
 * Currently only English is supported, but this scaffolding
 * allows for easy addition of new locales
 */
export async function setLocale(locale: SupportedLocale): Promise<void> {
  // For now, only English is available
  // When adding new locales, dynamically import them here:
  // const translations = await import(`../../locales/${locale}.json`);
  // currentTranslations = translations.default;

  currentTranslations = enTranslations as Translations;
  currentLocale = locale;
}

/**
 * Get a nested value from an object using dot notation
 * e.g., getNestedValue(obj, 'a.b.c') returns obj.a.b.c
 */
function getNestedValue(obj: Translations, path: string): TranslationValue | undefined {
  const keys = path.split('.');
  let current: TranslationValue = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as { [key: string]: TranslationValue })[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Interpolate variables in a string
 * e.g., interpolate('Hello {{name}}', { name: 'World' }) => 'Hello World'
 */
function interpolate(str: string, variables?: Record<string, string | number>): string {
  if (!variables) return str;

  return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key]?.toString() ?? match;
  });
}

/**
 * Translate a key to the current locale
 *
 * @param key - Dot-notation key (e.g., 'common.close', 'guessPack.title')
 * @param variables - Optional variables for interpolation
 * @returns Translated string, or the key if not found
 *
 * @example
 * t('common.close') // => 'Close'
 * t('guessPack.limitIndicator', { count: 2 }) // => 'You have purchased 2 of 3 packs today'
 */
export function t(key: string, variables?: Record<string, string | number>): string {
  const value = getNestedValue(currentTranslations, key);

  if (typeof value === 'string') {
    return interpolate(value, variables);
  }

  // Return key if not found (helps identify missing translations)
  console.warn(`[i18n] Missing translation for key: ${key}`);
  return key;
}

/**
 * Get an array of translations
 * Used for lists like interjections
 *
 * @param key - Dot-notation key pointing to an array
 * @returns Array of strings, or empty array if not found
 */
export function tArray(key: string): string[] {
  const value = getNestedValue(currentTranslations, key);

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  console.warn(`[i18n] Expected array for key: ${key}`);
  return [];
}

/**
 * Get the current locale
 */
export function getCurrentLocale(): string {
  return currentLocale;
}

/**
 * Initialize i18n system
 * Call this at app startup to detect and set the user's locale
 */
export function initI18n(): void {
  if (typeof window !== 'undefined') {
    const locale = detectBrowserLocale();
    setLocale(locale);
  }
}

/**
 * Get a random interjection from the translations
 * Used for the "Want another guess?" popup
 */
export function getRandomInterjection(): string {
  const interjections = tArray('interjections');
  if (interjections.length === 0) {
    return 'Shucks!'; // Fallback
  }
  const randomIndex = Math.floor(Math.random() * interjections.length);
  return interjections[randomIndex];
}
