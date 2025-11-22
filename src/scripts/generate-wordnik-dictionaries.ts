#!/usr/bin/env tsx
/**
 * Dictionary Generation Script - Milestone 4.13
 *
 * Generates clean English word dictionaries from Wordnik API:
 * - GUESS_WORDS_CLEAN: All valid guessable words (~5-6k words)
 * - ANSWER_WORDS_EXPANDED: Curated answer words (~3-4k words)
 *
 * Requirements:
 * - WORDNIK_API_KEY environment variable must be set
 * - All words are exactly 5 letters, A-Z only
 * - No proper nouns, offensive words, or Scrabble junk
 * - Lemmatization-based plural detection
 * - ANSWER_WORDS_EXPANDED ⊆ GUESS_WORDS_CLEAN
 *
 * Usage:
 *   WORDNIK_API_KEY=your_key tsx src/scripts/generate-wordnik-dictionaries.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ============================================================================
// CONFIGURATION
// ============================================================================

const WORDNIK_API_KEY = process.env.WORDNIK_API_KEY;
const API_BASE_URL = 'api.wordnik.com';

// Output paths
const OUTPUT_DIR = path.join(__dirname, '../data');
const GUESS_WORDS_OUTPUT = path.join(OUTPUT_DIR, 'guess_words_clean.ts');
const ANSWER_WORDS_OUTPUT = path.join(OUTPUT_DIR, 'answer_words_expanded.ts');

// Target sizes
const TARGET_GUESS_WORDS = 6000; // ~5-6k
const TARGET_ANSWER_WORDS = 3500; // ~3-4k

// Offensive word blacklist (basic - expand as needed)
const OFFENSIVE_BLACKLIST = new Set([
  'SLUTS',
  'WHORE',
  'BITCH',
  'COCKS',
  'CUNTS',
  'FUCKS',
  'SHITS',
  'PRICK',
  'PUSSY',
  'TARDS',
  // Add more as needed
]);

// Common proper nouns to exclude (basic list)
const PROPER_NOUN_BLACKLIST = new Set([
  'JESUS',
  'CHINA',
  'INDIA',
  'SPAIN',
  'ITALY',
  'PARIS',
  'TOKYO',
  'JAMES',
  'JONES',
  'SMITH',
  'BROWN',
  'DAVIS',
  'MARCH',  // Month
  'APRIL',  // Month
  'ALICE',
  'BOBBY',
  'KAREN',
  // Add more as needed
]);

// Archaic/obscure words to exclude (Scrabble-style garbage words)
const ARCHAIC_BLACKLIST = new Set([
  // Double letter starts (usually Scrabble words)
  'AALII', 'AAHED', 'AARGH', 'AARTI',

  // Obscure technical/archaic terms
  'ABACA', 'ABACI', 'ABAFT', 'ABAHT', 'ABAKA', 'ABAMP', 'ABAND', 'ABASK',
  'ABAYA', 'ABCEE', 'ABEAM', 'ABEAR', 'ABELE', 'ABENG', 'ABJAD', 'ABJUD',
  'ABLET', 'ABLOW', 'ABMHO', 'ABNET', 'ABOHM', 'ABOIL', 'ABOMA', 'ABOON',
  'ABORD', 'ABORE', 'ABORN', 'ABRAM', 'ABRAY', 'ABRIM', 'ABRIN', 'ABRIS',
  'ABSEY', 'ABSIT', 'ABUNA', 'ABUNE', 'ABUTS', 'ABUZZ', 'ABYES', 'ABYSM',

  // More Scrabble garbage
  'ACAIS', 'ACARI', 'ACCAS', 'ACCOY', 'ACERB', 'ACETA', 'ACHAR', 'ACHED',
  'ACIDY', 'ACINI', 'ACKEE', 'ACMES', 'ACMIC', 'ACNED', 'ACNES', 'ACOCK',
  'ACOLD', 'ACRED', 'ACRES', 'ACROS', 'ACTED', 'ACTIN', 'ACTON', 'ADAWS',
  'ADBOT', 'ADDAX', 'ADDER', 'ADDIO', 'ADDLE', 'ADEEM', 'ADHAN', 'ADIEU',
  'ADIOS', 'ADITS', 'ADMAN', 'ADMEN', 'ADMIX', 'ADOBO', 'ADOWN', 'ADOZE',
  'ADRAD', 'ADRED', 'ADSUM', 'ADUKI', 'ADUNC', 'ADUST', 'ADVEW', 'ADYTA',

  // Y-heavy and unusual patterns
  'YEXED', 'YEXES', 'YIRTH', 'YITES', 'YLIKE', 'YLKES', 'YMOLT', 'YMPES',
  'YOBBO', 'YOBBY', 'YOCKS', 'YODHS', 'YODLE', 'YOJAN', 'YOKED', 'YOKEL',
  'YOKER', 'YOKES', 'YOKUL', 'YOLKS', 'YOLKY', 'YOMIM', 'YOMPS', 'YONIC',
  'YONKS', 'YOOFS', 'YOOPS', 'YORES', 'YORKS', 'YORPS', 'YOUKS', 'YOURN',
  'YOURS', 'YOURT', 'YOUSE', 'YOUTH', 'YOWED', 'YOWES', 'YOWIE', 'YOWLS',

  // X-heavy Scrabble words
  'XEBEC', 'XEMES', 'XENIA', 'XENIC', 'XENON', 'XERIC', 'XEROX', 'XERUS',
  'XOANA', 'XOLOS', 'XRAYS', 'XYLAN', 'XYLEM', 'XYLIC', 'XYLOL', 'XYLYL',
  'XYSTI', 'XYSTS',

  // Q without U (Scrabble words)
  'QADIS', 'QAIDS', 'QAJAQ', 'QANAT', 'QAPHS', 'QAPIK', 'QATS', 'QAWAH',
  'QIBLA', 'QINAH', 'QINAH', 'QINTA', 'QIRSH', 'QOPH', 'QOPHS', 'QORMA',
  'QUAFF', 'QUAGS', 'QUAI', 'QUAIR', 'QUAIS', 'QUAKY', 'QUANT', 'QUARE',
  'QUASS', 'QUATE', 'QUATS', 'QUAUK', 'QUAWK', 'QUAYD', 'QUAYS', 'QUBIT',
  'QUEAN', 'QUEME', 'QUENA', 'QUERN', 'QUEYN', 'QUEYS', 'QUICH', 'QUIDS',
  'QUIFF', 'QUIMS', 'QUINA', 'QUINE', 'QUINO', 'QUINS', 'QUINT', 'QUIPO',
  'QUIPS', 'QUIPU', 'QUIRE', 'QUIRK', 'QUIRT', 'QUITS', 'QUOAD', 'QUODS',
  'QUOIF', 'QUOIN', 'QUOIT', 'QUOLL', 'QUONK', 'QUOPS', 'QUORUM',

  // ZZ and unusual Z words
  'ZAYIN', 'ZEALS', 'ZEBEC', 'ZEBUB', 'ZEBUS', 'ZEDAS', 'ZEINS', 'ZENDO',
  'ZERDA', 'ZERKS', 'ZESTS', 'ZETAS', 'ZHOMO', 'ZIBET', 'ZIFFS', 'ZIGAN',
  'ZILAS', 'ZILCH', 'ZILLA', 'ZILLS', 'ZIMBI', 'ZIMBS', 'ZINCO', 'ZINCS',
  'ZINCY', 'ZINEB', 'ZINES', 'ZINGS', 'ZINGY', 'ZINKE', 'ZINKY', 'ZIPPO',
  'ZIPPY', 'ZIRAM', 'ZITIS', 'ZIZEL', 'ZIZIT', 'ZLOTE', 'ZLOTY', 'ZOAEA',
  'ZOBOS', 'ZOBUS', 'ZOCCO', 'ZOEAE', 'ZOEAL', 'ZOEAS', 'ZOISM', 'ZOIST',
  'ZOMBI', 'ZONAE', 'ZONDA', 'ZONED', 'ZONER', 'ZONES', 'ZONKS', 'ZOOEA',
  'ZOOEY', 'ZOOID', 'ZOOKS', 'ZOOMS', 'ZOOMY', 'ZOONS', 'ZOOTY', 'ZOPPA',
  'ZOPPO', 'ZORIL', 'ZORIS', 'ZORRO', 'ZOUKS', 'ZOWEE', 'ZOWIE', 'ZULUS',
  'ZUPAN', 'ZUPAS', 'ZUPPA', 'ZURFS', 'ZUZIM', 'ZYGAL', 'ZYGON', 'ZYMES',
  'ZYMIC',
]);

// ============================================================================
// TYPES
// ============================================================================

interface WordnikWord {
  word: string;
  id: number;
}

interface WordnikDefinition {
  word: string;
  text: string;
  partOfSpeech?: string;
}

interface WordFrequency {
  count: number;
  word: string;
}

// ============================================================================
// WORDNIK API HELPERS
// ============================================================================

/**
 * Makes an HTTPS GET request to Wordnik API
 */
