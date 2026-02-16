# Bonus Words Feature - Implementation Plan

## Overview

Add 10 "bonus words" per round that instantly win 5M $WORD each. These are committed on-chain alongside the secret word for provable fairness.

**Key Requirements:**
- 10 bonus words per round, each worth 5M $WORD
- Committed on-chain (same transaction as secret word if possible)
- Instant $WORD distribution to winner's wallet
- 🎣 badge for bonus word finders
- 250 XP per bonus word found
- Auto-announcement via @letshaveaword
- Bonus word can NEVER be the secret word
- Words removed from play once claimed

---

## Phase 1: Smart Contract Upgrade

### 1.1 Contract Changes (`contracts/src/JackpotManager.sol`)

**New State Variables:**
```solidity
IERC20 public clanktonToken;  // $WORD ERC-20 contract (contract variable name unchanged, deployed onchain)
uint256 public constant BONUS_WORD_REWARD = 5_000_000 * 10**18;  // 5M $WORD (18 decimals)
uint256 public constant BONUS_WORDS_PER_ROUND = 10;

struct Round {
    bytes32 commitHash;           // Existing: H(salt || answer)
    bytes32 bonusWordsCommitHash; // NEW: H(salt || bonus1 || bonus2 || ... || bonus10)
}
```

**New Functions:**
```solidity
// Initialize $WORD token address (one-time setup, contract function name unchanged, deployed onchain)
function setClanktonToken(address _clanktonToken) external onlyOwner;

// Enhanced round start with both commitments in single tx
function startRoundWithCommitments(
    bytes32 _secretWordCommitHash,
    bytes32 _bonusWordsCommitHash
) external onlyOperator;

// Distribute $WORD for bonus word winner (called immediately when found)
function distributeBonusWordReward(
    address recipient,
    uint256 bonusWordIndex  // 0-9, for event logging
) external onlyOperator;

// View: Check $WORD balance available for rewards
function getBonusWordRewardsBalance() external view returns (uint256);
```

**Events:**
```solidity
event BonusWordRewardDistributed(
    uint256 indexed roundId,
    address indexed recipient,
    uint256 bonusWordIndex,
    uint256 amount
);
```

### 1.2 Contract Deployment Steps

1. Deploy upgraded JackpotManager (UUPS upgrade)
2. Transfer 6B $WORD to contract address
3. Call `setClanktonToken(WORD_TOKEN_ADDRESS)` (contract function name unchanged, deployed onchain)
4. Verify contract on BaseScan

---

## Phase 2: Database Schema

### 2.1 New Tables

**`round_bonus_words`** - Stores bonus words per round
```sql
CREATE TABLE round_bonus_words (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  word_index INTEGER NOT NULL,  -- 0-9 position
  word VARCHAR(100) NOT NULL,   -- Encrypted same as secret word
  salt VARCHAR(64) NOT NULL,    -- Individual salt for verification
  claimed_by_fid INTEGER REFERENCES users(fid),
  claimed_at TIMESTAMP,
  tx_hash VARCHAR(66),          -- $WORD transfer tx hash
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(round_id, word_index),
  UNIQUE(round_id, word)        -- No duplicate words in same round
);
```

**`bonus_word_claims`** - Detailed claim records
```sql
CREATE TABLE bonus_word_claims (
  id SERIAL PRIMARY KEY,
  bonus_word_id INTEGER NOT NULL REFERENCES round_bonus_words(id),
  fid INTEGER NOT NULL REFERENCES users(fid),
  guess_id INTEGER NOT NULL REFERENCES guesses(id),
  clankton_amount VARCHAR(78) NOT NULL,  -- '5000000000000000000000000' (5M $WORD * 10^18, legacy column name)
  wallet_address VARCHAR(42) NOT NULL,
  tx_hash VARCHAR(66),
  tx_status VARCHAR(20) DEFAULT 'pending',  -- pending, confirmed, failed
  claimed_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP
);
```

### 2.2 Schema Additions

**Badge Type Enum:**
```typescript
export type BadgeType = 'OG_HUNTER' | 'BONUS_WORD_FINDER';
```

**XP Event Type:**
```typescript
// Add to XP_EVENT_TYPES
'BONUS_WORD': 250  // XP for finding a bonus word
```

### 2.3 Migration File

