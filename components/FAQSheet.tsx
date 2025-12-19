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
      answer: "Every Let's Have A Word! player worldwide is hunting for the same 5-letter word. When someone guesses correctly, they win the accumulated ETH jackpot and a new round starts with a new word. The jackpot grows with every paid guess.",
    },
    {
      question: "What are free guesses?",
      answer: "Every player gets 1 free guess per day. Free guesses don't cost anything (duh) but still give you a chance to win the jackpot. Additional free guesses can be earned through bonuses.",
    },
    {
      question: "How do I get more guesses?",
      answer: (
        <>
          You can earn bonus free guesses by: (1) Holding 100M <ClanktonLink>CLANKTON</ClanktonLink> tokens (+2-3 guesses/day depending on market cap), and (2) Sharing your daily guess on Farcaster (+1 guess/day). You can also purchase paid guess packs (3 guesses/pack, up to 3 packs/day).
        </>
      ),
    },
    {
      question: "What's the CLANKTON bonus?",
      answer: (
        <>
          If you hold 100M <ClanktonLink>CLANKTON</ClanktonLink> tokens in your connected wallet, you get additional free guesses per day:
          <br /><br />
          • <strong>+2 guesses/day</strong> while CLANKTON market cap is below $250k
          <br />
          • <strong>+3 guesses/day</strong> once market cap reaches $250k
          <br /><br />
          This bonus is automatically detected when you connect. Market cap is currently supplied via configuration and will be replaced with a live oracle in a future update.
        </>
      ),
    },
    {
      question: "How does the share bonus work?",
      answer: "Share your guess via Farcaster once per day to earn +1 free guess. The bonus is applied automatically after you cast.",
    },
    {
      question: "How are paid guesses different?",
      answer: "Paid guesses cost ETH and contribute to the global prize pool. You can buy up to 3 packs per day (3 guesses each). Paid guesses increase the jackpot for everyone.",
    },
    {
      question: "How is the jackpot split?",
      answer: "When someone wins: 80% goes to the winner, 10% goes to their referrer (if any), and the remaining 10% is split among that round's top 10 most active guessers. A small portion also seeds the next round's jackpot.",
    },
    {
      question: "What does \"provably fair\" mean?",
      answer: (
        <>
          Before each round, the game commits to the secret answer by publishing a cryptographic hash of the word (combined with a hidden salt) onchain. This hash proves the answer was fixed from the start and cannot be changed after guesses begin.
          <br /><br />
          When the round ends, <ProfileLink fid={1477413}>@letshaveaword</ProfileLink> reveals the winning word and the salt, allowing anyone to recompute the hash themselves and verify it matches the original onchain commitment. This "commit–reveal" process makes every round transparently and mathematically fair.
        </>
      ),
    },
    {
      question: "How do referrals work?",
      answer: "Share your referral link with your Farcaster friends. If someone you referred ever wins a jackpot, you'll automatically receive 10% of their winnings. You can track your referral earnings in the Refer sheet.",
    },
    {
      question: "What happens to my unused guesses?",
      answer: "Free guess allocations reset daily at 11:00 UTC. Paid guess credits expire at the end of each day. Use them or lose them! If a round is won and a new round starts, any unused paid guess credits automatically carry over to the next round.",
    },
    {
      question: "Can I see the word after someone wins?",
      answer: (
        <>
          Yes! When a round is won, the answer is revealed to everyone by <ProfileLink fid={1477413}>@letshaveaword</ProfileLink>. You can also view past winning words and their cryptographic proofs.
        </>
      ),
    },
    {
      question: "What is XP for?",
      answer: "XP is currently being tracked but has no gameplay effect yet. Future updates may add leaderboards, progression systems, or XP-based rewards. Who knows!",
    },
    {
      question: "Can I play outside of Farcaster?",
      answer: (
        <>
          Not yet. Let's Have A Word! is Farcaster-only for now. The game uses your Farcaster identity, signer wallet, spam score, and referral graph to keep the game fair and to prevent bot abuse. Therefore, the game only works when launched inside a Farcaster client.
          <br /><br />
          I (<ProfileLink fid={6500}>@starl3xx</ProfileLink>) may explore a standalone web version later, but the current experience and security model are built specifically for Farcaster's ecosystem.
        </>
      ),
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
