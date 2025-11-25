import { useState, useEffect, useRef } from 'react';
import { triggerHaptic, haptics } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';
import type { UserReferralsResponse } from '../pages/api/user/referrals';
import { useTranslation } from '../src/hooks/useTranslation';

interface ReferralSheetProps {
  fid: number | null;
  onClose: () => void;
  autoCopyOnOpen?: boolean; // Milestone 6.3: Auto-copy link when opening
}

/**
 * ReferralSheet Component
 * Milestone 4.3, Updated Milestone 6.3
 *
 * Displays referral link, copy button, and referral statistics
 *
 * Milestone 6.3 improvements:
 * - Auto-copy referral link when opening modal (optional toggle)
 * - Animation to ETH earned counter
 * - Enhanced haptics for copy/share
 * - Analytics events
 */
export default function ReferralSheet({
  fid,
  onClose,
  autoCopyOnOpen = false,
}: ReferralSheetProps) {
  const { t } = useTranslation();
  const [referralData, setReferralData] = useState<UserReferralsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [autoCopyEnabled, setAutoCopyEnabled] = useState(autoCopyOnOpen);
  const [autoCopied, setAutoCopied] = useState(false);

  // For ETH earned animation
  const [displayedEth, setDisplayedEth] = useState('0.0000');
  const [displayedReferrals, setDisplayedReferrals] = useState(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const fetchReferralData = async () => {
      if (!fid) {
        setIsLoading(false);
        setError(t('errors.notAuthenticated'));
        return;
      }

      try {
        // Log analytics event - modal opened (fire and forget)
        fetch('/api/analytics/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'referral_modal_opened',
            userId: fid.toString(),
          }),
        }).catch(() => {});

        const response = await fetch(`/api/user/referrals?devFid=${fid}`);

        if (!response.ok) {
          throw new Error('Failed to fetch referral data');
        }

        const data = await response.json();
        setReferralData(data);

        // Auto-copy link if enabled
        if (autoCopyEnabled && data.referralLink) {
          await handleCopyLinkSilent(data.referralLink);
          setAutoCopied(true);
          setTimeout(() => setAutoCopied(false), 2000);
        }

        // Animate counters
        animateCounters(
          data.referralsCount,
          parseFloat(data.referralEthEarned)
        );
      } catch (err) {
        console.error('Error fetching referral data:', err);
        setError('Failed to load referral data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchReferralData();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [fid, autoCopyEnabled, t]);

  /**
   * Animate referral count and ETH counter
   */
  const animateCounters = (targetReferrals: number, targetEth: number) => {
    const duration = 800; // 0.8 seconds
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      // Animate referrals (integer)
      setDisplayedReferrals(Math.round(targetReferrals * easeProgress));

      // Animate ETH (4 decimal places)
      const currentEth = targetEth * easeProgress;
      setDisplayedEth(currentEth.toFixed(4));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  };

  /**
   * Copy referral link to clipboard (silent - for auto-copy)
   */
  const handleCopyLinkSilent = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      void haptics.linkCopied();
    } catch (err) {
      console.error('Failed to auto-copy link:', err);
    }
  };

  /**
   * Copy referral link to clipboard
   */
  const handleCopyLink = async () => {
    if (!referralData?.referralLink) return;

    try {
      await navigator.clipboard.writeText(referralData.referralLink);
      void haptics.linkCopied();
      setCopySuccess(true);

      // Log analytics event
      fetch('/api/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'referral_link_copied',
          userId: fid?.toString(),
        }),
      }).catch(() => {});

      // Reset copy success message after 2 seconds
      setTimeout(() => {
        setCopySuccess(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      triggerHaptic('error');
    }
  };

  /**
   * Share referral link via Farcaster
   */
  const handleShare = async () => {
    if (!referralData?.referralLink) return;

    try {
      void haptics.buttonTapMinor();

      // Log analytics event
      fetch('/api/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'referral_share_clicked',
          userId: fid?.toString(),
        }),
      }).catch(() => {});

      const castText = `Trying to crack the secret word on @letshaveaword.\n\n` +
        `Every wrong guess helps everyone. One correct guess wins the ETH jackpot.\n\n` +
        `Play with my link ${referralData.referralLink}`;

      await sdk.actions.composeCast({
        text: castText,
      });

      void haptics.shareCompleted();
    } catch (error) {
      console.error('[ReferralSheet] Error sharing referral link:', error);
      triggerHaptic('error');
    }
  };

  /**
   * Toggle auto-copy setting
   */
  const toggleAutoCopy = () => {
    void haptics.selectionChanged();
    setAutoCopyEnabled(!autoCopyEnabled);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-2xl font-bold text-gray-900">{t('referral.title')}</h2>
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
            <p className="text-gray-500 animate-pulse">{t('common.loading')}</p>
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
            {/* Auto-copied notification */}
            {autoCopied && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center animate-pulse">
                <p className="text-green-700 text-sm font-medium">
                  Link auto-copied to clipboard!
                </p>
              </div>
            )}

            {/* Referral Link Section */}
            <div className="bg-blue-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-blue-900">{t('referral.yourLink')}</h3>
                {/* Auto-copy toggle */}
                <button
                  onClick={toggleAutoCopy}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    autoCopyEnabled
                      ? 'bg-blue-200 text-blue-800'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {autoCopyEnabled ? t('referral.autoCopy.enabled') : t('referral.autoCopy.disabled')}
                </button>
              </div>
              <div className="bg-white border-2 border-blue-200 rounded p-3">
                <p className="text-sm text-blue-700 break-all font-mono">
                  {referralData.referralLink}
                </p>
              </div>
              <div className="flex gap-3">
                {/* Share Button */}
                <button
                  onClick={handleShare}
                  className="flex-1 py-3 px-4 font-semibold rounded-lg transition-all flex items-center justify-center gap-2 active:scale-95"
                  style={{ backgroundColor: '#6A3CFF', color: 'white' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5A2CEF'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6A3CFF'}
                >
                  <img src="/FC-arch-icon.png" alt="Farcaster" className="w-4 h-4" />
                  {t('referral.shareLink')}
                </button>

                {/* Copy Button */}
                <button
                  onClick={handleCopyLink}
                  className={`flex-1 py-3 px-4 font-semibold rounded-lg transition-all active:scale-95 ${
                    copySuccess
                      ? 'bg-green-500 text-white'
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}
                >
                  {copySuccess ? t('common.copied') : t('referral.copyLink')}
                </button>
              </div>
            </div>

            {/* Referral Stats Section */}
            <div className="bg-purple-50 rounded-lg p-4 space-y-3">
              <h3 className="text-lg font-bold text-purple-900">{t('referral.stats.title')}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-sm text-purple-700">{t('referral.stats.referrals')}</p>
                  <p className="text-3xl font-bold text-purple-900 tabular-nums">
                    {displayedReferrals}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-sm text-purple-700">{t('referral.stats.ethEarned')}</p>
                  <p className="text-3xl font-bold text-purple-900 tabular-nums">
                    {displayedEth}
                  </p>
                </div>
              </div>
            </div>

            {/* How it Works */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-gray-900">{t('referral.howItWorks.title')}</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• {t('referral.howItWorks.step1')}</li>
                <li>• {t('referral.howItWorks.step2')}</li>
                <li>• {t('referral.howItWorks.step3')}</li>
              </ul>
            </div>
          </div>
        )}

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-4 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
