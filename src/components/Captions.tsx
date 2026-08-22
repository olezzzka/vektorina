import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame} from 'remotion';
import {theme, Quiz} from '../theme';

/**
 * Субтитры из quiz.narration: текст точный по построению (тот же, что ушёл
 * в TTS), появляется на кадре своей реплики. Никакого распознавания речи.
 */
const Line: React.FC<{text: string; window: number}> = ({text, window}) => {
  const f = useCurrentFrame();
  const inA = interpolate(f, [0, 6], [0, 1], {extrapolateRight: 'clamp'});
  const outA = interpolate(f, [window - 6, window], [1, 0], {extrapolateLeft: 'clamp'});
  const rise = interpolate(f, [0, 6], [14, 0], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end'}}>
      <div
        style={{
          marginBottom: 96,
          maxWidth: 920,
          padding: '18px 36px',
          borderRadius: 22,
          background: 'rgba(5,7,11,0.78)',
          border: `2px solid ${theme.panelEdge}`,
          font: `800 42px ${theme.fontUI}`,
          color: theme.text,
          textAlign: 'center',
          lineHeight: 1.25,
          opacity: Math.min(inA, outA),
          transform: `translateY(${rise}px)`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const Captions: React.FC<{quiz: Quiz}> = ({quiz}) => {
  if (!quiz.narration?.length || quiz.captions?.enabled === false) return null;
  return (
    <>
      {/* реплику интро рисует сам Intro — крупно, поэтому здесь её пропускаем */}
      {quiz.narration.filter((l) => l.frame >= quiz.timing.intro).map((l, i) => (
        <Sequence key={i} from={l.frame} durationInFrames={l.window}>
          <Line text={l.text} window={l.window} />
        </Sequence>
      ))}
    </>
  );
};
