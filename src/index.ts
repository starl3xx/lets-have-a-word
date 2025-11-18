/**
 * Let's Have A Word - Main Entry Point
 *
 * Milestone 1.1: Core data model and game rules
 */

// Export all modules
export * from './types';
export * from './lib/word-lists';
export * from './lib/game-rules';
export * from './lib/commit-reveal';
export * from './lib/rounds';
export * from './db';

// Validation on import
import { validateWordLists } from './lib/word-lists';

// Validate word lists on startup (can be disabled with env var)
if (process.env.SKIP_WORD_LIST_VALIDATION !== 'true') {
  validateWordLists();
}

console.log('✅ Let\'s Have A Word - Milestone 1.1 initialized');