Create: `drizzle/migrations/XXXX_bonus_words.sql`

---

## Phase 3: Backend Implementation

### 3.1 Commit-Reveal Updates (`src/lib/commit-reveal.ts`)

```typescript
// New: Create commitment for bonus words
export function createBonusWordsCommitment(
  bonusWords: string[],  // Array of 10 words
  salt: string
): { commitHash: string; individualSalts: string[] } {
  // Generate individual salt for each word (for per-word verification)
  const individualSalts = bonusWords.map(() => generateSalt(16));

  // Combined commit: H(salt || word1 || salt1 || word2 || salt2 || ...)
  const combined = salt + bonusWords.map((w, i) =>
    individualSalts[i] + w
  ).join('');

  return {
    commitHash: computeCommitHash(combined),
    individualSalts
  };
}

// Verify single bonus word
export function verifyBonusWord(
  word: string,
  wordSalt: string,
  masterSalt: string,
  allBonusWords: string[],
  allSalts: string[],
  commitHash: string
): boolean {
  // Reconstruct and verify
}
```

### 3.2 Round Creation Updates (`src/lib/rounds.ts`)

```typescript
async function createRound(opts?: CreateRoundOptions): Promise<Round> {
  // 1. Select secret word
  const secretWord = getRandomAnswerWord();

  // 2. Select 10 unique bonus words (excluding secret word)
  const bonusWords = selectBonusWords(10, [secretWord]);

  // 3. Create commitments
  const secretCommitment = createCommitment(secretWord);
  const bonusCommitment = createBonusWordsCommitment(bonusWords, generateSalt());

  // 4. Single onchain transaction for both commitments
  const txHash = await startRoundWithCommitmentsOnChain(
    secretCommitment.commitHash,
    bonusCommitment.commitHash
  );

  // 5. Store encrypted words in DB
  const encryptedSecret = encryptAndPack(secretWord);

  await db.transaction(async (tx) => {
    // Insert round
    const [round] = await tx.insert(rounds).values({
      answer: encryptedSecret,
      salt: secretCommitment.salt,
      commitHash: secretCommitment.commitHash,
      bonusWordsCommitHash: bonusCommitment.commitHash,
      // ...
    }).returning();

    // Insert bonus words
    for (let i = 0; i < bonusWords.length; i++) {
      await tx.insert(roundBonusWords).values({
        roundId: round.id,
        wordIndex: i,
        word: encryptAndPack(bonusWords[i]),
        salt: bonusCommitment.individualSalts[i],
      });
    }
  });
}
```

### 3.3 Bonus Word Selection (`src/lib/word-lists.ts`)

```typescript
export function selectBonusWords(
  count: number,
  excludeWords: string[]
): string[] {
  const available = getAnswerWords().filter(w => !excludeWords.includes(w));
  const selected: string[] = [];

  while (selected.length < count && available.length > 0) {
    const index = randomInt(available.length);
    selected.push(available[index]);
    available.splice(index, 1);  // Remove to prevent duplicates
  }

  return selected;
}
```

### 3.4 Guess Flow Updates (`src/lib/guesses.ts`)

