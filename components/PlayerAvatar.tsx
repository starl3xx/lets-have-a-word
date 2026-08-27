/**
 * A player's avatar, badged with the door they came through.
 *
 * Two kinds of player now appear side by side in every public list — a
 * leaderboard, a round archive, a winner row — and telling them apart used to
 * be impossible except by noticing that one of them was called
 * "fid:1000000001". The badge makes the distinction deliberate rather than
 * accidental, and it is small enough to read as provenance rather than as a
 * rank.
 *
 * Deliberately NOT a judgement: neither origin is better, and the badge must
 * never grow into a warning icon. It says where someone plays, the way a
 * platform mark does.
 */

interface PlayerAvatarProps {
  src: string;
  alt: string;
  origin: 'farcaster' | 'wallet';
  /** Tailwind size classes for the image, e.g. "w-8 h-8". */
  sizeClass?: string;
}

export default function PlayerAvatar({
  src,
  alt,
  origin,
  sizeClass = 'w-8 h-8',
}: PlayerAvatarProps) {
  return (
    <span className="relative inline-flex shrink-0">
      <img src={src} alt={alt} className={`${sizeClass} rounded-full object-cover`} />
      <span
        // -bottom/-right rather than inset: the badge should overlap the
        // avatar's edge, so it reads as attached to the person rather than as
        // a separate element in the row.
        className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full ring-2 ring-white"
        style={{
          width: '0.85rem',
          height: '0.85rem',
          backgroundColor: origin === 'wallet' ? '#0000FF' : '#6A3CFF',
        }}
        title={origin === 'wallet' ? 'Plays in the Base app' : 'Plays on Farcaster'}
        aria-label={origin === 'wallet' ? 'Base app player' : 'Farcaster player'}
      >
        {origin === 'wallet' ? (
          // Base's mark, drawn rather than fetched: an <img> here would be a
          // network request per row in a ten-row list.
          <svg viewBox="0 0 24 24" width="7" height="7" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill="#fff" />
            <path
              d="M12 2.5A9.5 9.5 0 1 0 21.5 12H12z"
              fill="#0000FF"
              transform="rotate(0 12 12)"
            />
          </svg>
        ) : (
          <img src="/FC-arch-icon.png" alt="" className="w-[7px] h-[7px]" aria-hidden="true" />
        )}
      </span>
    </span>
  );
}
