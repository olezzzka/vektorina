import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, PriceRound as PR, Quiz} from '../theme';
import {Card} from './Card';

/** «Угадай цену»: один скин, три варианта цены A/B/C. */
export const PriceRoundScene: React.FC<{round: PR; index: number; total: number; quiz: Quiz}> = ({
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

  const headIn = spring({frame: f, fps, config: {damping: 18}});

  const au = quiz.audio;
  const vol = (k: 'whoosh' | 'tick' | 'reveal') => (au ? au.master * au[k] : 0);
  const ticks = Math.round(countdown / fps);

  // единая точность на все три варианта: иначе копейки у одного выдают его на фоне остальных
  const cents = round.options.every((v) => v * quiz.rate < 100);
  const fmt = (v: number) => {
    const x = v * quiz.rate;
    return `${quiz.symbol}${cents ? x.toFixed(2) : Math.round(x).toLocaleString('ru-RU')}`;
  };

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
          СКОЛЬКО СТОИТ?
        </div>
      </div>

      <div style={{position: 'absolute', top: 330}}>
        <Card item={round.item} label="" from="left" enter={f} state={revealed ? 'correct' : 'idle'}
              reveal={revealFrame} symbol={quiz.symbol} rate={quiz.rate} />
      </div>

      {/* таймер между карточкой и вариантами */}
      <div
        style={{
          position: 'absolute',
          top: 872,
          width: 150,
          height: 150,
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
            font: `400 ${revealed ? 76 : inCountdown ? 84 : 60}px ${theme.fontNum}`,
            color: revealed ? theme.green : inCountdown ? theme.text : theme.gold,
            lineHeight: 1,
            paddingTop: 8,
          }}
        >
          {revealed ? '✓' : inCountdown ? secondsLeft : '$?'}
        </span>
      </div>

      {round.options.map((value, i) => {
        const enter = spring({frame: f - 6 - i * 4, fps, config: {damping: 15, mass: 0.6}});
        const correct = i === round.answer;
        const pop = revealed ? spring({frame: revealFrame, fps, config: {damping: 12, mass: 0.5}}) : 0;
        const edge = revealed ? (correct ? theme.green : theme.red) : theme.panelEdge;
        const dim = revealed && !correct ? interpolate(pop, [0, 1], [1, 0.4]) : 1;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: 1064 + i * 152,
              width: 760,
              height: 128,
              borderRadius: 30,
              background: revealed && correct ? 'rgba(55,224,138,.12)' : theme.panel,
              border: `4px solid ${edge}`,
              boxShadow: revealed && correct ? `0 0 70px ${theme.green}55` : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 30,
              padding: '0 40px',
              boxSizing: 'border-box',
              opacity: interpolate(enter, [0, 1], [0, 1]) * dim,
              transform: `translateX(${interpolate(enter, [0, 1], [i % 2 ? 180 : -180, 0])}px) scale(${
                revealed && correct ? 1 + 0.04 * pop : 1
              })`,
            }}
          >
            <span style={{font: `900 40px ${theme.fontUI}`, color: revealed && correct ? theme.green : theme.gold, letterSpacing: 2}}>
              {'ABC'[i]}
            </span>
            <span style={{font: `400 66px ${theme.fontNum}`, color: theme.text, lineHeight: 1, paddingTop: 6}}>
              {fmt(value)}
            </span>
          </div>
        );
      })}

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
        {revealed ? 'реальная цена со Steam Market' : 'считай очки — ответ в конце'}
      </div>
    </AbsoluteFill>
  );
};
