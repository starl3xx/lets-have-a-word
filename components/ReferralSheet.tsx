import { useState, useEffect } from 'react';
import { triggerHaptic } from '../src/lib/haptics';
import type { UserReferralsResponse } from '../pages/api/user/referrals';

interface ReferralSheetProps {
  fid: number | null;
  onClose: () => void;
}

/**
 * ReferralSheet Component
 * Milestone 4.3
 *
 * Displays referral link, copy button, and referral statistics
 */
export default function ReferralSheet({ fid, onClose }: ReferralSheetProps) {
  const [referralData, setReferralData] = useState<UserReferralsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    const fetchReferralData = async () => {
      if (!fid) {
        setIsLoading(false);
        setError('Not authenticated');
        return;
      }

      try {
        const response = await fetch(`/api/user/referrals?devFid=${fid}`);

        if (!response.ok) {
          throw new Error('Failed to fetch referral data');
        }

        const data = await response.json();
        setReferralData(data);
      } catch (err) {
        console.error('Error fetching referral data:', err);
        setError('Failed to load referral data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchReferralData();
  }, [fid]);

  /**
   * Copy referral link to clipboard
   */
  const handleCopyLink = async () => {
    if (!referralData?.referralLink) return;

    try {
      await navigator.clipboard.writeText(referralData.referralLink);
      triggerHaptic('success');
      setCopySuccess(true);

      // Reset copy success message after 2 seconds
      setTimeout(() => {
        setCopySuccess(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      triggerHaptic('error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-2xl font-bold text-gray-900">🤝 Referrals</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-8">
            <p className="text-gray-500 animate-pulse">Loading referral data...</p>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="bg-red-50 border border-red-200 rounded p-4">
            <p className="text-red-600 text-center">{error}</p>
          </div>
        )}

        {/* Referral Data Display */}
        {referralData && !isLoading && (
          <div className="space-y-4">
            {/* Referral Link Section */}
            <div className="bg-blue-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-blue-900">Your Referral Link</h3>
              <div className="bg-white border-2 border-blue-200 rounded p-3">
                <p className="text-sm text-blue-700 break-all font-mono">
                  {referralData.referralLink}
                </p>
              </div>
              <button
                onClick={handleCopyLink}
                className={`w-full py-3 px-4 font-semibold rounded-lg transition-all ${
                  copySuccess
                    ? 'bg-green-500 text-white'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {copySuccess ? '✓ Copied!' : '📋 Copy Link'}
              </button>
            </div>

            {/* Referral Stats Section */}
            <div className="bg-purple-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-purple-900">Your Referral Stats</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm text-purple-700">Referrals</p>
                  <p className="text-2xl font-bold text-purple-900">{referralData.referralsCount}</p>
                </div>
                <div>
                  <p className="text-sm text-purple-700">ETH Earned</p>
                  <p className="text-2xl font-bold text-purple-900">
                    {parseFloat(referralData.referralEthEarned).toFixed(4)}
                  </p>
                </div>
              </div>
            </div>

            {/* How it Works */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-gray-900">How Referrals Work</h3>
              <ul className="text-xs text-gray-700 space-y-1">
                <li>• Share your link with friends</li>
                <li>• When they sign up and win a jackpot, you earn 10% of their winnings</li>
                <li>• You can track your referrals and earnings here</li>
              </ul>
            </div>
          </div>
        )}

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
