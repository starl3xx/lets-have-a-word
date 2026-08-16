import React from 'react';
import { Composition, delayRender, continueRender } from 'remotion';
import { Promo, PROMO_FRAMES } from './Promo';
import { fontsReady } from './fonts';

// Make sure the Söhne weights are loaded before the first frame is rendered.
const handle = delayRender('Loading Soehne fonts');
fontsReady
  .then(() => continueRender(handle))
  .catch((err) => {
    console.error('Font load failed', err);
    continueRender(handle);
  });

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={PROMO_FRAMES}
      fps={30}
      width={1080}
      height={1080}
    />
  );
};
