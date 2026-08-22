import React from 'react';
import {AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, Quiz} from '../theme';

export const Intro: React.FC<{quiz: Quiz}> = ({quiz}) => {
  const f = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const s = spring({frame: f, fps, config: {damping: 13, mass: 0.7}});
  const out = interpolate(f, [durationInFrames - 10, durationInFrames], [1, 0], {extrapolateLeft: 'clamp'});

  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: out}}>
      {quiz.audio?.enabled ? (
        <Audio src={staticFile('sfx/riser.mp3')} volume={quiz.audio.master * quiz.audio.riser} />
      ) : null}
      <div style={{transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`, textAlign: 'center'}}>
        <div style={{font: `700 40px ${theme.fontUI}`, color: theme.gold, letterSpacing: 10}}>CS2</div>
        <div
          style={{
            font: `900 150px ${theme.fontUI}`,
            color: theme.text,
            letterSpacing: -4,
            lineHeight: 0.95,
            marginTop: 16,
            textShadow: `0 0 90px ${theme.gold}55`,
          }}
        >
          {quiz.text.introTitle}
        </div>
        <div style={{font: `500 44px ${theme.fontUI}`, color: theme.dim, marginTop: 34}}>
          {quiz.text.introSubtitle.replace('{n}', String(quiz.rounds.length))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
