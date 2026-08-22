import React from 'react';
import {AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, Quiz} from '../theme';

export const Outro: React.FC<{quiz: Quiz}> = ({quiz}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const s = spring({frame: f, fps, config: {damping: 14}});
  const total = quiz.rounds.length;

  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      {quiz.audio?.enabled ? (
        <Audio src={staticFile('sfx/outro.mp3')} volume={quiz.audio.master * quiz.audio.outro} />
      ) : null}
      <div style={{textAlign: 'center', transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`}}>
        <div style={{font: `900 118px ${theme.fontUI}`, color: theme.text, letterSpacing: -3}}>
          {quiz.text.outroTitle}
        </div>
        <div style={{display: 'flex', gap: 22, justifyContent: 'center', marginTop: 56}}>
          {Array.from({length: total + 1}).map((_, i) => {
            const a = spring({frame: f - 8 - i * 4, fps, config: {damping: 12}});
            return (
              <div
                key={i}
                style={{
                  width: 118, height: 118, borderRadius: 28,
                  border: `4px solid ${theme.gold}`,
                  background: 'rgba(240,178,50,.10)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transform: `scale(${a})`,
                  font: `400 68px ${theme.fontNum}`, color: theme.gold, paddingTop: 6,
                }}
              >
                {i}
              </div>
            );
          })}
        </div>
        <div style={{font: `900 56px ${theme.fontUI}`, color: theme.gold, marginTop: 60}}>
          {quiz.text.outroSubtitle}
        </div>
        <div style={{font: `500 34px ${theme.fontUI}`, color: theme.dim, marginTop: 20}}>
          {quiz.text.outroCta}
        </div>
      </div>
    </AbsoluteFill>
  );
};
