import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, Round as R, Quiz} from '../theme';
import {Card} from './Card';

export const RoundScene: React.FC<{round: R; index: number; total: number; quiz: Quiz}> = ({
  round, index, total, quiz,
}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {roundIn, countdown, reveal} = quiz.timing;

  const inCountdown = f >= roundIn && f < roundIn + countdown;
  const revealFrame = f - (roundIn + countdown);
  const revealed = revealFrame >= 0;

  const secondsLeft = Math.max(1, Math.ceil((countdown - (f - roundIn)) / fps));
  const tick = (countdown - (f - roundIn)) % fps;
  const tickPop = interpolate(tick, [fps - 6, fps], [1.25, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const state = (side: 'a' | 'b') =>
    !revealed ? 'idle' : round.answer === side ? 'correct' : 'wrong';

  const headIn = spring({frame: f, fps, config: {damping: 18}});

  const au = quiz.audio;
  const vol = (k: 'whoosh' | 'tick' | 'reveal') => (au ? au.master * au[k] : 0);
  const ticks = Math.round(countdown / fps);

  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      {au?.enabled ? (
        <>
          <Sequence from={0} durationInFrames={16}>
            <Audio src={staticFile('sfx/whoosh.mp3')} volume={vol('whoosh')} />
          </Sequence>
          {Array.from({length: ticks}).map((_, i) => (
            <Sequence key={i} from={roundIn + i * fps} durationInFrames={10}>
              <Audio
                src={staticFile(i === ticks - 1 ? 'sfx/tick-last.mp3' : 'sfx/tick.mp3')}
                volume={vol('tick')}
              />
            </Sequence>
          ))}
          <Sequence from={roundIn + countdown} durationInFrames={24}>
            <Audio src={staticFile('sfx/reveal.mp3')} volume={vol('reveal')} />
          </Sequence>
        </>
      ) : null}
      {/* прогресс по всему ролику */}
      <div style={{position: 'absolute', top: 0, left: 0, height: 8, width: '100%', background: 'rgba(255,255,255,.08)'}}>
        <div
          style={{
            height: '100%',
            width: `${((index + (f / (roundIn + countdown + reveal))) / total) * 100}%`,
            background: theme.gold,
          }}
        />
      </div>

      <div style={{marginTop: 140, textAlign: 'center', opacity: headIn}}>
        <div style={{font: `700 34px ${theme.fontUI}`, color: theme.gold, letterSpacing: 8}}>
          РАУНД {index + 1}/{total}
        </div>
        <div style={{font: `900 78px ${theme.fontUI}`, color: theme.text, marginTop: 8, letterSpacing: -1}}>
          ЧТО ДОРОЖЕ?
        </div>
      </div>

      <div style={{position: 'absolute', top: 372}}>
        <Card item={round.a} label="A" from="left" enter={f} state={state('a')} reveal={revealFrame}
              symbol={quiz.symbol} rate={quiz.rate} />
      </div>

      <div style={{position: 'absolute', top: 1024}}>
        <Card item={round.b} label="B" from="right" enter={f - 4} state={state('b')} reveal={revealFrame - 4}
              symbol={quiz.symbol} rate={quiz.rate} />
      </div>

      {/* центральный бейдж: VS → таймер → результат */}
      <div
        style={{
          position: 'absolute',
          top: 892,
          width: 176,
          height: 176,
          borderRadius: '50%',
          background: '#0b0f16',
          border: `5px solid ${revealed ? theme.green : theme.gold}`,
          boxShadow: `0 0 60px ${(revealed ? theme.green : theme.gold)}66`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${inCountdown ? tickPop : 1})`,
        }}
      >
        <span
          style={{
            font: `400 ${revealed ? 62 : inCountdown ? 96 : 68}px ${theme.fontNum}`,
            color: revealed ? theme.green : inCountdown ? theme.text : theme.gold,
            lineHeight: 1,
            paddingTop: 8,
          }}
        >
          {revealed ? `x${round.ratio}` : inCountdown ? secondsLeft : 'VS'}
        </span>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 1580,
          font: `500 30px ${theme.fontUI}`,
          color: theme.dim,
          textAlign: 'center',
          width: 900,
        }}
      >
        {revealed
          ? round.trap
            ? 'классика: редкость ≠ цена'
            : `разница в ${round.ratio}x`
          : 'считай очки — ответ в конце'}
      </div>
    </AbsoluteFill>
  );
};