```typescript
async function submitGuess(params: SubmitGuessParams): Promise<SubmitGuessResult> {
  // ... existing validation ...

  // Check if correct (secret word)
  if (word === secretWord) {
    // ... existing winner logic ...
    return { status: 'correct', ... };
  }

  // NEW: Check if bonus word
  const bonusWordMatch = await checkBonusWordMatch(round.id, word);

  if (bonusWordMatch && !bonusWordMatch.claimedByFid) {
    // BONUS WORD FOUND!
    return await handleBonusWordWin(round, fid, word, bonusWordMatch);
  }

  // Regular incorrect guess
  // ... existing logic ...
}

async function handleBonusWordWin(
  round: Round,
  fid: number,
  word: string,
  bonusWord: RoundBonusWord
): Promise<SubmitGuessResult> {
  const user = await getUser(fid);

  await db.transaction(async (tx) => {
    // 1. Mark bonus word as claimed
    await tx.update(roundBonusWords)
      .set({
        claimedByFid: fid,
        claimedAt: new Date()
      })
      .where(eq(roundBonusWords.id, bonusWord.id));

    // 2. Record the guess (still counts as incorrect for round)
    await tx.insert(guesses).values({
      roundId: round.id,
      fid,
      word,
      isCorrect: false,  // Not the secret word
      isBonusWord: true, // NEW field
      guessIndexInRound: await getNextGuessIndex(round.id, tx),
    });

    // 3. Award badge
    await tx.insert(userBadges).values({
      fid,
      badgeType: 'BONUS_WORD_FINDER',
      metadata: {
        roundId: round.id,
        word,
        bonusWordIndex: bonusWord.wordIndex
      },
    }).onConflictDoNothing();  // One badge per user

    // 4. Award XP
    await tx.insert(xpEvents).values({
      fid,
      roundId: round.id,
      eventType: 'BONUS_WORD',
      xpAmount: 250,
      metadata: { word, bonusWordIndex: bonusWord.wordIndex },
    });
  });

  // 5. Distribute $WORD (outside transaction - can retry if fails)
  const txHash = await distributeBonusWordTokens(user.signerWalletAddress, bonusWord.wordIndex);

  // 6. Update claim record with tx hash
  await db.update(roundBonusWords)
    .set({ txHash })
    .where(eq(roundBonusWords.id, bonusWord.id));

  // 7. Announce (non-blocking)
  announceBonusWordFound(round.id, fid, word).catch(console.error);

  return {
    status: 'bonus_word',
    word,
    wordAmount: '5000000',
    txHash,
    message: 'You found a bonus word! 5M $WORD sent to your wallet!',
  };
}
```

### 3.5 Contract Interaction (`src/lib/jackpot-contract.ts`)

```typescript
export async function startRoundWithCommitmentsOnChain(
  secretCommitHash: string,
  bonusWordsCommitHash: string
): Promise<string> {
  const contract = getJackpotManagerWithOperator();
  const tx = await contract.startRoundWithCommitments(
    secretCommitHash,
    bonusWordsCommitHash
  );
  await tx.wait();
  return tx.hash;
}

export async function distributeBonusWordTokens(
  recipientAddress: string,
  bonusWordIndex: number
): Promise<string> {
  const contract = getJackpotManagerWithOperator();
  const tx = await contract.distributeBonusWordReward(
    recipientAddress,
    bonusWordIndex
  );
  await tx.wait();
  return tx.hash;
}
```

### 3.6 Announcer Updates (`src/lib/announcer.ts`)

```typescript
export async function announceBonusWordFound(
  roundId: number,
  fid: number,
  word: string
): Promise<void> {
  const user = await getUser(fid);
  const username = user?.username || `fid:${fid}`;

  const text = `🎣 @${username} found a bonus word "${word}" and won 5M $WORD!

${10 - claimedCount} bonus words remaining this round.

Play now: letshaveaword.fun`;

  await recordAndCastAnnouncerEvent({
    eventType: 'bonus_word_found',
    roundId,
    milestoneKey: `bonus_${word}`,
    text,
  });
}
```

---

## Phase 4: API Updates

### 4.1 Guess Response Types

```typescript
type SubmitGuessResult =
  | { status: 'correct'; ... }
  | { status: 'incorrect'; ... }
  | { status: 'bonus_word';      // NEW
      word: string;
      wordAmount: string;
      txHash: string;
      message: string;
    }
  | // ... existing types
```

### 4.2 New API Endpoints

**GET `/api/round/bonus-words`** - Get bonus word status for current round
```typescript
// Response
{
  totalBonusWords: 10,
  claimedCount: 3,
  claimedWords: [
    { word: 'LUCKY', claimedBy: { fid: 123, username: 'alice' }, claimedAt: '...' },
    // ...
  ],
  remainingCount: 7,
  // Words themselves are hidden until claimed
}
```

**GET `/api/round/bonus-word-winners`** - Get bonus word winners for display
```typescript
// Response
{
  winners: [
    {
      fid: 123,
      username: 'alice',
      pfpUrl: '...',
      word: 'LUCKY',
      claimedAt: '...',
      txHash: '0x...'
    },
    // ...
  ]
}
```

---

## Phase 5: Frontend Updates

### 5.1 Guess Result UI

**New result state for bonus word win:**
```tsx
// In GameContent.tsx or similar

if (result.status === 'bonus_word') {
  // Show celebration modal
  return (
    <BonusWordWinModal
      word={result.word}
      wordAmount={result.wordAmount}
      txHash={result.txHash}
    />
  );
}
```

