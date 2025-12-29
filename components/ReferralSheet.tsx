import { useState, useEffect, useRef } from 'react';
import { triggerHaptic, haptics } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';
import type { UserReferralsResponse } from '../pages/api/user/referrals';
import { useTranslation } from '../src/hooks/useTranslation';

interface ReferralSheetProps {
  fid: number | null;
  onClose: () => void;
  autoCopyOnOpen?: boolean;
}

/**
 * ReferralSheet Component
 * Milestone 4.3, Updated Milestone 6.3, Updated Milestone 7.0
 *
 * Displays referral link, copy button, and referral statistics
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent color palette (brand, accent, success)
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
        // Log analytics event
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
    const duration = 800;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      setDisplayedReferrals(Math.round(targetReferrals * easeProgress));
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

      fetch('/api/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'referral_link_copied',
          userId: fid?.toString(),
        }),
      }).catch(() => {});

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

      fetch('/api/analytics/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'referral_share_clicked',
          userId: fid?.toString(),
        }),
      }).catch(() => {});

      const castText = `I'm hunting for the secret word in @letshaveaword 👀\n\n` +
        `Every wrong guess shrinks the field\n` +
        `One correct guess wins the ETH jackpot 🎯\n\n` +
        `Play with my link ↓ ${referralData.referralLink}`;

      await sdk.actions.composeCast({
        text: castText,
        embeds: ['https://letshaveaword.fun'],
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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-4">
          <h2 className="text-2xl font-bold text-gray-900">{t('referral.title')}</h2>
          <button onClick={onClose} className="btn-close" aria-label="Close">
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
          <div className="bg-error-50 border border-error-200 rounded-btn p-4">
            <p className="text-error-700 text-center">{error}</p>
          </div>
        )}

        {/* Referral Data Display */}
        {referralData && !isLoading && (
          <div className="space-y-4">
            {/* Auto-copied notification */}
            {autoCopied && (
              <div className="bg-success-50 border border-success-200 rounded-btn p-3 text-center">
                <p className="text-success-700 text-sm font-medium">
                  Link auto-copied to clipboard!
                </p>
              </div>
            )}

            {/* Referral Link Section */}
            <div className="section-card bg-brand-50">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-brand-900">{t('referral.yourLink')}</h3>
                {/* Auto-copy toggle */}
                <button
                  onClick={toggleAutoCopy}
                  className={`text-xs px-2 py-1 rounded-full transition-colors duration-fast ${
                    autoCopyEnabled
                      ? 'bg-brand-200 text-brand-800'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {autoCopyEnabled ? t('referral.autoCopy.enabled') : t('referral.autoCopy.disabled')}
                </button>
              </div>
              <div className="bg-white border-2 border-brand-200 rounded-btn p-3 mt-2">
                <p className="text-sm text-brand-700 break-all font-mono">
                  {referralData.referralLink}
                </p>
              </div>
              <div className="flex gap-3 mt-3">
                {/* Share Button */}
                <button
                  onClick={handleShare}
                  className="btn-accent flex-1 flex items-center justify-center gap-2 py-3"
                >
                  <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
                  {t('referral.shareLink')}
                </button>

                {/* Copy Button */}
                <button
                  onClick={handleCopyLink}
                  className={`flex-1 py-3 px-4 font-semibold rounded-btn transition-all duration-fast active:scale-95 ${
                    copySuccess
                      ? 'bg-success-500 text-white'
                      : 'bg-brand text-white hover:bg-brand-600'
                  }`}
                >
                  {copySuccess ? t('common.copied') : t('referral.copyLink')}
                </button>
              </div>
            </div>

            {/* Referral Stats Section */}
            <div className="section-card bg-accent-50">
              <h3 className="text-base font-semibold text-accent-900">{t('referral.stats.title')}</h3>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="bg-white rounded-lg p-3 text-center border border-accent-100">
                  <p className="text-sm text-accent-700">{t('referral.stats.referrals')}</p>
                  <p className="text-3xl font-bold text-accent-900 tabular-nums">
                    {displayedReferrals}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-accent-100">
                  <p className="text-sm text-accent-700">{t('referral.stats.ethEarned')}<span className="text-accent-500">*</span></p>
                  <p className="text-3xl font-bold text-accent-900 tabular-nums">
                    {displayedEth}
                  </p>
                </div>
              </div>
              <p className="text-xs text-accent-600 mt-2">
                <span className="text-accent-500">*</span> {t('referral.stats.ethEarnedHelper')}
              </p>
            </div>

            {/* How it Works */}
            <div className="section-card bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900">{t('referral.howItWorks.title')}</h3>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-2 mt-2">
                <li>{t('referral.howItWorks.step1')}</li>
                <li dangerouslySetInnerHTML={{ __html: t('referral.howItWorks.step2') }} />
                <li>{t('referral.howItWorks.step3')}</li>
                <li>{t('referral.howItWorks.step4')}</li>
              </ul>
            </div>
          </div>
        )}

        {/* Close Button */}
        <button onClick={onClose} className="btn-secondary w-full mt-4">
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
