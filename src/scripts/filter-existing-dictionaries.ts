#!/usr/bin/env tsx
/**
 * Filter Existing Dictionaries - Milestone 4.13 (Interim Solution)
 *
 * This script filters the current word lists to create cleaner dictionaries
 * while we wait for Wordnik API integration. It applies the same filtering
 * rules as the Wordnik script but uses the existing word lists as input.
 *
 * This is a pragmatic interim solution that makes immediate progress.
 *
 * Usage:
 *   tsx src/scripts/filter-existing-dictionaries.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Import current word lists
const currentDataDir = path.join(__dirname, '../data');
const currentGuessWordsPath = path.join(currentDataDir, 'guess_words.ts');
const currentAnswerWordsPath = path.join(currentDataDir, 'answer_words.ts');

// Output paths
const GUESS_WORDS_OUTPUT = path.join(currentDataDir, 'guess_words_clean.ts');
const ANSWER_WORDS_OUTPUT = path.join(currentDataDir, 'answer_words_expanded.ts');

// ============================================================================
// BLACKLISTS (same as Wordnik script)
// ============================================================================

const OFFENSIVE_BLACKLIST = new Set([
  'SLUTS', 'WHORE', 'BITCH', 'COCKS', 'CUNTS', 'FUCKS', 'SHITS',
  'PRICK', 'PUSSY', 'TARDS', 'BITTY', 'CRAPS', 'HELLS', 'SATAN',
]);

const PROPER_NOUN_BLACKLIST = new Set([
  'JESUS', 'CHINA', 'INDIA', 'SPAIN', 'ITALY', 'PARIS', 'TOKYO',
  'JAMES', 'JONES', 'SMITH', 'BROWN', 'DAVIS', 'MARCH', 'APRIL',
  'ALICE', 'BOBBY', 'KAREN', 'MASON', 'LOGAN', 'LUCAS', 'HENRY',
  'WYATT', 'ISAAC', 'OSCAR', 'ELLIE', 'HAZEL', 'CLARA', 'ABBIE',
]);

// Comprehensive archaic/Scrabble word blacklist
const ARCHAIC_BLACKLIST = new Set([
  // AA-words (Scrabble garbage)
  'AALII', 'AAHED', 'AARGH', 'AARTI',

  // AB- obscure terms
  'ABACA', 'ABACI', 'ABAFT', 'ABAHT', 'ABAKA', 'ABAMP', 'ABAND', 'ABASK',
  'ABAYA', 'ABCEE', 'ABEAM', 'ABEAR', 'ABELE', 'ABENG', 'ABJAD', 'ABJUD',
  'ABLET', 'ABLOW', 'ABMHO', 'ABNET', 'ABOHM', 'ABOIL', 'ABOMA', 'ABOON',
  'ABORD', 'ABORE', 'ABORN', 'ABRAM', 'ABRAY', 'ABRIM', 'ABRIN', 'ABRIS',
  'ABSEY', 'ABSIT', 'ABUNA', 'ABUNE', 'ABUZZ', 'ABYES', 'ABYSM',

  // AC- obscure
  'ACAIS', 'ACARI', 'ACCAS', 'ACCOY', 'ACERB', 'ACETA', 'ACHAR',
  'ACIDY', 'ACINI', 'ACKEE', 'ACMES', 'ACMIC', 'ACNED', 'ACNES', 'ACOCK',
  'ACOLD', 'ACRED', 'ACROS', 'ACTIN', 'ACTON', 'ADAWS',

  // AD- obscure
  'ADBOT', 'ADDAX', 'ADDIO', 'ADDLE', 'ADEEM', 'ADHAN',
  'ADIOS', 'ADITS', 'ADMAN', 'ADMEN', 'ADMIX', 'ADOBO', 'ADOWN', 'ADOZE',
  'ADRAD', 'ADRED', 'ADSUM', 'ADUKI', 'ADUNC', 'ADUST', 'ADVEW', 'ADYTA',

  // AE- obscure
  'AECIA', 'AEDES', 'AEGIS', 'AEONS', 'AERIE', 'AEROS', 'AESIR',

  // AG- obscure
  'AGAMA', 'AGAMI', 'AGARS', 'AGAST', 'AGAVE', 'AGAZE', 'AGENE', 'AGERS',
  'AGGER', 'AGGIE', 'AGGRO', 'AGGRY', 'AGHAS', 'AGILA', 'AGIOS', 'AGISM',
  'AGIST', 'AGITA', 'AGLEE', 'AGLET', 'AGLEY', 'AGLOO', 'AGLUS', 'AGMAS',
  'AGOGE', 'AGONE', 'AGONS', 'AGOOD', 'AGRIA', 'AGRIN', 'AGROS', 'AGUED',
  'AGUES', 'AGUNA', 'AGUTI',

  // X-heavy (Scrabble)
  'XEBEC', 'XEMES', 'XENIA', 'XENIC', 'XENON', 'XERIC', 'XEROX', 'XERUS',
  'XOANA', 'XOLOS', 'XRAYS', 'XYLAN', 'XYLEM', 'XYLIC', 'XYLOL', 'XYLYL',
  'XYSTI', 'XYSTS',

  // Q without U
  'QADIS', 'QAIDS', 'QAJAQ', 'QANAT', 'QAPHS', 'QAPIK', 'QAWAH',
  'QIBLA', 'QINAH', 'QINTA', 'QIRSH', 'QOPHS', 'QORMA',

  // Y-heavy obscure
  'YEXED', 'YEXES', 'YIRTH', 'YITES', 'YLIKE', 'YLKES', 'YMOLT', 'YMPES',
  'YOBBO', 'YOBBY', 'YOCKS', 'YODHS', 'YODLE', 'YOJAN', 'YOKUL',
  'YOMIM', 'YOMPS', 'YONIC', 'YONKS', 'YOOFS', 'YOOPS', 'YORPS', 'YOUKS',
  'YOURN', 'YOURT', 'YOUSE', 'YOWED', 'YOWES', 'YOWIE',

  // Z-heavy obscure
  'ZAYIN', 'ZEALS', 'ZEBEC', 'ZEBUB', 'ZEBUS', 'ZEDAS', 'ZEINS', 'ZENDO',
  'ZERDA', 'ZERKS', 'ZHOMO', 'ZIBET', 'ZIFFS', 'ZIGAN', 'ZILAS',
  'ZILLA', 'ZILLS', 'ZIMBI', 'ZIMBS', 'ZINCO', 'ZINCY', 'ZINEB', 'ZINKE',
  'ZINKY', 'ZIRAM', 'ZITIS', 'ZIZEL', 'ZIZIT', 'ZLOTE', 'ZLOTY', 'ZOAEA',
  'ZOBOS', 'ZOBUS', 'ZOCCO', 'ZOEAE', 'ZOEAL', 'ZOEAS', 'ZOISM', 'ZOIST',
  'ZOMBI', 'ZONAE', 'ZONDA', 'ZOOEA', 'ZOOEY', 'ZOOID', 'ZOOKS', 'ZOOMY',
  'ZOONS', 'ZOOTY', 'ZOPPA', 'ZOPPO', 'ZORIL', 'ZORIS', 'ZORRO', 'ZOUKS',
  'ZOWEE', 'ZOWIE', 'ZUPAN', 'ZUPAS', 'ZUPPA', 'ZURFS', 'ZUZIM', 'ZYGAL',
  'ZYGON', 'ZYMES', 'ZYMIC',

  // More common Scrabble garbage
  'AJUGA', 'AJWAN', 'ALAAP', 'ALAPA', 'ALAPS', 'ALARY', 'ALATE', 'ALAYS',
  'ALBAS', 'ALBEE', 'ALCID', 'ALCOS', 'ALDEA', 'ALDOL', 'ALECK', 'ALECS',
  'ALEFS', 'ALEPH', 'ALEYE', 'ALFAS', 'ALGAL', 'ALGAS', 'ALGID', 'ALGIN',
  'ALGOR', 'ALGUM', 'ALIAS', 'ALIFS', 'ALINE', 'ALIST', 'ALIYA', 'ALKIE',
  'ALKOS', 'ALKYD', 'ALKYL', 'ALLAY', 'ALLEE', 'ALLEL', 'ALLIS', 'ALLOD',
  'ALLYL', 'ALMAH', 'ALMAS', 'ALMEH', 'ALMES', 'ALMUD', 'ALMUG', 'ALODS',
  'ALOED', 'ALOES', 'ALOHA', 'ALOIN', 'ALOOS', 'ALOWE', 'ALTHO', 'ALTOS',
  'ALULA', 'ALUMS', 'ALURE', 'ALVAR', 'ALWAY', 'AMAHS', 'AMAIN', 'AMASS',
  'AMAUT', 'AMBAN', 'AMBAS', 'AMBIT', 'AMBOS', 'AMBRY', 'AMEBA', 'AMEER',
  'AMENE', 'AMENS', 'AMENT', 'AMIAS', 'AMICE', 'AMICI', 'AMIDE', 'AMIDO',
  'AMIDS', 'AMIES', 'AMIGA', 'AMIGO', 'AMINE', 'AMINO', 'AMINS', 'AMIRS',
  'AMLAS', 'AMMAN', 'AMMON', 'AMMOS', 'AMNIA', 'AMNIC', 'AMNIO', 'AMOKS',
  'AMOLE', 'AMORT', 'AMOUR', 'AMOVE', 'AMOWT', 'AMPED', 'AMPUL', 'AMRIT',
  'AMUCK', 'AMYLS',
]);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function loadWordList(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8');

  // Extract words from TypeScript array
  const match = content.match(/\[([\s\S]*)\]/);
  if (!match) {
    throw new Error(`Failed to parse word list from ${filePath}`);
  }

  const arrayContent = match[1];
  const words = arrayContent
    .split(/[,\n]/)
    .map(line => line.trim().replace(/['"]/g, ''))
    .filter(word => word.length === 5 && /^[A-Z]{5}$/.test(word));

  return words;
}

function isOffensive(word: string): boolean {
  return OFFENSIVE_BLACKLIST.has(word);
}

function isProperNoun(word: string): boolean {
  return PROPER_NOUN_BLACKLIST.has(word);
}

function isArchaic(word: string): boolean {
  return ARCHAIC_BLACKLIST.has(word);
}

function isObscurePattern(word: string): boolean {
  // Filter patterns that are rare in common English

  // Multiple consecutive uncommon letters
  if (/[XZ]{2}/.test(word)) return true;  // XX, ZZ, XZ, ZX
  if (/[QJK]{2}/.test(word)) return true;  // QQ, JJ, KK, QJ, etc.

  // Uncommon letter combinations
  if (word.includes('ZZ')) return true;
  if (word.includes('QU') && word.includes('X')) return true;  // Both QU and X is rare

  // Words with too many rare letters
  const rareLetters = (word.match(/[QXZJ]/g) || []).length;
  if (rareLetters >= 2) return true;  // 2+ rare letters

  // Words starting with uncommon patterns
  if (/^[QXZJ][QXZJ]/.test(word)) return true;  // Two rare letters at start

  // Uncommon vowel patterns (no vowels or all vowels)
  const vowels = (word.match(/[AEIOU]/g) || []).length;
  if (vowels === 0) return true;  // No vowels (XYSTS, etc.)
  if (vowels === 5) return true;  // All vowels (unlikely to be common)

  // Words with 4 consonants in a row
  if (/[BCDFGHJKLMNPQRSTVWXYZ]{4}/.test(word)) return true;

  // Words ending in uncommon patterns
  if (/[QZ]$/.test(word)) return true;  // Ends in Q or Z

  return false;
}

function isUnfriendlyForCasualPlay(word: string): boolean {
  // Additional filtering for answer words - remove words that are:
  // - Too technical/jargony
  // - Obscure/archaic
  // - Hard to guess patterns

  // Words with uncommon double letters
  if (/([FGHJKMPQVWXYZ])\1/.test(word)) return true;  // FF, GG, HH, etc (rare doubles)

  // Three of the same letter
  if (/(.)\1\1/.test(word)) return true;

  // Very uncommon starting patterns
  if (/^[QXZJ]/.test(word)) return true;  // Starting with Q, X, Z, J is uncommon

  // Words with 3+ consonants in a row (stricter than guess words)
  if (/[BCDFGHJKLMNPQRSTVWXYZ]{3}/.test(word)) return true;

  // Only 1 vowel (usually harder/less common words)
  const vowels = (word.match(/[AEIOU]/g) || []).length;
  if (vowels <= 1) return true;

  return false;
}

function isLikelyPlural(word: string): boolean {
  if (!word.endsWith('S')) {
    return false;
  }

  // Exception: words where 'S' is not a plural marker (must end in SS, US, or other non-plural S)
  const nonPluralS = new Set([
    // Double S words
    'BRASS', 'CHESS', 'CLASS', 'CROSS', 'DRESS', 'GLASS', 'GRASS', 'GUESS',
    'BLESS', 'BLISS', 'ABYSS', 'TRUSS', 'FLOSS', 'GLOSS',

    // Words ending in -US
    'ALIAS', 'ATLAS', 'BASIS', 'OASIS', 'VIRUS', 'FOCUS', 'GENUS', 'MINUS',
    'NEXUS', 'BONUS', 'SINUS', 'CAMUS', 'HUMUS', 'ICTUS', 'LOCUS', 'LOTUS',
    'MUCUS', 'REBUS', 'TORUS', 'BOGUS', 'CASUS', 'FETUS', 'FUCUS', 'MANUS',
    'RAMUS', 'RISUS', 'SOLUS', 'TYPUS', 'VAGUS',

    // Words ending in -IS
    'BASIS', 'OASIS', 'CRISIS', 'THESIS',

    // Words ending in -AS
    'ALIAS', 'ATLAS', 'TEXAS', 'JUDAS', 'ABBAS', 'TAPAS', 'LUCAS', 'JONAS',

    // Other non-plural S words
    'GROSS', 'LOSS', 'MASS', 'MISS', 'PASS', 'BOSS', 'TOSS', 'KISS',
    'PRESS', 'STRESS', 'CHAOS', 'JESUS',
  ]);

  if (nonPluralS.has(word)) {
    return false;
  }

  // If word ends in SS, it's not a plural
  if (word.endsWith('SS')) {
    return false;
  }

  // If word ends in US, it's not a plural (Latin/Greek words)
  if (word.endsWith('US')) {
    return false;
  }

  // Common plural patterns - much broader now
  const pluralPatterns = [
    /[^S]S$/,          // Any word ending in S that's not SS (BOOKS, GAMES, TREES, DOGS, CATS)
  ];

  for (const pattern of pluralPatterns) {
    if (pattern.test(word)) {
      // Additional check: is there a plausible singular form?
      const singular = getSingularForm(word);
      if (singular) {
        return true;  // Likely a plural
      }
    }
  }

  return false;
}

function getSingularForm(word: string): string | null {
  if (!word.endsWith('S')) {
    return null;
  }

  // Try common plural -> singular transformations
  if (word.endsWith('IES') && word.length > 3) {
    // FLIES -> FLY, BERRIES -> BERRY
    const singular = word.slice(0, -3) + 'Y';
    if (singular.length === 4 || singular.length === 5 || singular.length === 6) {
      return singular;
    }
  }

  if (word.endsWith('CHES') || word.endsWith('SHES') || word.endsWith('XRES')) {
    // CHURCHES -> CHURCH, WISHES -> WISH, BOXES -> BOX
    const singular = word.slice(0, -2);
    if (singular.length >= 4) {
      return singular;
    }
  }

  if (word.endsWith('ES') && word.length > 2) {
    // Try removing ES: BOXES -> BOX
    const singular = word.slice(0, -2);
    if (singular.length >= 3) {
      return singular;
    }
  }

  if (word.endsWith('S') && !word.endsWith('SS') && !word.endsWith('US')) {
    // Try removing S: DOGS -> DOG, BOOKS -> BOOK
    const singular = word.slice(0, -1);
    if (singular.length >= 3) {
      return singular;
    }
  }

  return null;
}

function isModernCommonWord(word: string): boolean {
  // Manual curated list of modern everyday words we want to KEEP
  // This helps ensure we don't over-filter
  const alwaysKeep = new Set([
    'ABOUT', 'ABOVE', 'ABUSE', 'ACUTE', 'ADMIT', 'ADOPT', 'ADULT', 'AFTER',
    'AGAIN', 'AGENT', 'AGREE', 'AHEAD', 'ALARM', 'ALBUM', 'ALERT', 'ALIEN',
    'ALIGN', 'ALIKE', 'ALIVE', 'ALLOW', 'ALONE', 'ALONG', 'ALTER', 'ANGEL',
    'ANGER', 'ANGLE', 'ANGRY', 'APART', 'APPLE', 'APPLY', 'ARENA', 'ARGUE',
    'ARISE', 'ARMED', 'ARMOR', 'ARRAY', 'ARROW', 'ASIDE', 'ASSET', 'ATLAS',
    'AUDIO', 'AUDIT', 'AVOID', 'AWAKE', 'AWARD', 'AWARE', 'BADLY', 'BAKER',
    'BATCH', 'BEACH', 'BEGAN', 'BEGIN', 'BEING', 'BENCH', 'BILLY', 'BIRTH',
    'BLACK', 'BLADE', 'BLAME', 'BLANK', 'BLAST', 'BLEED', 'BLEND', 'BLESS',
    'BLIND', 'BLOCK', 'BLOOD', 'BLOOM', 'BLOWN', 'BLUES', 'BLUNT', 'BOARD',
    'BOOST', 'BOOTH', 'BOUND', 'BRAIN', 'BRAND', 'BRAVE', 'BREAD', 'BREAK',
    'BREED', 'BRICK', 'BRIEF', 'BRING', 'BROAD', 'BROKE', 'BROWN', 'BUILD',
    'BUILT', 'BUNCH', 'BUYER', 'CABLE', 'CALIF', 'CARRY', 'CATCH', 'CAUSE',
    'CHAIN', 'CHAIR', 'CHAOS', 'CHARM', 'CHART', 'CHASE', 'CHEAP', 'CHECK',
    'CHEST', 'CHIEF', 'CHILD', 'CHINA', 'CHOSE', 'CIVIL', 'CLAIM', 'CLASS',
    'CLEAN', 'CLEAR', 'CLICK', 'CLIFF', 'CLIMB', 'CLOCK', 'CLONE', 'CLOSE',
    'CLOTH', 'CLOUD', 'COACH', 'COAST', 'COUCH', 'COUNT', 'COURT', 'COVER',
    'CRACK', 'CRAFT', 'CRASH', 'CRAZY', 'CREAM', 'CRIME', 'CRISP', 'CROSS',
    'CROWD', 'CROWN', 'CRUDE', 'CURVE', 'CYCLE', 'DAILY', 'DANCE', 'DATUM',
    'DEALT', 'DEATH', 'DEBUT', 'DELAY', 'DELTA', 'DENSE', 'DEPOT', 'DEPTH',
    'DOING', 'DOUBT', 'DOZEN', 'DRAFT', 'DRAMA', 'DRANK', 'DRAWN', 'DREAM',
    'DRESS', 'DRILL', 'DRINK', 'DRIVE', 'DROVE', 'DYING', 'EAGER', 'EAGLE',
    'EARLY', 'EARTH', 'EIGHT', 'ELECT', 'ELITE', 'EMPTY', 'ENEMY', 'ENJOY',
    'ENTER', 'ENTRY', 'EQUAL', 'ERROR', 'EVENT', 'EVERY', 'EXACT', 'EXIST',
    'EXTRA', 'FAITH', 'FALSE', 'FAULT', 'FIBER', 'FIELD', 'FIFTH', 'FIFTY',
    'FIGHT', 'FINAL', 'FIRST', 'FIXED', 'FLASH', 'FLEET', 'FLESH', 'FLOOR',
    'FLUID', 'FOCUS', 'FORCE', 'FORTH', 'FORTY', 'FORUM', 'FOUND', 'FRAME',
    'FRANK', 'FRAUD', 'FRESH', 'FRONT', 'FRUIT', 'FULLY', 'FUNNY', 'GHOST',
    'GIANT', 'GIVEN', 'GLASS', 'GLOBE', 'GLORY', 'GOING', 'GRACE', 'GRADE',
    'GRAND', 'GRANT', 'GRASS', 'GRAVE', 'GREAT', 'GREEN', 'GROSS', 'GROUP',
    'GROWN', 'GUARD', 'GUESS', 'GUEST', 'GUIDE', 'HAPPY', 'HARRY', 'HARSH',
    'HEART', 'HEAVY', 'HENCE', 'HENRY', 'HORSE', 'HOTEL', 'HOUSE', 'HUMAN',
    'IDEAL', 'IMAGE', 'INDEX', 'INNER', 'INPUT', 'ISSUE', 'JAPAN', 'JIMMY',
    'JOINT', 'JONES', 'JUDGE', 'KNOWN', 'LABEL', 'LARGE', 'LASER', 'LATER',
    'LAUGH', 'LAYER', 'LEARN', 'LEASE', 'LEAST', 'LEAVE', 'LEGAL', 'LEMON',
    'LEVEL', 'LEWIS', 'LIGHT', 'LIMIT', 'LINKS', 'LIVED', 'LOCAL', 'LOGIC',
    'LOOSE', 'LOWER', 'LUCKY', 'LUNCH', 'LYING', 'MAGIC', 'MAJOR', 'MAKER',
    'MARCH', 'MARIA', 'MATCH', 'MAYBE', 'MAYOR', 'MEANT', 'MEDIA', 'METAL',
    'METER', 'MIGHT', 'MINOR', 'MINUS', 'MIXED', 'MODEL', 'MONEY', 'MONTH',
    'MORAL', 'MOTOR', 'MOUNT', 'MOUSE', 'MOUTH', 'MOVED', 'MOVIE', 'MUSIC',
    'NEEDS', 'NEVER', 'NEWLY', 'NIGHT', 'NOISE', 'NORTH', 'NOTED', 'NOVEL',
    'NURSE', 'OCEAN', 'OCCUR', 'OFFER', 'OFTEN', 'ORDER', 'OTHER', 'OUGHT',
    'OUTER', 'OWNER', 'PAINT', 'PANEL', 'PAPER', 'PARIS', 'PARTY', 'PEACE',
    'PETER', 'PHASE', 'PHONE', 'PHOTO', 'PIECE', 'PILOT', 'PITCH', 'PLACE',
    'PLAIN', 'PLANE', 'PLANT', 'PLATE', 'PLAZA', 'POINT', 'POKER', 'POLAR',
    'POUND', 'POWER', 'PRESS', 'PRICE', 'PRIDE', 'PRIME', 'PRINT', 'PRIOR',
    'PRIZE', 'PROOF', 'PROUD', 'PROVE', 'QUEEN', 'QUERY', 'QUICK', 'QUIET',
    'QUITE', 'QUOTA', 'RADIO', 'RAISE', 'RANGE', 'RAPID', 'RATIO', 'REACH',
    'READY', 'REFER', 'RELAX', 'REPLY', 'RIDER', 'RIDGE', 'RIGHT', 'RIGID',
    'RIVAL', 'RIVER', 'ROMAN', 'ROUGH', 'ROUND', 'ROUTE', 'ROYAL', 'RURAL',
    'SCALE', 'SCENE', 'SCOPE', 'SCORE', 'SENSE', 'SERVE', 'SEVEN', 'SHALL',
    'SHAPE', 'SHARE', 'SHARP', 'SHEET', 'SHELF', 'SHELL', 'SHIFT', 'SHINE',
    'SHIRT', 'SHOCK', 'SHOOT', 'SHORT', 'SHOWN', 'SIGHT', 'SIMON', 'SINCE',
    'SIXTH', 'SIXTY', 'SIZED', 'SKILL', 'SLEEP', 'SLIDE', 'SMALL', 'SMART',
    'SMILE', 'SMITH', 'SMOKE', 'SOLID', 'SOLVE', 'SORRY', 'SOUND', 'SOUTH',
    'SPACE', 'SPARE', 'SPEAK', 'SPEED', 'SPEND', 'SPENT', 'SPLIT', 'SPOKE',
    'SPORT', 'STAFF', 'STAGE', 'STAKE', 'STAND', 'START', 'STATE', 'STEAM',
    'STEEL', 'STICK', 'STILL', 'STOCK', 'STONE', 'STOOD', 'STORE', 'STORM',
    'STORY', 'STRIP', 'STUCK', 'STUDY', 'STUFF', 'STYLE', 'SUGAR', 'SUITE',
    'SUPER', 'SWEET', 'TABLE', 'TAKEN', 'TASTE', 'TAXES', 'TEACH', 'TERRY',
    'TEXAS', 'THANK', 'THEFT', 'THEIR', 'THEME', 'THERE', 'THESE', 'THICK',
    'THING', 'THINK', 'THIRD', 'THOSE', 'THREE', 'THREW', 'THROW', 'TIGHT',
    'TITLE', 'TODAY', 'TOPIC', 'TOTAL', 'TOUCH', 'TOUGH', 'TOWER', 'TRACK',
    'TRADE', 'TRAIL', 'TRAIN', 'TREAT', 'TREND', 'TRIAL', 'TRIBE', 'TRICK',
    'TRIED', 'TRULY', 'TRUNK', 'TRUST', 'TRUTH', 'TWICE', 'UNDER', 'UNDUE',
    'UNION', 'UNITY', 'UNTIL', 'UPPER', 'UPSET', 'URBAN', 'USAGE', 'USUAL',
    'VALID', 'VALUE', 'VIDEO', 'VIRUS', 'VISIT', 'VITAL', 'VOCAL', 'VOICE',
    'WASTE', 'WATCH', 'WATER', 'WHEEL', 'WHERE', 'WHICH', 'WHILE', 'WHITE',
    'WHOLE', 'WHOSE', 'WOMAN', 'WOMEN', 'WORLD', 'WORRY', 'WORSE', 'WORST',
    'WORTH', 'WOULD', 'WOUND', 'WRITE', 'WRONG', 'WROTE', 'YIELD', 'YOUNG',
    'YOURS', 'YOUTH', 'PIZZA', 'SALAD', 'EMAIL', 'MANGO', 'CORAL', 'PEARL',
    'FLAME', 'GLOBE', 'CRISP', 'GRAPE', 'MELON', 'PEACH', 'LEMON', 'BERRY',
  ]);

  return alwaysKeep.has(word);
}

function writeWordListFile(filePath: string, words: string[], varName: string): void {
  const content = `export const ${varName}: string[] = [\n` +
    words.map(word => `  "${word}"`).join(',\n') +
    '\n];\n';

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Written ${words.length} words to ${filePath}`);
}

function validateDictionaries(guessWords: string[], answerWords: string[]): void {
  console.log('\n=== VALIDATION ===\n');

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
  const junkWords = ['AALII', 'AARGH', 'XYSTI', 'YEXED', 'ABACA', 'ABAFT', 'ABMHO'];
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
    throw new Error('Validation failed');
  }

  console.log('✅ All validations passed!');
  console.log(`   - GUESS_WORDS_CLEAN: ${guessWords.length} words`);
  console.log(`   - ANSWER_WORDS_EXPANDED: ${answerWords.length} words`);
  console.log(`   - All words are 5 letters, A-Z only`);
  console.log(`   - No duplicates`);
  console.log(`   - ANSWER_WORDS_EXPANDED ⊆ GUESS_WORDS_CLEAN`);
  console.log(`   - Alphabetically sorted`);
  console.log(`   - No known junk words`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('FILTER EXISTING DICTIONARIES - Milestone 4.13');
  console.log('='.repeat(80));

  // Load current word lists
  console.log('\n=== LOADING CURRENT WORD LISTS ===\n');
  const currentGuessWords = loadWordList(currentGuessWordsPath);
  const currentAnswerWords = loadWordList(currentAnswerWordsPath);

  console.log(`Loaded ${currentGuessWords.length} guess words`);
  console.log(`Loaded ${currentAnswerWords.length} answer words`);

  // Generate GUESS_WORDS_CLEAN
  console.log('\n=== GENERATING GUESS_WORDS_CLEAN ===\n');

  const cleanGuessWords: string[] = [];
  const rejectedGuess = {
    offensive: 0,
    properNoun: 0,
    archaic: 0,
    total: 0
  };

  for (const word of currentGuessWords) {
    if (isOffensive(word)) {
      rejectedGuess.offensive++;
      continue;
    }

    if (isProperNoun(word)) {
      rejectedGuess.properNoun++;
      continue;
    }

    if (isArchaic(word)) {
      rejectedGuess.archaic++;
      continue;
    }

    // Additional filter: Remove uncommon letter combinations and obscure words
    // to get closer to target size of ~5-6k words
    if (isObscurePattern(word) && !isModernCommonWord(word)) {
      rejectedGuess.archaic++;  // Count as archaic for stats
      continue;
    }

    cleanGuessWords.push(word);
  }

  rejectedGuess.total = rejectedGuess.offensive + rejectedGuess.properNoun + rejectedGuess.archaic;

  console.log(`Filtering results:`);
  console.log(`  - Offensive words rejected: ${rejectedGuess.offensive}`);
  console.log(`  - Proper nouns rejected: ${rejectedGuess.properNoun}`);
  console.log(`  - Archaic/obscure rejected: ${rejectedGuess.archaic}`);
  console.log(`  - Total rejected: ${rejectedGuess.total}`);
  console.log(`  - Valid words: ${cleanGuessWords.length}`);

  cleanGuessWords.sort();

  // Generate ANSWER_WORDS_EXPANDED
  console.log('\n=== GENERATING ANSWER_WORDS_EXPANDED ===\n');

  const cleanAnswerWords: string[] = [];
  const rejectedAnswer = {
    plural: 0,
    total: 0
  };

  let uncommonRejected = 0;

  for (const word of cleanGuessWords) {
    // Exclude plurals for answers (unless it's a known modern common word)
    if (isLikelyPlural(word)) {
      // Allow some common plurals that are essential words
      if (!isModernCommonWord(word)) {
        rejectedAnswer.plural++;
        continue;
      }
      // If it's a modern common word, keep it even if it's plural
    }

    // Additional selectivity for answer words: prioritize common words
    // Skip if modern common list exists, add all those words
    if (isModernCommonWord(word)) {
      cleanAnswerWords.push(word);
      continue;
    }

    // For non-modern-common words, be more selective
    // Skip if word has difficult patterns for casual players
    if (isUnfriendlyForCasualPlay(word)) {
      uncommonRejected++;
      continue;
    }

    cleanAnswerWords.push(word);
  }

  rejectedAnswer.total = rejectedAnswer.plural + uncommonRejected;

  console.log(`Filtering results:`);
  console.log(`  - Plurals rejected: ${rejectedAnswer.plural}`);
  console.log(`  - Uncommon/difficult words rejected: ${uncommonRejected}`);
  console.log(`  - Total rejected: ${rejectedAnswer.total}`);
  console.log(`  - Valid answer words: ${cleanAnswerWords.length}`);

  cleanAnswerWords.sort();

  // Validate
  validateDictionaries(cleanGuessWords, cleanAnswerWords);

  // Write files
  console.log('\n=== WRITING FILES ===\n');
  writeWordListFile(GUESS_WORDS_OUTPUT, cleanGuessWords, 'GUESS_WORDS_CLEAN');
  writeWordListFile(ANSWER_WORDS_OUTPUT, cleanAnswerWords, 'ANSWER_WORDS_EXPANDED');

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
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ ERROR:', err);
    process.exit(1);
  });
}
