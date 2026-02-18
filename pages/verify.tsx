/**
 * Verify Fairness Page
 * Milestone 10: Provably Fair Verification
 *
 * Allows anyone to verify the commit-reveal fairness for any round.
 * Users can confirm that the revealed WORD + SALT reproduces the
 * committed HASH that was published before guessing began.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Head from 'next/head';
import sdk from '@farcaster/miniapp-sdk';
import type { VerifyRoundResponse, VerifyRoundErrorResponse } from './api/verify/round';

// Söhne font family (registered as 'Soehne' in globals.css)
const FONT_FAMILY = "'Soehne', 'SF Pro Display', system-ui, -apple-system, sans-serif";

// Smart contract addresses on Base
const JACKPOT_CONTRACT_ADDRESS = '0xfcb0D07a5BB5f004A1580D5Ae903E33c4A79EdB5';
const WORD_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_WORD_MANAGER_ADDRESS || '').trim();

type VerificationStatus = 'idle' | 'loading' | 'verified' | 'mismatch' | 'pending' | 'error';

interface VerificationResult {
  status: VerificationStatus;
  roundNumber?: number;
  roundStatus?: 'resolved' | 'active' | 'cancelled';
  commitHash?: string;
  onChainCommitHash?: string; // Onchain commitment hash (if available)
  hasOnChainCommitment?: boolean;
  startTxHash?: string; // Transaction hash for startRoundWithCommitment
  revealedWord?: string;
  revealedSalt?: string;
  computedHash?: string;
  roundStartedAt?: string;
  roundEndedAt?: string;
  errorMessage?: string;
  // Bonus Words Feature
  bonusWordsCommitHash?: string;
  hasBonusWords?: boolean;
  // Milestone 14: WordManager commitment
  roundCommitTxHash?: string;
  wordManagerCommitted?: boolean;
  wordManagerAddress?: string;
}

export default function VerifyPage() {
  const router = useRouter();
  const [roundInput, setRoundInput] = useState('');
  const [verifyMode, setVerifyMode] = useState<'latest' | 'specific'>('latest');
  const [result, setResult] = useState<VerificationResult>({ status: 'idle' });
  const [copied, setCopied] = useState<string | null>(null);

  // Handle deep linking via query param
  useEffect(() => {
    if (router.isReady) {
      const roundParam = router.query.round;
      if (roundParam && typeof roundParam === 'string') {
        setRoundInput(roundParam);
        setVerifyMode('specific');
        // Auto-verify when round param is provided
        verifyRound(roundParam);
      }
    }
  }, [router.isReady, router.query.round]);

  /**
   * Compute SHA-256 hash using Web Crypto API
   * Matches the server-side: H(salt || answer)
   */
  async function computeSha256(salt: string, word: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + word);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verify a specific round
   */
  const verifyRound = useCallback(async (roundNumber?: string) => {
    setResult({ status: 'loading' });

    try {
      const url = roundNumber
        ? `/api/verify/round?round=${encodeURIComponent(roundNumber)}`
        : '/api/verify/round';

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        const errorData = data as VerifyRoundErrorResponse;
        setResult({
          status: 'error',
          errorMessage: errorData.error,
        });
        return;
      }

      const roundData = data as VerifyRoundResponse;

      // If round is still active or cancelled without reveal, show pending state
      if (roundData.status === 'active') {
        setResult({
          status: 'pending',
          roundNumber: roundData.roundNumber,
          roundStatus: roundData.status,
          commitHash: roundData.commitHash,
          onChainCommitHash: roundData.onChainCommitHash,
          hasOnChainCommitment: roundData.hasOnChainCommitment,
          startTxHash: roundData.startTxHash,
          roundStartedAt: roundData.roundStartedAt,
          bonusWordsCommitHash: roundData.bonusWordsCommitHash,
          hasBonusWords: roundData.hasBonusWords,
          roundCommitTxHash: roundData.roundCommitTxHash,
          wordManagerCommitted: roundData.wordManagerCommitted,
          wordManagerAddress: roundData.wordManagerAddress,
        });
        return;
      }

      // If cancelled without reveal data
      if (roundData.status === 'cancelled' && !roundData.revealedWord) {
        setResult({
          status: 'pending',
          roundNumber: roundData.roundNumber,
          roundStatus: roundData.status,
          commitHash: roundData.commitHash,
          onChainCommitHash: roundData.onChainCommitHash,
          hasOnChainCommitment: roundData.hasOnChainCommitment,
          startTxHash: roundData.startTxHash,
          roundStartedAt: roundData.roundStartedAt,
          roundEndedAt: roundData.roundEndedAt,
          errorMessage: 'Round was cancelled before reveal.',
          bonusWordsCommitHash: roundData.bonusWordsCommitHash,
          hasBonusWords: roundData.hasBonusWords,
          roundCommitTxHash: roundData.roundCommitTxHash,
          wordManagerCommitted: roundData.wordManagerCommitted,
          wordManagerAddress: roundData.wordManagerAddress,
        });
        return;
      }

      // Round is resolved - perform verification
      if (roundData.revealedWord && roundData.revealedSalt) {
        const computedHash = await computeSha256(
          roundData.revealedSalt,
          roundData.revealedWord
        );

        const isMatch = computedHash === roundData.commitHash;

        setResult({
          status: isMatch ? 'verified' : 'mismatch',
          roundNumber: roundData.roundNumber,
          roundStatus: roundData.status,
          commitHash: roundData.commitHash,
          onChainCommitHash: roundData.onChainCommitHash,
          hasOnChainCommitment: roundData.hasOnChainCommitment,
          startTxHash: roundData.startTxHash,
          revealedWord: roundData.revealedWord,
          revealedSalt: roundData.revealedSalt,
          computedHash,
          roundStartedAt: roundData.roundStartedAt,
          roundEndedAt: roundData.roundEndedAt,
          bonusWordsCommitHash: roundData.bonusWordsCommitHash,
          hasBonusWords: roundData.hasBonusWords,
          roundCommitTxHash: roundData.roundCommitTxHash,
          wordManagerCommitted: roundData.wordManagerCommitted,
          wordManagerAddress: roundData.wordManagerAddress,
        });
      } else {
        setResult({
          status: 'error',
          roundNumber: roundData.roundNumber,
          errorMessage: 'Missing reveal data for this round.',
        });
      }
    } catch (error) {
      console.error('Verification error:', error);
      setResult({
        status: 'error',
        errorMessage: 'Failed to fetch round data. Please try again.',
      });
    }
  }, []);

  /**
   * Handle verify button click
   */
  const handleVerify = () => {
    if (verifyMode === 'latest') {
      verifyRound();
      // Update URL without round param
      router.replace('/verify', undefined, { shallow: true });
    } else {
      if (!roundInput.trim()) {
        setResult({
          status: 'error',
          errorMessage: 'Please enter a round number.',
        });
        return;
      }
      verifyRound(roundInput.trim());
      // Update URL with round param for deep linking
      router.replace(`/verify?round=${encodeURIComponent(roundInput.trim())}`, undefined, { shallow: true });
    }
  };

  /**
   * Copy text to clipboard
   */
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  /**
   * Format date for display
   */
  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  return (
    <>
      <Head>
        <title>Verify Fairness | Let's Have A Word</title>
        <meta
          name="description"
          content="Verify the provably fair commit-reveal system for Let's Have A Word game rounds."
        />
      </Head>

      <main
        className="min-h-screen bg-gray-50"
        style={{ fontFamily: FONT_FAMILY }}
      >
        {/* Header */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
            >
              ← Back to game
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              Verify fairness
            </h1>
            <p className="text-sm text-gray-500 mt-2 max-w-lg leading-relaxed">
              Before each round starts, the game locks in all words onchain — the secret word, 10 bonus words, and 5 burn words — using cryptographic commitments.
            </p>
            <p className="text-sm text-gray-500 mt-2 max-w-lg leading-relaxed">
              When the round ends, the secret word and salt are revealed so anyone can verify the game was fair.
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Verification Card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Mode Selection */}
            <div className="px-4 py-4 border-b border-gray-100">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setVerifyMode('latest');
                    setRoundInput('');
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    verifyMode === 'latest'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Latest round
                </button>
                <button
                  onClick={() => setVerifyMode('specific')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    verifyMode === 'specific'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Specific round
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Check the most recent round, or look up any past round by number.
              </p>

              {/* Round Input (only shown for specific mode) */}
              {verifyMode === 'specific' && (
                <div className="mt-3">
                  <input
                    type="text"
                    placeholder="Enter round number (e.g., 123)"
                    value={roundInput}
                    onChange={(e) => setRoundInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}

              {/* Verify Button */}
              <button
                onClick={handleVerify}
                disabled={result.status === 'loading'}
                className={`mt-3 w-full px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                  result.status === 'loading'
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {result.status === 'loading' ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying...
                  </span>
                ) : (
                  'Verify round'
                )}
              </button>
            </div>

            {/* Results Section */}
            {result.status !== 'idle' && result.status !== 'loading' && (
              <div className="px-4 py-4">
                {/* Status Badge */}
                <div className="mb-4">
                  <StatusBadge status={result.status} />
                  {result.roundNumber && (
                    <span className="ml-2 text-sm text-gray-500">
                      Round #{result.roundNumber}
                    </span>
                  )}
                </div>

                {/* Error Message */}
                {result.status === 'error' && result.errorMessage && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">
                    {result.errorMessage}
                  </div>
                )}

                {/* Pending State (Round in progress) */}
                {result.status === 'pending' && (
                  <div className="space-y-3">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-700 text-sm">
                      {result.roundStatus === 'active'
                        ? 'Round in progress — reveal not available yet.'
                        : result.errorMessage || 'Round was cancelled.'}
                    </div>

                    {result.commitHash && (
                      <DataRow
                        label="Committed hash (Database)"
                        value={result.commitHash}
                        onCopy={() => copyToClipboard(result.commitHash!, 'commitHash')}
                        copied={copied === 'commitHash'}
                        mono
                      />
                    )}

                    {/* Onchain commitment status */}
                    <OnChainCommitmentStatus
                      hasOnChainCommitment={result.hasOnChainCommitment}
                      onChainCommitHash={result.onChainCommitHash}
                      dbCommitHash={result.commitHash}
                      startTxHash={result.startTxHash}
                      onCopy={(hash) => copyToClipboard(hash, 'onChainHash')}
                      copied={copied === 'onChainHash'}
                    />

                    {/* WordManager commitment (keccak256 hashes for 16 words) */}
                    <WordManagerCommitmentStatus
                      wordManagerCommitted={result.wordManagerCommitted}
                      roundCommitTxHash={result.roundCommitTxHash}
                      wordManagerAddress={result.wordManagerAddress}
                    />

                    {result.roundStartedAt && (
                      <DataRow
                        label="Round started"
                        value={formatDate(result.roundStartedAt)}
                      />
                    )}
                  </div>
                )}

                {/* Verified or Mismatch State */}
                {(result.status === 'verified' || result.status === 'mismatch') && (
                  <div className="space-y-3">
                    <DataRow
                      label="Committed hash (Database)"
                      value={result.commitHash!}
                      onCopy={() => copyToClipboard(result.commitHash!, 'commitHash')}
                      copied={copied === 'commitHash'}
                      mono
                    />

                    {/* Onchain commitment status */}
                    <OnChainCommitmentStatus
                      hasOnChainCommitment={result.hasOnChainCommitment}
                      onChainCommitHash={result.onChainCommitHash}
                      dbCommitHash={result.commitHash}
                      startTxHash={result.startTxHash}
                      onCopy={(hash) => copyToClipboard(hash, 'onChainHash')}
                      copied={copied === 'onChainHash'}
                    />

                    {/* WordManager commitment (keccak256 hashes for 16 words) */}
                    <WordManagerCommitmentStatus
                      wordManagerCommitted={result.wordManagerCommitted}
                      roundCommitTxHash={result.roundCommitTxHash}
                      wordManagerAddress={result.wordManagerAddress}
                    />

                    <DataRow
                      label="Revealed word"
                      value={result.revealedWord!.toUpperCase()}
                      onCopy={() => copyToClipboard(result.revealedWord!, 'word')}
                      copied={copied === 'word'}
                      highlight
                    />

                    <DataRow
                      label="Salt"
                      value={result.revealedSalt!}
                      onCopy={() => copyToClipboard(result.revealedSalt!, 'salt')}
                      copied={copied === 'salt'}
                      mono
                    />

                    <DataRow
                      label="Computed hash"
                      value={result.computedHash!}
                      onCopy={() => copyToClipboard(result.computedHash!, 'computedHash')}
                      copied={copied === 'computedHash'}
                      mono
                      match={result.status === 'verified'}
                    />

                    {result.roundStartedAt && (
                      <DataRow
                        label="Round started"
                        value={formatDate(result.roundStartedAt)}
                      />
                    )}

                    {result.roundEndedAt && (
                      <DataRow
                        label="Round ended"
                        value={formatDate(result.roundEndedAt)}
                      />
                    )}

                    {/* Mismatch Warning */}
                    {result.status === 'mismatch' && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm mt-4">
                        <strong>Verification failed!</strong> The computed hash does not match
                        the committed hash. This indicates a potential integrity issue.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Onchain Record */}
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-4">
              <h3 className="font-semibold text-gray-900 mb-2">
                Onchain record
              </h3>
              <p className="text-sm text-gray-500 mb-3">
                The game uses two smart contracts on Base. Both are publicly verified and all commitments are immutable once written.
              </p>

              {/* JackpotManager */}
              <div className="mb-4">
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">
                  JackpotManager (ETH prizes + secret word)
                </div>
                <button
                  onClick={() => sdk.actions.openUrl(`https://basescan.org/address/${JACKPOT_CONTRACT_ADDRESS}`)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-sm font-medium transition-colors"
                >
                  <span>View on BaseScan</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <p className="text-xs text-gray-400 mt-1.5 font-mono break-all">
                  {JACKPOT_CONTRACT_ADDRESS}
                </p>
              </div>

              {/* WordManager */}
              <div>
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">
                  WordManager ($WORD token + word commitments)
                </div>
                <button
                  onClick={() => sdk.actions.openUrl(`https://basescan.org/address/${WORD_MANAGER_ADDRESS}`)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-600 rounded-lg text-sm font-medium transition-colors"
                >
                  <span>View on BaseScan</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <p className="text-xs text-gray-400 mt-1.5 font-mono break-all">
                  {WORD_MANAGER_ADDRESS}
                </p>
              </div>
            </div>
          </div>

          {/* Why This Matters */}
          <div className="mt-6 bg-blue-50 rounded-2xl border border-blue-100 overflow-hidden">
            <div className="px-4 py-4">
              <h3 className="font-semibold text-blue-900 mb-2">
                Why this matters
              </h3>
              <p className="text-sm text-blue-700 leading-relaxed">
                Before any guesses are made, all 16 words are locked onchain: the secret word (SHA-256 on JackpotManager) and 10 bonus + 5 burn words (keccak256 on WordManager).
              </p>
              <p className="text-sm text-blue-700 mt-2 leading-relaxed">
                When a player finds a bonus or burn word, the contract verifies the word matches its committed hash before releasing tokens. This guarantees no word can be changed mid-round.
              </p>
            </div>
          </div>

          {/* Manual Verification Info */}
          <div className="mt-6 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-4">
              <h3 className="font-semibold text-gray-900 mb-2">
                Want to double-check it yourself?
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                If you'd like to independently confirm the result using your own tools, here's how each commitment is computed.
              </p>

              {/* Secret Word (SHA-256) */}
              <div className="mb-5 pb-4 border-b border-gray-100">
                <div className="text-xs text-blue-500 uppercase tracking-wider font-semibold mb-2">
                  Secret word (JackpotManager)
                </div>
                <code className="block bg-gray-100 rounded-lg px-3 py-2 text-sm font-mono text-gray-700">
                  SHA256(salt + word)
                </code>
                <ul className="text-sm text-gray-500 space-y-1 mt-2">
                  <li>• <strong>Salt:</strong> 64-character hex string</li>
                  <li>• <strong>Word:</strong> 5-letter answer (UPPERCASE)</li>
                  <li>• Concatenated directly, no separator</li>
                </ul>
                <div className="mt-2">
                  <code className="block bg-gray-100 rounded-lg px-3 py-2 text-sm font-mono text-gray-700">
                    echo -n "{'<salt><word>'}" | sha256sum
                  </code>
                </div>
              </div>

              {/* Bonus/Burn Words (keccak256) */}
              <div>
                <div className="text-xs text-purple-500 uppercase tracking-wider font-semibold mb-2">
                  Bonus + burn words (WordManager)
                </div>
                <code className="block bg-gray-100 rounded-lg px-3 py-2 text-sm font-mono text-gray-700">
                  keccak256(abi.encodePacked(word, salt))
                </code>
                <ul className="text-sm text-gray-500 space-y-1 mt-2">
                  <li>• <strong>Word:</strong> 5-letter word (UPPERCASE, encoded as string)</li>
                  <li>• <strong>Salt:</strong> 32-byte value (bytes32)</li>
                  <li>• Uses Solidity's <code className="text-xs bg-gray-100 px-1 rounded">abi.encodePacked</code> — word first, then salt</li>
                  <li>• 16 hashes per round: 1 secret + 10 bonus + 5 burn</li>
                </ul>
                <div className="mt-2">
                  <code className="block bg-gray-100 rounded-lg px-3 py-2 text-sm font-mono text-gray-700 whitespace-pre-wrap">
                    {'cast keccak "$(cast --abi-encode-packed \'f(string,bytes32)\' \'<WORD>\' \'<0xSALT>\')"'}
                  </code>
                  <p className="text-xs text-gray-400 mt-1">
                    Using Foundry's <code className="text-xs bg-gray-100 px-1 rounded">cast</code>, or ethers.js <code className="text-xs bg-gray-100 px-1 rounded">solidityPackedKeccak256(['string','bytes32'], [word, salt])</code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

/**
 * Status Badge Component
 */
function StatusBadge({ status }: { status: VerificationStatus }) {
  const config = {
    idle: { text: '', bg: '', border: '' },
    loading: { text: 'Verifying...', bg: 'bg-gray-100', border: 'border-gray-200' },
    verified: { text: 'Verified', bg: 'bg-green-100', border: 'border-green-200', icon: '✓' },
    mismatch: { text: 'Not verified', bg: 'bg-red-100', border: 'border-red-200', icon: '✗' },
    pending: { text: 'Pending reveal', bg: 'bg-amber-100', border: 'border-amber-200', icon: '⏳' },
    error: { text: 'Error', bg: 'bg-red-100', border: 'border-red-200', icon: '!' },
  }[status];

  if (status === 'idle') return null;

  const textColor = {
    verified: 'text-green-700',
    mismatch: 'text-red-700',
    pending: 'text-amber-700',
    error: 'text-red-700',
    loading: 'text-gray-600',
    idle: '',
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${config.bg} ${config.border} border ${textColor}`}
    >
      {config.icon && <span>{config.icon}</span>}
      {config.text}
    </span>
  );
}

/**
 * Data Row Component
 */
function DataRow({
  label,
  value,
  onCopy,
  copied,
  mono,
  highlight,
  match,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  mono?: boolean;
  highlight?: boolean;
  match?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">
            {label}
          </div>
          <div
            className={`text-sm break-all ${
              mono ? 'font-mono' : ''
            } ${
              highlight ? 'text-blue-600 font-bold tracking-widest' : 'text-gray-900'
            } ${
              match !== undefined
                ? match
                  ? 'text-green-600'
                  : 'text-red-600'
                : ''
            }`}
          >
            {value}
          </div>
        </div>
        {onCopy && (
          <button
            onClick={onCopy}
            className="flex-shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Onchain Commitment Status Component
 * Shows whether the round has an onchain commitment and if it matches the database
 */
function OnChainCommitmentStatus({
  hasOnChainCommitment,
  onChainCommitHash,
  dbCommitHash,
  startTxHash,
  onCopy,
  copied,
}: {
  hasOnChainCommitment?: boolean;
  onChainCommitHash?: string;
  dbCommitHash?: string;
  startTxHash?: string;
  onCopy?: (hash: string) => void;
  copied?: boolean;
}) {
  // No onchain commitment (legacy round or contract not deployed)
  if (!hasOnChainCommitment || !onChainCommitHash) {
    return (
      <div className="bg-gray-100 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">⚡</span>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-0.5">
              Onchain commitment
            </div>
            <div className="text-sm text-gray-500">
              Not available for this round
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normalize hashes for comparison (remove 0x prefix if present, lowercase)
  const normalizedOnChain = onChainCommitHash.replace(/^0x/i, '').toLowerCase();
  const normalizedDb = (dbCommitHash || '').toLowerCase();
  const hashesMatch = normalizedOnChain === normalizedDb;

  return (
    <div className={`rounded-xl px-4 py-3 ${hashesMatch ? 'bg-green-50' : 'bg-red-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={hashesMatch ? 'text-green-600' : 'text-red-600'}>
              {hashesMatch ? '⛓️ ✓' : '⛓️ ✗'}
            </span>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              Onchain commitment (Base)
            </div>
          </div>
          <div className="font-mono text-sm break-all text-gray-900">
            {onChainCommitHash}
          </div>
          {hashesMatch ? (
            <div className="text-xs text-green-600 mt-1 font-medium">
              ✓ Matches database commitment — immutably recorded on Base blockchain
            </div>
          ) : (
            <div className="text-xs text-red-600 mt-1 font-medium">
              ✗ Does NOT match database commitment — potential integrity issue!
            </div>
          )}
          {startTxHash && (
            <button
              onClick={() => sdk.actions.openUrl(`https://basescan.org/tx/${startTxHash}`)}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-2 font-medium"
            >
              <span>View on BaseScan</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}
        </div>
        {onCopy && (
          <button
            onClick={() => onCopy(onChainCommitHash)}
            className="flex-shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * WordManager Commitment Status Component
 * Shows whether the round's 16 word hashes (1 secret + 10 bonus + 5 burn) were committed
 * to the WordManager contract using keccak256(abi.encodePacked(word, salt))
 */
function WordManagerCommitmentStatus({
  wordManagerCommitted,
  roundCommitTxHash,
  wordManagerAddress,
}: {
  wordManagerCommitted?: boolean;
  roundCommitTxHash?: string;
  wordManagerAddress?: string;
}) {
  // Not committed (legacy round or contract not deployed)
  if (!wordManagerCommitted) {
    return (
      <div className="bg-gray-100 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">🔐</span>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-0.5">
              Word commitment (WordManager)
            </div>
            <div className="text-sm text-gray-500">
              Not available for this round
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-purple-50 rounded-xl px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-purple-600">🔐 ✓</span>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Word commitment (WordManager)
          </div>
        </div>
        <div className="text-xs text-purple-700 mt-1 font-medium">
          ✓ 16 word hashes committed onchain — 1 secret + 10 bonus + 5 burn
        </div>
        <div className="text-xs text-purple-600 mt-0.5">
          Each word is locked with keccak256(word, salt) before the round starts.
          Claims are verified against these hashes onchain.
        </div>
        {roundCommitTxHash && (
          <button
            onClick={() => sdk.actions.openUrl(`https://basescan.org/tx/${roundCommitTxHash}`)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-2 font-medium"
          >
            <span>View commitment tx on BaseScan</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        )}
        {wordManagerAddress && (
          <button
            onClick={() => sdk.actions.openUrl(`https://basescan.org/address/${wordManagerAddress}`)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mt-1 font-medium"
          >
            <span>View contract</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
