import { useState, useRef, useCallback } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';

/**
 * Generate winner share card as canvas and trigger download
 */
async function generateShareCardImage(
  winnerWord: string,
  roundId: number,
  jackpotEth: string
): Promise<void> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Card dimensions (optimized for social sharing)
  const width = 600;
  const height = 800;
  canvas.width = width;
  canvas.height = height;

  // Background gradient (purple to indigo)
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#9333ea'); // purple-600
  gradient.addColorStop(0.5, '#7e22ce'); // purple-700
  gradient.addColorStop(1, '#4338ca'); // indigo-700
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Dot pattern overlay
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let x = 0; x < width; x += 30) {
    for (let y = 0; y < height; y += 30) {
      ctx.beginPath();
      ctx.arc(x + 15, y + 15, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Round number badge (top left)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  const badgeText = `Round #${roundId}`;
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  const badgeWidth = ctx.measureText(badgeText).width + 24;
  roundedRect(ctx, 24, 24, badgeWidth, 36, 18);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.fillText(badgeText, 36, 48);

  // Celebration emoji
  ctx.font = '100px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('🎉', width / 2, 180);

  // "Congratulations!" text
  ctx.font = 'bold 42px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillText('Congratulations!', width / 2, 260);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Winning word container
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  roundedRect(ctx, 50, 300, width - 100, 140, 16);
  ctx.fill();

  // "You found the word" label
  ctx.font = '18px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillText('You found the word', width / 2, 345);

  // Winning word
  ctx.font = 'bold 56px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'white';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.letterSpacing = '0.15em';
  ctx.fillText(winnerWord.toUpperCase(), width / 2, 410);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Jackpot container (gold gradient)
  const jackpotGradient = ctx.createLinearGradient(50, 480, width - 50, 580);
  jackpotGradient.addColorStop(0, '#facc15'); // yellow-400
  jackpotGradient.addColorStop(1, '#f97316'); // orange-500
  ctx.fillStyle = jackpotGradient;
  roundedRect(ctx, 50, 480, width - 100, 120, 16);
  ctx.fill();

  // "Jackpot Won" label
  ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#713f12'; // yellow-900
  ctx.fillText('Jackpot Won', width / 2, 525);

  // Jackpot amount
  const jackpotDisplay = parseFloat(jackpotEth).toFixed(4);
  ctx.font = 'bold 48px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${jackpotDisplay} ETH`, width / 2, 575);

  // Branding footer
  ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText("Let's Have A Word", width / 2, 700);

  ctx.font = '16px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText('lets-have-a-word.vercel.app', width / 2, 730);

  // Convert to blob and download
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to create image blob'));
    }, 'image/png');
  });

  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `winner-round-${roundId}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Helper to draw rounded rectangles
 */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

interface WinnerShareCardProps {
  winnerWord: string;
  roundId: number;
  jackpotEth?: string; // Milestone 6.3: Jackpot amount
  onClose: () => void;
}

/**
 * WinnerShareCard
 * Milestone 4.14, Updated Milestone 6.3, 6.8
 *
 * Shows a celebration card when user wins the round
 * Includes Farcaster + X (Twitter) share options
 *
 * Milestone 6.3 enhancements:
 * - Brand color palette
 * - Jackpot amount display
 * - Round number display
 * - Haptics on save/download
 *
 * Milestone 6.8: Removed CLANKTON references from modal
 */
export default function WinnerShareCard({
  winnerWord,
  roundId,
  jackpotEth = '0.00',
  onClose,
}: WinnerShareCardProps) {
  const { t } = useTranslation();
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jackpotDisplay = parseFloat(jackpotEth).toFixed(4);
  const shareText = `I just hit the ${jackpotDisplay} ETH jackpot on Let's Have A Word! 🎉🟩\n\nI found the winning word "${winnerWord}" in round #${roundId}!\n\n@letshaveaword`;

  /**
   * Share to Farcaster
   */
  const handleShareToFarcaster = async () => {
    void haptics.buttonTapMinor();
    setIsSharing(true);
    setError(null);

    try {
      console.log('[WinnerShareCard] Opening Farcaster composer with text:', shareText);

      // Open Farcaster composer with prefilled text and embed
      await sdk.actions.composeCast({
        text: shareText,
        embeds: ['https://letshaveaword.fun'],
      });

      // Note: We don't close the modal automatically - let user decide when to dismiss
    } catch (err) {
      console.error('[WinnerShareCard] Error sharing to Farcaster:', err);
      setError('Failed to open Farcaster composer');
    } finally {
      setIsSharing(false);
    }
  };

  /**
   * Share to X (Twitter)
   */
  const handleShareToX = () => {
    void haptics.buttonTapMinor();
    setError(null);

    try {
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
      console.log('[WinnerShareCard] Opening X/Twitter composer with URL:', twitterUrl);

      // Open in new window/tab
      if (typeof window !== 'undefined') {
        window.open(twitterUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('[WinnerShareCard] Error sharing to X:', err);
      setError('Failed to open X composer');
    }
  };

  /**
   * Handle save/download share card as PNG image
   */
  const handleSaveCard = async () => {
    void haptics.cardSaved();
    setError(null);

    try {
      console.log('[WinnerShareCard] Generating share card image...');
      await generateShareCardImage(winnerWord, roundId, jackpotEth);
      console.log('[WinnerShareCard] Share card downloaded successfully');
    } catch (err) {
      console.error('[WinnerShareCard] Error generating share card:', err);
      setError('Failed to generate share card');
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-60 z-50"
        onClick={onClose}
        style={{ backdropFilter: 'blur(4px)' }}
      />

      {/* Modal Card */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div
          className="bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 rounded-2xl shadow-2xl max-w-md w-full p-6 relative overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          style={{ fontSmooth: 'always', WebkitFontSmoothing: 'antialiased' }}
        >
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute inset-0" style={{
              backgroundImage: 'radial-gradient(circle at 25% 25%, white 2px, transparent 2px)',
              backgroundSize: '30px 30px'
            }} />
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none z-10"
          >
            ×
          </button>

          {/* Round number badge */}
          <div className="absolute top-4 left-4 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full">
            <span className="text-xs text-white font-medium">Round #{roundId}</span>
          </div>

          {/* Winner Celebration */}
          <div className="text-center mb-6 relative z-10">
            {/* Celebration emoji */}
            <div className="text-7xl mb-4">🎉</div>

            <h2 className="text-3xl font-bold text-white mb-2" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
              {t('winner.congratulations')}
            </h2>

            {/* Winning word display */}
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 mb-4">
              <p className="text-white/80 text-sm mb-2">{t('winner.foundWord')}</p>
              <p className="text-4xl font-bold text-white tracking-widest uppercase" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                {winnerWord}
              </p>
            </div>

            {/* Jackpot amount */}
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 rounded-xl p-4 shadow-lg">
              <p className="text-yellow-900 text-sm font-medium mb-1">Jackpot Won</p>
              <p className="text-3xl font-bold text-yellow-900">
                {jackpotDisplay} ETH
              </p>
            </div>
          </div>

          {/* Share Section */}
          <div className="space-y-3 relative z-10">
            <p className="text-sm text-white/80 text-center mb-4">
              {t('winner.shareVictory')}
            </p>

            {/* Farcaster Share Button */}
            <button
              onClick={handleShareToFarcaster}
              disabled={isSharing}
              className="w-full py-4 px-6 rounded-xl font-bold text-white active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ backgroundColor: '#6A3CFF' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5A2CEF'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6A3CFF'}
            >
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
              <span>{t('winner.shareOnFarcaster')}</span>
            </button>

            {/* X (Twitter) Share Button */}
            <button
              onClick={handleShareToX}
              disabled={isSharing}
              className="w-full py-4 px-6 rounded-xl font-bold text-white bg-black hover:bg-gray-800 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              <span className="text-xl">𝕏</span>
              <span>{t('winner.shareOnX')}</span>
            </button>

            {/* Save Image Button */}
            <button
              onClick={handleSaveCard}
              className="w-full py-3 px-6 rounded-xl font-semibold text-white/90 bg-white/10 hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span>📥</span>
              <span>Save Image</span>
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 p-3 bg-red-500/20 border border-red-300/30 rounded-lg relative z-10">
              <p className="text-white text-sm text-center">{error}</p>
            </div>
          )}

          {/* Close button (bottom) */}
          <button
            onClick={onClose}
            className="mt-6 w-full py-3 px-6 rounded-xl font-semibold text-white/90 bg-white/10 hover:bg-white/20 active:scale-95 transition-all relative z-10"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </>
  );
}
