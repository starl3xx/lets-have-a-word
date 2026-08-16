import React from 'react';
import { COLORS, FONT, W } from '../theme';

export const StatPill: React.FC<{ value: string; label: string; scale?: number }> = ({
  value,
  label,
  scale = 1,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10 * scale,
      backgroundColor: 'rgba(255,255,255,0.62)',
      borderRadius: 9999,
      padding: `${14 * scale}px ${30 * scale}px`,
      boxShadow: '0 4px 14px -6px rgba(0,0,0,0.18)',
    }}
  >
    <span style={{ fontFamily: FONT, fontSize: 40 * scale, fontWeight: W.fett, color: COLORS.ink }}>
      {value}
    </span>
    <span style={{ fontFamily: FONT, fontSize: 36 * scale, fontWeight: W.book, color: COLORS.inkSoft }}>
      {label}
    </span>
  </div>
);
