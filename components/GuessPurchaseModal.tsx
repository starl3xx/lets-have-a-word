import { useState, useEffect } from 'react';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';

/**
 * Pack pricing info (fetched from API or fallback to defaults)
 */
interface PackOption {
  packCount: number;
  guessCount: number;
  totalPrice: string;
}

interface GuessPurchaseModalProps {
  fid: number | null;
  onClose: () => void;
  onPurchaseSuccess: (packCount: number) => void;
}

/**
 * GuessPurchaseModal
 * Milestone 6.3, Updated Milestone 7.0
 *
 * Modal for purchasing guess packs (3 guesses per pack).
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent color palette
 */
export default function GuessPurchaseModal({
  fid,
  onClose,
  onPurchaseSuccess,
}: GuessPurchaseModalProps) {
  const { t } = useTranslation();

  // Pack pricing options
  const [packOptions, setPackOptions] = useState<PackOption[]>([
    { packCount: 1, guessCount: 3, totalPrice: '0.0003' },
    { packCount: 2, guessCount: 6, totalPrice: '0.0006' },
    { packCount: 3, guessCount: 9, totalPrice: '0.0009' },
  ]);

  // State
  const [selectedPackCount, setSelectedPackCount] = useState<number>(1);
  const [packsPurchasedToday, setPacksPurchasedToday] = useState<number>(0);
  const [maxPacksPerDay, setMaxPacksPerDay] = useState<number>(3);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch current purchase state and pricing
  useEffect(() => {
    const fetchPurchaseState = async () => {
      if (!fid) {
        setIsLoading(false);
        setError(t('errors.notAuthenticated'));
        return;
      }

      try {
        const [stateResponse, pricingResponse] = await Promise.all([
          fetch(`/api/user-state?devFid=${fid}`),
          fetch('/api/guess-pack-pricing'),
        ]);

        if (stateResponse.ok) {
          const stateData = await stateResponse.json();
          setPacksPurchasedToday(stateData.paidPacksPurchased || 0);
        }

        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          if (pricingData.packOptions) {
            setPackOptions(pricingData.packOptions);
          }
          if (pricingData.maxPacksPerDay) {
            setMaxPacksPerDay(pricingData.maxPacksPerDay);
          }
        }
      } catch (err) {
        console.error('[GuessPurchaseModal] Error fetching state:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPurchaseState();
  }, [fid, t]);

  // Calculate remaining packs allowed
  const remainingPacks = Math.max(0, maxPacksPerDay - packsPurchasedToday);
  const maxSelectablePacks = Math.min(3, remainingPacks);

  // Get selected pack info
  const selectedOption = packOptions.find(
    (option) => option.packCount === selectedPackCount
  );

  /**
   * Handle pack selection
   */
  const handleSelectPack = (packCount: number) => {
    if (packCount > maxSelectablePacks) return;
    void haptics.selectionChanged();
    setSelectedPackCount(packCount);
    setError(null);
  };

  /**
   * Handle purchase
   */
  const handlePurchase = async () => {
    if (!fid) {
      setError(t('guessPack.connectWallet'));
      return;
    }

    if (selectedPackCount > remainingPacks) {
      setError(t('guessPack.maxPacksReached'));
      return;
    }

    void haptics.buttonTapMinor();
    setIsPurchasing(true);
    setError(null);

    try {
      const response = await fetch('/api/purchase-guess-pack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fid,
          packCount: selectedPackCount,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('guessPack.purchaseFailed'));
      }

      void haptics.packPurchased();
      setSuccessMessage(t('guessPack.purchaseSuccess'));
      setPacksPurchasedToday((prev) => prev + selectedPackCount);

      setTimeout(() => {
        onPurchaseSuccess(selectedPackCount);
        onClose();
      }, 1500);
    } catch (err) {
      console.error('[GuessPurchaseModal] Purchase error:', err);
      setError(err instanceof Error ? err.message : t('guessPack.purchaseFailed'));
      void haptics.inputBecameInvalid();
    } finally {
      setIsPurchasing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">{t('guessPack.title')}</h2>
          <p className="text-gray-600 mt-1">{t('guessPack.subtitle')}</p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-8">
            <p className="text-gray-500 animate-pulse">{t('common.loading')}</p>
          </div>
        )}

        {/* Main Content */}
        {!isLoading && (
          <>
            {/* Pack Options */}
            <div className="space-y-3">
              {packOptions.map((option) => {
                const isSelected = selectedPackCount === option.packCount;
                const isDisabled = option.packCount > maxSelectablePacks;

                return (
                  <button
                    key={option.packCount}
                    onClick={() => handleSelectPack(option.packCount)}
                    disabled={isDisabled || isPurchasing}
                    className={`w-full p-4 rounded-btn border-2 transition-all duration-fast flex items-center justify-between ${
                      isSelected
                        ? 'border-brand bg-brand-50'
                        : isDisabled
                        ? 'border-gray-200 bg-gray-100 opacity-50 cursor-not-allowed'
                        : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Radio indicator */}
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors duration-fast ${
                          isSelected ? 'border-brand' : 'border-gray-300'
                        }`}
                      >
                        {isSelected && (
                          <div className="w-3 h-3 rounded-full bg-brand" />
                        )}
                      </div>

                      {/* Pack info */}
                      <div className="text-left">
                        <p className="font-semibold text-gray-900">
                          {option.packCount} pack{option.packCount > 1 ? 's' : ''}
                        </p>
                        <p className="text-sm text-gray-600">
                          {option.guessCount} guesses
                        </p>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-right">
                      <p className="font-bold text-gray-900">
                        {option.totalPrice} ETH
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Limit Indicator */}
            <div className="bg-gray-50 rounded-btn p-3 text-center">
              <p className="text-sm text-gray-600">
                {t('guessPack.limitIndicator', { count: packsPurchasedToday })}
              </p>
              {remainingPacks === 0 && (
                <p className="text-sm text-warning-600 font-medium mt-1">
                  {t('guessPack.maxPacksReached')}
                </p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-error-50 border border-error-200 rounded-btn p-3">
                <p className="text-sm text-error-700 text-center">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="bg-success-50 border border-success-200 rounded-btn p-3">
                <p className="text-sm text-success-700 text-center">{successMessage}</p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handlePurchase}
                disabled={
                  isPurchasing ||
                  remainingPacks === 0 ||
                  !selectedOption ||
                  !!successMessage
                }
                className={`btn-primary-lg w-full ${
                  isPurchasing ||
                  remainingPacks === 0 ||
                  !selectedOption ||
                  !!successMessage
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                {isPurchasing ? (
                  t('guessPack.buyButtonLoading')
                ) : remainingPacks === 0 ? (
                  t('guessPack.maxPacksReached')
                ) : (
                  <>
                    {t('guessPack.buyButton')} · {selectedOption?.totalPrice} ETH
                  </>
                )}
              </button>

              <button
                onClick={onClose}
                disabled={isPurchasing}
                className="btn-secondary w-full"
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
