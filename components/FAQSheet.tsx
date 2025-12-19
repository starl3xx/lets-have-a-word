import { useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';

interface FAQSheetProps {
  onClose: () => void;
}

interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

/**
 * FAQSheet Component
 * Milestone 4.3, Updated Milestone 7.0
 *
 * Displays comprehensive FAQ covering all game mechanics
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent typography and spacing
 */
export default function FAQSheet({ onClose }: FAQSheetProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggleQuestion = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  // Helper to create clickable CLANKTON token link
  const ClanktonLink = ({ children }: { children: React.ReactNode }) => (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          console.log('[FAQ] Attempting to view token...');
          const result = await sdk.actions.viewToken({
            token: 'eip155:8453/erc20:0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07'
          });
          console.log('[FAQ] viewToken result:', result);
        } catch (error) {
          console.error('[FAQ] Error opening token view:', error);
        }
      }}
      className="text-accent-600 hover:text-accent-800 font-semibold transition-colors duration-fast"
    >
      {children}
    </button>
  );

  // Helper to create clickable Farcaster profile link
  const ProfileLink = ({ fid, children }: { fid: number; children: React.ReactNode }) => (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await sdk.actions.viewProfile({ fid });
        } catch (error) {
          console.error('Error opening profile:', error);
        }
      }}
      className="text-accent-600 hover:text-accent-800 font-semibold transition-colors duration-fast"
    >
      {children}
    </button>
  );

  const FAQ_DATA: FAQItem[] = [
    {
      question: "How does the game work?",
      answer: "Every Let's Have A Word! player worldwide is hunting the same secret 5-letter word. When someone guesses correctly, they win the ETH jackpot and a new round starts with a new secret word. The jackpot grows as players purchase guess packs.",
    },
    {
      question: "What are free guesses?",
      answer: "Every player gets 1 free guess per day. Free guesses don't cost anything (obvs) but can still win the jackpot. You can earn additional free guesses through bonuses.",
    },
    {
      question: "How do I get more guesses?",
      answer: (
        <>
          You can get more guesses by:
          <br /><br />
          • Holding 100M <ClanktonLink>CLANKTON</ClanktonLink> tokens
          <br />
          • Sharing your daily guess on Farcaster/Base
          <br />
          • Buying guess packs (3 guesses per pack)
          <br /><br />
          You can buy up to 3 packs per day.
        </>
      ),
    },
    {
      question: "What's the CLANKTON bonus?",
      answer: (
        <>
          If you hold 100M <ClanktonLink>CLANKTON</ClanktonLink> in your connected wallet, you receive extra free guesses:
          <br /><br />
          • <strong>+2 guesses/day</strong> while CLANKTON market cap is below $250K
          <br />
          • <strong>+3 guesses/day</strong> once market cap reaches $250K
          <br /><br />
          This is detected automatically when you connect. Market cap is currently config-based and will move to a live oracle later.
        </>
      ),
    },
    {
      question: "How does the share bonus work?",
      answer: "Share your guess on Farcaster or Base once per day to earn +1 free guess. The bonus is applied automatically after you cast.",
    },
    {
      question: "How are paid guesses different?",
      answer: (
        <>
          Paid guesses:
          <br /><br />
          • Cost ETH
          <br />
          • Increase the global prize pool
          <br />
          • Can be used at any point during the round
          <br />
          • Fund all prize payouts
        </>
      ),
    },
    {
      question: "How is the jackpot split?",
      answer: (
        <>
          When a round is won, payouts are resolved atomically onchain in a single transaction:
          <br /><br />
          • <strong>80%</strong> → Jackpot winner
          <br />
          • <strong>10%</strong> → Top 10 guessers
          <br />
          • <strong>10%</strong> → Referrer (if one exists)
          <br /><br />
          If the winner does not have a referrer:
          <br />
          • 7.5% is added to the Top 10 pool
          <br />
          • 2.5% seeds the next round's jackpot
          <br /><br />
          Self-referrals are blocked. Null or zero referrers are treated as "no referrer."
        </>
      ),
    },
    {
      question: "How do Top 10 rewards work?",
      answer: (
        <>
          Top 10 rewards are based on early participation in each round.
          <br /><br />
          • Only the first 750 guesses in a round are eligible for Top 10 ranking
          <br />
          • After guess #750, Top 10 locks
          <br />
          • Guesses after the lock can still win the jackpot, but do not affect Top 10 ranking
          <br /><br />
          This incentivizes early guess purchasing during the high-uncertainty phase of the round and helps drive prize pool growth.
        </>
      ),
    },
    {
      question: "How are Top 10 rewards split?",
      answer: (
        <>
          The Top 10 pool is split using fixed percentages that scale with the prize size:
          <br /><br />
          • Rank #1: 19%
          <br />
          • Rank #2: 16%
          <br />
          • Rank #3: 14%
          <br />
          • Rank #4: 11%
          <br />
          • Rank #5: 10%
          <br />
          • Ranks #6–#10: 6% each
          <br /><br />
          This distribution is fixed and always applies when a round is resolved, scaling proportionally with the total Top 10 pool.
        </>
      ),
    },
    {
      question: "How much do guess packs cost?",
      answer: (
        <>
          Each pack contains 3 guesses.
          <br /><br />
          • <strong>0–749 total guesses</strong> in the round: 0.00030 ETH
          <br />
          • <strong>750–1249 guesses</strong> (mid round): 0.00045 ETH
          <br />
          • <strong>1250+ guesses</strong> (late round, capped): 0.00060 ETH
          <br /><br />
          Pack prices increase only after Top 10 locks. Pricing is computed server-side at purchase time and displayed in the UI.
        </>
      ),
    },
    {
      question: "What happens to unused guesses?",
      answer: (
        <>
          • Free guesses reset daily at 11:00 UTC
          <br />
          • Paid guess credits expire at the end of each day
          <br />
          • If a round ends and a new round starts the same day, unused paid guesses carry over
        </>
      ),
    },
    {
      question: "What does \"provably fair\" mean?",
      answer: (
        <>
          Before each round, the game commits onchain to the secret word using a cryptographic hash and hidden salt.
          <br /><br />
          When the round ends:
          <br />
          • The word and salt are revealed
          <br />
          • Anyone can recompute the hash
          <br />
          • Anyone can verify the answer was fixed from the start
          <br /><br />
          This commit–reveal process makes every round verifiable and fair.
        </>
      ),
    },
    {
      question: "How do referrals work?",
      answer: "Share your referral link with friends on Farcaster and Base. If someone you referred ever wins a jackpot, you automatically receive 10% of their winnings. You can track referral earnings in the Refer sheet.",
    },
    {
      question: "Can I see the word after someone wins?",
      answer: (
        <>
          Yes. When a round is won, the answer is revealed publicly by <ProfileLink fid={1477413}>@letshaveaword</ProfileLink>.
          <br /><br />
          Past winning words and cryptographic proofs are also available.
        </>
      ),
    },
    {
      question: "What is XP for?",
      answer: "XP is tracked but currently has no gameplay effect. Future updates may introduce leaderboards, progression, or XP-based rewards. I don't really know yet, tbh.",
    },
    {
      question: "Can I play outside of Farcaster?",
      answer: "Let's Have A Word! uses the Farcaster stack. You can play in Farcaster clients and the Base app, which shares the same identity and wallet infrastructure. Standalone web play isn't supported yet. A standalone web version may be explored later.",
    },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4">
          <h2 className="text-2xl font-bold text-gray-900">FAQ</h2>
          <button onClick={onClose} className="btn-close" aria-label="Close">
            ×
          </button>
        </div>

        {/* FAQ Items */}
        <div className="space-y-2">
          {FAQ_DATA.map((item, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-btn overflow-hidden"
            >
              {/* Question */}
              <button
                onClick={() => toggleQuestion(index)}
                className="w-full text-left p-4 bg-gray-50 hover:bg-gray-100 transition-colors duration-fast flex items-center justify-between"
              >
                <span className="font-medium text-gray-900 text-sm pr-2">
                  {item.question}
                </span>
                <span className="text-gray-500 text-xl flex-shrink-0">
                  {expandedIndex === index ? '−' : '+'}
                </span>
              </button>

              {/* Answer (collapsible) */}
              {expandedIndex === index && (
                <div className="p-4 bg-white border-t border-gray-200">
                  <div className="text-sm text-gray-700 leading-relaxed">
                    {item.answer}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Close Button */}
        <button onClick={onClose} className="btn-secondary w-full mt-4">
          Close
        </button>
      </div>
    </div>
  );
}