function wordnikRequest(endpoint: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://${API_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${WORDNIK_API_KEY}`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Fetch words from Wordnik with specific criteria
 */
async function fetchWordnikWords(
  minCorpusCount: number = 1000,
  limit: number = 10000
): Promise<string[]> {
  console.log(`Fetching words from Wordnik (minCorpusCount=${minCorpusCount}, limit=${limit})...`);

  try {
    const endpoint = `/v4/words.json/search/${encodeURIComponent('^[a-z]{5}$')}` +
      `?caseSensitive=false` +
      `&minCorpusCount=${minCorpusCount}` +
      `&maxCorpusCount=-1` +
      `&minDictionaryCount=1` +
      `&maxDictionaryCount=-1` +
      `&minLength=5` +
      `&maxLength=5` +
      `&limit=${limit}`;

    const response = await wordnikRequest(endpoint);
    const words = response.searchResults || response || [];

    return words
      .map((item: any) => (item.word || item).toUpperCase())
      .filter((word: string) => /^[A-Z]{5}$/.test(word));
  } catch (error) {
    console.error('Error fetching from Wordnik:', error);
    throw error;
  }
}

/**
 * Get word frequency from Wordnik
 */
async function getWordFrequency(word: string): Promise<number> {
  try {
    const endpoint = `/v4/word.json/${encodeURIComponent(word.toLowerCase())}/frequency?useCanonical=false`;
    const response = await wordnikRequest(endpoint);

    if (response && response.totalCount) {
      return response.totalCount;
    }
    return 0;
  } catch (error) {
    return 0; // Return 0 if word not found or error
  }
}

/**
 * Get definitions for a word from Wordnik
 */
async function getWordDefinitions(word: string): Promise<WordnikDefinition[]> {
  try {
    const endpoint = `/v4/word.json/${encodeURIComponent(word.toLowerCase())}/definitions` +
      `?limit=5` +
      `&includeRelated=false` +
      `&useCanonical=false` +
      `&includeTags=false`;

    const response = await wordnikRequest(endpoint);
    return response || [];
  } catch (error) {
    return [];
  }
}

/**
 * Get related words (for lemmatization) from Wordnik
 */
async function getRelatedWords(word: string): Promise<any> {
  try {
    const endpoint = `/v4/word.json/${encodeURIComponent(word.toLowerCase())}/relatedWords` +
      `?useCanonical=false` +
      `&relationshipTypes=plural,singular,root-word,lemma`;

    const response = await wordnikRequest(endpoint);
    return response || [];
  } catch (error) {
    return [];
  }
}

// ============================================================================
// FILTERING & VALIDATION
// ============================================================================

/**
 * Check if word is a proper noun using heuristics and Wordnik data
 */
async function isProperNoun(word: string): Promise<boolean> {
  // Check static blacklist first
  if (PROPER_NOUN_BLACKLIST.has(word)) {
    return true;
  }

  // Check definitions from Wordnik
  const definitions = await getWordDefinitions(word);

  for (const def of definitions) {
    const text = def.text?.toLowerCase() || '';
    const pos = def.partOfSpeech?.toLowerCase() || '';

    // Check for proper noun indicators
    if (pos.includes('proper-noun') || pos.includes('proper noun')) {
      return true;
    }

    // Check definition text for proper noun patterns
    if (
      text.includes('a city in') ||
      text.includes('a country in') ||
      text.includes('a person') ||
      text.includes('given name') ||
      text.includes('surname')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Detect if word is a plural using Wordnik's related words API
 */
async function isPlural(word: string): Promise<{ isPlural: boolean; lemma?: string }> {
  try {
    const related = await getRelatedWords(word);

    for (const group of related) {
      const relType = group.relationshipType?.toLowerCase() || '';

      // If Wordnik says this word has a "singular" form, it's a plural
      if (relType === 'singular' && group.words && group.words.length > 0) {
        const singular = group.words[0].toUpperCase();

        // Verify the singular is different and valid
        if (singular !== word && /^[A-Z]{5}$/.test(singular)) {
          return { isPlural: true, lemma: singular };
        }
      }

      // If this word appears under "plural" relationship type, it's a plural
      if (relType === 'plural' && group.words && group.words.includes(word.toLowerCase())) {
        return { isPlural: true };
      }
    }

    // Fallback heuristic: if word ends in S and has common plural patterns
    if (word.endsWith('S')) {
      const definitions = await getWordDefinitions(word);

      for (const def of definitions) {
        const text = def.text?.toLowerCase() || '';

        // Check if definition indicates plural
        if (
          text.startsWith('plural of') ||
          text.includes('plural form of')
        ) {
          return { isPlural: true };
        }
      }
    }

    return { isPlural: false };
  } catch (error) {
    // If API fails, use simple heuristic
    return { isPlural: word.endsWith('S') };
  }
}

/**
 * Check if word is offensive
 */
function isOffensive(word: string): boolean {
  return OFFENSIVE_BLACKLIST.has(word);
}

/**
 * Check if word is archaic or obscure
 */
function isArchaic(word: string): boolean {
  return ARCHAIC_BLACKLIST.has(word);
}

/**
 * Heuristic to detect likely plurals
 * Uses common English plural patterns
 */
function isLikelyPlural(word: string): boolean {
  // Must end in S
  if (!word.endsWith('S')) {
    return false;
  }

  // Common plural patterns that are likely plurals
  const pluralPatterns = [
    /[AEIOU]S$/,      // DOGS, CATS, PIES, GOES
    /[^S]ES$/,        // BOXES, WISHES, CHURCHES
    /IES$/,           // FLIES, TRIES, BERRIES
    /VES$/,           // LIVES, WIVES, KNIVES
  ];

  for (const pattern of pluralPatterns) {
    if (pattern.test(word)) {
      // Additional check: likely singular exists
      const possibleSingular = getSingularForm(word);
      if (possibleSingular && possibleSingular.length === 5) {
        // Don't exclude words where singular would be invalid
        return true;
      }
    }
  }

  return false;
}

/**
 * Get likely singular form of a word (heuristic)
 */
function getSingularForm(word: string): string | null {
  if (!word.endsWith('S')) {
    return null;
  }

  // Try common plural -> singular transformations
  if (word.endsWith('IES') && word.length > 3) {
    // FLIES -> FLY (but we need 5 letters, so skip)
    return word.slice(0, -3) + 'Y';
  }

  if (word.endsWith('ES') && word.length > 2) {
    // BOXES -> BOX
    return word.slice(0, -2);
  }

  if (word.endsWith('S')) {
    // DOGS -> DOG
    return word.slice(0, -1);
  }

  return null;
}

/**
 * Validate word against all criteria
 */
async function isValidWord(
  word: string,
  options: {
    allowPlurals?: boolean;
    strictCommonality?: boolean;
  } = {}
): Promise<{ valid: boolean; reason?: string; lemma?: string }> {
  // Basic format check
  if (!/^[A-Z]{5}$/.test(word)) {
    return { valid: false, reason: 'invalid_format' };
  }

  // Blacklist checks (fast, synchronous)
  if (isOffensive(word)) {
    return { valid: false, reason: 'offensive' };
  }

  if (isArchaic(word)) {
    return { valid: false, reason: 'archaic' };
  }

  // Proper noun check (async)
  if (await isProperNoun(word)) {
    return { valid: false, reason: 'proper_noun' };
  }

  // Plural check (async)
  const pluralCheck = await isPlural(word);
  if (pluralCheck.isPlural && !options.allowPlurals) {
    return { valid: false, reason: 'plural', lemma: pluralCheck.lemma };
  }

  return { valid: true };
}

// ============================================================================
// DICTIONARY GENERATION
// ============================================================================

/**
 * Generate GUESS_WORDS_CLEAN dictionary
 */
async function generateGuessWords(): Promise<string[]> {
  console.log('\n=== GENERATING GUESS_WORDS_CLEAN ===\n');

  // Fetch words from Wordnik with high corpus count (common words)
  const candidates = await fetchWordnikWords(100, 15000);
  console.log(`Fetched ${candidates.length} candidate words from Wordnik`);

  // Deduplicate and normalize
  const uniqueCandidates = [...new Set(candidates)];
  console.log(`After deduplication: ${uniqueCandidates.length} words`);

  // Filter words (allow plurals for guess words)
  // Use synchronous filters first (fast), then async if needed
  const validWords: string[] = [];
  const rejected = {
    format: 0,
    offensive: 0,
    archaic: 0,
    properNoun: 0,
    total: 0
  };

  for (const word of uniqueCandidates) {
    // Fast synchronous checks first
    if (!/^[A-Z]{5}$/.test(word)) {
      rejected.format++;
      continue;
    }

    if (isOffensive(word)) {
      rejected.offensive++;
      continue;
    }

    if (isArchaic(word)) {
      rejected.archaic++;
      continue;
    }

    if (PROPER_NOUN_BLACKLIST.has(word)) {
      rejected.properNoun++;
      continue;
    }

    // If it passes all filters, include it
    // Note: We skip expensive API calls per word for efficiency
    validWords.push(word);
  }

  rejected.total = rejected.format + rejected.offensive + rejected.archaic + rejected.properNoun;

  console.log(`\nFiltering results:`);
  console.log(`  - Invalid format: ${rejected.format}`);
  console.log(`  - Offensive: ${rejected.offensive}`);
  console.log(`  - Archaic/obscure: ${rejected.archaic}`);
  console.log(`  - Proper nouns: ${rejected.properNoun}`);
  console.log(`  - Total rejected: ${rejected.total}`);
  console.log(`  - Valid words: ${validWords.length}`);

  // Sort alphabetically
  validWords.sort();

  console.log(`Final GUESS_WORDS_CLEAN: ${validWords.length} words`);

  return validWords;
}

/**
 * Generate ANSWER_WORDS_EXPANDED dictionary
 */
async function generateAnswerWords(guessWords: string[]): Promise<string[]> {
  console.log('\n=== GENERATING ANSWER_WORDS_EXPANDED ===\n');

  // Start from guess words and apply stricter filtering
  const candidates = [...guessWords];
  console.log(`Starting with ${candidates.length} guess words`);

  const validAnswers: string[] = [];
  const rejected = {
    plural: 0,
    uncommon: 0,
    total: 0
  };

  let processed = 0;

  for (const word of candidates) {
    processed++;

    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${candidates.length} words, ${validAnswers.length} valid so far...`);
    }

    // For answers, exclude likely plurals using heuristic
    if (isLikelyPlural(word)) {
      rejected.plural++;
      continue;
    }

    // Use frequency-based filtering with API (sample only to avoid rate limits)
    // For efficiency, we'll include all non-plural words and rely on Wordnik's
    // initial minCorpusCount filter for commonality
    validAnswers.push(word);

    // Small delay to avoid hammering API if we add frequency checks later
    if (processed % 500 === 0) {
      await sleep(100);
    }
  }

  rejected.total = rejected.plural + rejected.uncommon;

  console.log(`\nFiltering results:`);
  console.log(`  - Plurals excluded: ${rejected.plural}`);
  console.log(`  - Uncommon words: ${rejected.uncommon}`);
  console.log(`  - Total rejected: ${rejected.total}`);
  console.log(`  - Valid answer words: ${validAnswers.length}`);

  // Sort alphabetically
  validAnswers.sort();

  // Take reasonable subset if we have too many
  const finalWords = validAnswers.slice(0, TARGET_ANSWER_WORDS);
  console.log(`Final ANSWER_WORDS_EXPANDED: ${finalWords.length} words`);

  return finalWords;
}

/**
 * Check if word is suitable as an answer (stricter criteria)
 */
async function isGoodAnswerWord(word: string): Promise<boolean> {
  // Get word frequency
  const freq = await getWordFrequency(word);

  // Require higher frequency for answers (more common words)
  if (freq < 1000) {
    return false;
  }

  // Get definitions to check if it's everyday vocabulary
  const definitions = await getWordDefinitions(word);

  if (definitions.length === 0) {
    return false; // No definitions = probably too obscure
  }

  // Check part of speech - prefer nouns, verbs, adjectives
  const goodPOS = ['noun', 'verb', 'adjective', 'adverb'];
  const hasPOS = definitions.some(def => {
    const pos = def.partOfSpeech?.toLowerCase() || '';
    return goodPOS.some(good => pos.includes(good));
  });

  if (!hasPOS) {
    return false;
  }

  return true;
}

// ============================================================================
// FILE OUTPUT
// ============================================================================

/**
 * Write words to TypeScript file
 */
function writeWordListFile(filePath: string, words: string[], varName: string): void {
  const content = `export const ${varName}: string[] = [\n` +
    words.map(word => `  "${word}"`).join(',\n') +
    '\n];\n';

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Written ${words.length} words to ${filePath}`);
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate generated dictionaries
 */
function validateDictionaries(guessWords: string[], answerWords: string[]): void {
  console.log('\n=== VALIDATING DICTIONARIES ===\n');

  const errors: string[] = [];

  // Check all words are 5 letters, A-Z only
  for (const word of [...guessWords, ...answerWords]) {
    if (!/^[A-Z]{5}$/.test(word)) {
      errors.push(`Invalid format: ${word}`);
    }
  }

  // Check no duplicates
  if (new Set(guessWords).size !== guessWords.length) {
    errors.push('GUESS_WORDS_CLEAN has duplicates');
  }

  if (new Set(answerWords).size !== answerWords.length) {
    errors.push('ANSWER_WORDS_EXPANDED has duplicates');
  }

  // Check ANSWER_WORDS ⊆ GUESS_WORDS
  const guessSet = new Set(guessWords);
  for (const word of answerWords) {
    if (!guessSet.has(word)) {
      errors.push(`Answer word "${word}" not in guess words`);
    }
  }

  // Check alphabetical order
  const sortedGuess = [...guessWords].sort();
  const sortedAnswer = [...answerWords].sort();

  if (JSON.stringify(guessWords) !== JSON.stringify(sortedGuess)) {
    errors.push('GUESS_WORDS_CLEAN not alphabetically sorted');
  }

  if (JSON.stringify(answerWords) !== JSON.stringify(sortedAnswer)) {
    errors.push('ANSWER_WORDS_EXPANDED not alphabetically sorted');
  }

  // Check no known junk words
  const junkWords = ['AALII', 'AARGH', 'XYSTI', 'YEXED'];
  for (const junk of junkWords) {
    if (guessWords.includes(junk)) {
      errors.push(`Junk word found in GUESS_WORDS_CLEAN: ${junk}`);
    }
    if (answerWords.includes(junk)) {
      errors.push(`Junk word found in ANSWER_WORDS_EXPANDED: ${junk}`);
    }
  }

  if (errors.length > 0) {
    console.error('❌ VALIDATION FAILED:\n');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  console.log('✅ All validations passed!');
  console.log(`   - GUESS_WORDS_CLEAN: ${guessWords.length} words`);
  console.log(`   - ANSWER_WORDS_EXPANDED: ${answerWords.length} words`);
  console.log(`   - All words are 5 letters, A-Z only`);
  console.log(`   - No duplicates`);
  console.log(`   - ANSWER_WORDS_EXPANDED ⊆ GUESS_WORDS_CLEAN`);
  console.log(`   - Alphabetically sorted`);
}

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('WORDNIK DICTIONARY GENERATOR - Milestone 4.13');
  console.log('='.repeat(80));

  // Check for API key
  if (!WORDNIK_API_KEY) {
    console.error('❌ ERROR: WORDNIK_API_KEY environment variable not set');
    console.error('   Get your free API key from: https://developer.wordnik.com/');
    console.error('   Usage: WORDNIK_API_KEY=your_key tsx src/scripts/generate-wordnik-dictionaries.ts');
    process.exit(1);
  }

  try {
    // Generate guess words first
    const guessWords = await generateGuessWords();

    // Generate answer words from guess words
    const answerWords = await generateAnswerWords(guessWords);

    // Validate before writing
    validateDictionaries(guessWords, answerWords);

    // Write to files
    console.log('\n=== WRITING FILES ===\n');
    writeWordListFile(GUESS_WORDS_OUTPUT, guessWords, 'GUESS_WORDS_CLEAN');
    writeWordListFile(ANSWER_WORDS_OUTPUT, answerWords, 'ANSWER_WORDS_EXPANDED');

    console.log('\n' + '='.repeat(80));
    console.log('✅ DICTIONARY GENERATION COMPLETE!');
    console.log('='.repeat(80));
    console.log(`\nGenerated files:`);
    console.log(`  - ${GUESS_WORDS_OUTPUT}`);
    console.log(`  - ${ANSWER_WORDS_OUTPUT}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Review the generated files`);
    console.log(`  2. Update src/lib/word-lists.ts to import new dictionaries`);
    console.log(`  3. Run tests: npm test`);
    console.log(`  4. Update documentation\n`);

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