**BonusWordWinModal Component:**
- Confetti animation
- 🎣 badge display
- "5,000,000 $WORD" with animation
- Link to BaseScan tx
- "Keep playing!" button

### 5.2 Round Modal Updates (`RoundArchiveModal.tsx`)

Add new section below Top 10 Early Guessers:

```tsx
{/* Bonus Word Finders */}
{bonusWordWinners.length > 0 && (
  <div>
    <h3 className="text-sm font-bold uppercase">
      🎣 Bonus Word Finders
    </h3>
    <p className="text-xs text-gray-500">5M $WORD each</p>

    <div className="space-y-1.5">
      {bonusWordWinners.map((winner) => (
        <div className="flex items-center gap-2">
          <img src={winner.pfpUrl} className="w-7 h-7 rounded-full" />
          <span className="text-sm font-medium">@{winner.username}</span>
          <span className="text-xs text-gray-500 uppercase">{winner.word}</span>
          <span className="text-xs">🎣</span>
        </div>
      ))}
    </div>

    <p className="text-xs text-gray-400">
      {10 - bonusWordWinners.length} bonus words remaining
    </p>
  </div>
)}
```

### 5.3 Archive Page Updates (`pages/archive/[roundNumber].tsx`)

Similar section showing all bonus word winners for completed rounds.

### 5.4 Badge Display

Update `BadgeStack.tsx` to include 🎣 badge:
```tsx
{hasBonusWordBadge && (
  <span title="Bonus Word Finder">🎣</span>
)}
```

---

## Phase 6: Archive & Verification

### 6.1 Archive Updates (`src/lib/archive.ts`)

Store bonus word data in archive:
```typescript
interface RoundArchivePayouts {
  // ... existing
  bonusWordWinners?: Array<{
    fid: number;
    word: string;
    wordAmount: string;
    txHash: string;
  }>;
}
```

### 6.2 Verification Page Updates

Add bonus words to `/verify` page:
- Show bonus words commit hash
- After round ends, show all 10 bonus words with verification

---

## Implementation Order

### Week 1: Smart Contract
1. [ ] Write contract upgrade with $WORD distribution
2. [ ] Write unit tests
3. [ ] Deploy to Sepolia testnet
4. [ ] Test with testnet $WORD
5. [ ] Security review

### Week 2: Database & Backend Core
1. [ ] Create database migration
2. [ ] Update schema.ts with new tables
3. [ ] Implement commit-reveal for bonus words
4. [ ] Update round creation logic
5. [ ] Implement bonus word selection

### Week 3: Guess Flow & Distribution
1. [ ] Update guess flow to check bonus words
2. [ ] Implement $WORD distribution
3. [ ] Add badge and XP awards
4. [ ] Implement announcer events
5. [ ] Add retry logic for failed distributions

### Week 4: Frontend & Polish
1. [ ] BonusWordWinModal component
2. [ ] Update RoundArchiveModal
3. [ ] Update archive page
4. [ ] Update verification page
5. [ ] End-to-end testing

### Week 5: Deployment
1. [ ] Deploy contract upgrade to mainnet
2. [ ] Transfer 6B $WORD to contract
3. [ ] Deploy backend changes
4. [ ] Monitor first round with bonus words

---

## Security Considerations

1. **Commit-Reveal Integrity**: Bonus words committed on-chain before round starts
2. **No Front-Running**: Words are encrypted in DB, only revealed when claimed
3. **Transaction Failures**: Claim is recorded in DB even if $WORD transfer fails (can retry)
4. **Rate Limiting**: Existing rate limits prevent brute-force guessing
5. **Wallet Validation**: Only distribute to verified signer wallets

---

## Monitoring & Alerts

1. **$WORD Balance**: Alert when contract balance < 50M (10 rounds worth)
2. **Failed Distributions**: Alert on any failed $WORD transfers
3. **Claim Rate**: Monitor claims per round for anomalies

---

## Rollback Plan

1. Contract is upgradeable - can disable bonus word functions
2. Backend feature flag: `BONUS_WORDS_ENABLED=false`
3. Frontend gracefully hides bonus word UI if API returns empty

