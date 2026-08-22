import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, Quiz, SpotRound as SR} from '../theme';

/**
 * «Где это?»: на радаре карты подсвечена зона, три варианта названия.
 * Названия и границы зон — из файлов самой CS2, поэтому ответ совпадает
 * с тем, что игра пишет в киллфиде.
 */
export const SpotRoundScene: React.FC<{round: SR; index: number; total: number; quiz: Quiz}> = ({
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
  const tickPop = interpolate(tick, [fps - 6, fps], [1.22, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const headIn = spring({frame: f, fps, config: {damping: 18}});

  const au = quiz.audio;
  const vol = (k: 'whoosh' | 'tick' | 'reveal') => (au ? au.master * au[k] : 0);
  const ticks = Math.round(countdown / fps);

  // радар квадратный; чуть уже кадра, чтобы варианты и субтитры не наезжали друг на друга
  const R = 900;
  const top = 420;
  const pulse = 1 + 0.06 * Math.sin(f / 5);
  const zoneW = Math.max(round.zone.w * R, 54);
  const zoneH = Math.max(round.zone.h * R, 54);

  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      {au?.enabled ? (
        <>
          <Sequence from={0} durationInFrames={16}>
            <Audio src={staticFile('sfx/whoosh.mp3')} volume={vol('whoosh')} />
          </Sequence>
          {Array.from({length: ticks}).map((_, i) => (
            <Sequence key={i} from={roundIn + i * fps} durationInFrames={10}>
              <Audio src={staticFile(i === ticks - 1 ? 'sfx/tick-last.mp3' : 'sfx/tick.mp3')} volume={vol('tick')} />
            </Sequence>
          ))}
          <Sequence from={roundIn + countdown} durationInFrames={24}>
            <Audio src={staticFile('sfx/reveal.mp3')} volume={vol('reveal')} />
          </Sequence>
        </>
      ) : null}

      <div style={{position: 'absolute', top: 0, left: 0, height: 8, width: '100%', background: 'rgba(255,255,255,.08)'}}>
        <div style={{height: '100%', width: `${((index + (f / (roundIn + countdown + reveal))) / total) * 100}%`, background: theme.gold}} />
      </div>

      <div style={{marginTop: 120, textAlign: 'center', opacity: headIn}}>
        <div style={{font: `700 34px ${theme.fontUI}`, color: theme.gold, letterSpacing: 8}}>
          РАУНД {index + 1}/{total}
        </div>
        <div style={{font: `900 74px ${theme.fontUI}`, color: theme.text, marginTop: 6, letterSpacing: -1}}>
          ГДЕ ЭТО?
        </div>
        <div style={{font: `800 38px ${theme.fontUI}`, color: theme.gold, marginTop: 6}}>
          {round.mapLabel}
        </div>
      </div>

      {/* таймер в углу, чтобы не залезать на радар */}
      <div
        style={{
          position: 'absolute', top: 24, left: 918, width: 112, height: 112, borderRadius: '50%',
          background: '#0b0f16',
          border: `5px solid ${revealed ? theme.green : theme.gold}`,
          boxShadow: `0 0 46px ${(revealed ? theme.green : theme.gold)}66`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: `scale(${inCountdown ? tickPop : 1})`,
        }}
      >
        <span style={{
          font: `400 ${revealed ? 56 : inCountdown ? 70 : 50}px ${theme.fontNum}`,
          color: revealed ? theme.green : inCountdown ? theme.text : theme.gold,
          lineHeight: 1, paddingTop: 6,
        }}>
          {revealed ? 'ABC'[round.answer] : inCountdown ? secondsLeft : '?'}
        </span>
      </div>

      <div style={{position: 'absolute', top, width: R, height: R}}>
        <Img src={staticFile(round.radar)} style={{width: R, height: R, objectFit: 'contain'}} />
        {/* рамка зоны: до ответа золотая и пульсирует, после — зелёная */}
        <div
          style={{
            position: 'absolute',
            left: round.zone.x * R - zoneW / 2,
            top: round.zone.y * R - zoneH / 2,
            width: zoneW,
            height: zoneH,
            border: `5px solid ${revealed ? theme.green : theme.gold}`,
            borderRadius: 12,
            boxShadow: `0 0 40px ${(revealed ? theme.green : theme.gold)}aa, inset 0 0 30px ${(revealed ? theme.green : theme.gold)}55`,
            transform: `scale(${revealed ? 1 : pulse})`,
          }}
        />
      </div>

      {round.options.map((label, i) => {
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
              top: 1358 + i * 104,
              width: 820,
              height: 88,
              borderRadius: 26,
              background: revealed && correct ? 'rgba(55,224,138,.12)' : theme.panel,
              border: `4px solid ${edge}`,
              boxShadow: revealed && correct ? `0 0 70px ${theme.green}55` : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              padding: '0 34px',
              boxSizing: 'border-box',
              opacity: interpolate(enter, [0, 1], [0, 1]) * dim,
              transform: `translateX(${interpolate(enter, [0, 1], [i % 2 ? 160 : -160, 0])}px) scale(${revealed && correct ? 1 + 0.03 * pop : 1})`,
            }}
          >
            <span style={{font: `900 36px ${theme.fontUI}`, color: revealed && correct ? theme.green : theme.gold, letterSpacing: 2}}>
              {'ABC'[i]}
            </span>
            <span style={{font: `800 42px ${theme.fontUI}`, color: theme.text, lineHeight: 1.1}}>
              {label}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
