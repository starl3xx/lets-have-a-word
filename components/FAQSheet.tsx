import { useState } from 'react';

interface FAQSheetProps {
  onClose: () => void;
}

interface FAQItem {
  question: string;
  answer: string;
}

const FAQ_DATA: FAQItem[] = [
  {
    question: "How does the game work?",
    answer: "Every player worldwide guesses the same 5-letter word. When someone guesses correctly, they win the ETH jackpot and a new round starts with a new word. The jackpot grows with every paid guess.",
  },
  {
    question: "What are free guesses?",
    answer: "Every player gets 1 free guess per day. Free guesses don't cost anything but still give you a chance to win the jackpot. Additional free guesses can be earned through bonuses.",
  },
  {
    question: "How do I get more guesses?",
    answer: "You can earn bonus free guesses by: (1) Holding CLANKTON tokens (+3 guesses/day), (2) Sharing the game on Farcaster (+1 guess/day). You can also buy paid guess packs (up to 3 packs/day, 3 guesses each).",
  },
  {
    question: "What is CLANKTON bonus?",
    answer: "If you hold CLANKTON tokens in your connected wallet, you get 3 additional free guesses per day. This bonus is automatically detected when you connect.",
  },
  {
    question: "How does the share bonus work?",
    answer: "Share the game via Farcaster once per day to earn +1 free guess. The bonus is applied automatically after you share.",
  },
  {
    question: "How are paid guesses different?",
    answer: "Paid guesses cost ETH and contribute to the prize pool. You can buy up to 3 packs per day (3 guesses each). Paid guesses increase the jackpot for everyone.",
  },
  {
    question: "How is the jackpot split?",
    answer: "When someone wins: 80% goes to the winner, 10% goes to their referrer (if any), 10% split among the top 10 most active guessers that round. A small portion seeds the next round.",
  },
  {
    question: "What does \"Provably Fair\" mean?",
    answer: "Each round's answer is committed onchain before any guesses are made using a cryptographic hash. This means the answer cannot be changed after guesses start - it's mathematically provable that the game is fair.",
  },
  {
    question: "How do referrals work?",
    answer: "Share your referral link with friends. When someone you referred wins a jackpot, you automatically receive 10% of their winnings. You can track your referral earnings in the Referrals sheet.",
  },
  {
    question: "What happens to my unused guesses?",
    answer: "Free guess allocations reset daily at UTC midnight. Paid guess credits carry over between rounds but expire at the end of each day. Use them or lose them!",
  },
  {
    question: "Can I see the word after someone wins?",
    answer: "Yes! When a round is won, the answer is revealed to all players. You can also view past winning words and their cryptographic proofs.",
  },
  {
    question: "What is XP for?",
    answer: "XP is currently being tracked but has no gameplay effect yet. Future updates may add progression systems, leaderboards, or XP-based rewards. Stay tuned!",
  },
];

/**
 * FAQSheet Component
 * Milestone 4.3
 *
 * Displays comprehensive FAQ covering all game mechanics
 */
export default function FAQSheet({ onClose }: FAQSheetProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggleQuestion = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-2xl font-bold text-gray-900">🤔 FAQ</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* FAQ Items */}
        <div className="space-y-2">
          {FAQ_DATA.map((item, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg overflow-hidden transition-all"
            >
              {/* Question */}
              <button
                onClick={() => toggleQuestion(index)}
                className="w-full text-left p-4 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between"
              >
                <span className="font-semibold text-gray-900 text-sm pr-2">
                  {item.question}
                </span>
                <span className="text-gray-500 text-xl flex-shrink-0">
                  {expandedIndex === index ? '−' : '+'}
                </span>
              </button>

              {/* Answer (collapsible) */}
              {expandedIndex === index && (
                <div className="p-4 bg-white border-t border-gray-200">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {item.answer}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-4 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );
}
