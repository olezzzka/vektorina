import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, Quiz, SoundRound as SndRound} from '../theme';

/**
 * «Что за ствол»: играет выстрел, на экране — эквалайзер и три варианта.
 * Выстрел повторяется дважды: с первого раза на телефоне легко прослушать.
 */
export const SoundRoundScene: React.FC<{round: SndRound; index: number; total: number; quiz: Quiz}> = ({
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

  // выстрел звучит сразу после появления и ещё раз в середине отсчёта
  const shots = [roundIn - 6, roundIn + Math.round(countdown / 2)];
  const shotLen = Math.round(1.4 * fps);
  const playing = shots.some((s) => f >= s && f < s + shotLen);

  // столбики эквалайзера: живые, пока играет звук
  const bars = 13;
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

      {/* сам выстрел — громче эффектов, ради него всё и затевалось */}
      {shots.map((s, i) => (
        <Sequence key={i} from={Math.max(0, s)} durationInFrames={shotLen}>
          <Audio src={staticFile(round.file)} volume={(au?.master ?? 1) * 1.0} />
        </Sequence>
      ))}

      <div style={{position: 'absolute', top: 0, left: 0, height: 8, width: '100%', background: 'rgba(255,255,255,.08)'}}>
        <div style={{height: '100%', width: `${((index + (f / (roundIn + countdown + reveal))) / total) * 100}%`, background: theme.gold}} />
      </div>

      <div style={{marginTop: 130, textAlign: 'center', opacity: headIn}}>
        <div style={{font: `700 34px ${theme.fontUI}`, color: theme.gold, letterSpacing: 8}}>
          РАУНД {index + 1}/{total}
        </div>
        <div style={{font: `900 74px ${theme.fontUI}`, color: theme.text, marginTop: 6, letterSpacing: -1}}>
          ЧТО ЗА СТВОЛ?
        </div>
        <div style={{font: `600 30px ${theme.fontUI}`, color: theme.gold, marginTop: 8, opacity: 0.9}}>
          слушай внимательно · лучше в наушниках
        </div>
      </div>

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

      {/* эквалайзер вместо картинки: смотреть не на что, но пустой экран скучный */}
      <div
        style={{
          position: 'absolute', top: 500, width: 860, height: 420, borderRadius: 36,
          background: 'linear-gradient(160deg, rgba(255,255,255,.06), rgba(255,255,255,.02))',
          border: `4px solid ${revealed ? theme.green : theme.panelEdge}`,
          boxShadow: revealed ? `0 0 80px ${theme.green}44` : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}
      >
        {Array.from({length: bars}).map((_, i) => {
          const seed = random(`bar-${i}`) * 0.7 + 0.3;
          const wob = Math.sin((f / 3) + i * 0.9) * 0.5 + 0.5;
          const h = playing ? 40 + 260 * seed * (0.35 + 0.65 * wob) : 40 + 26 * seed;
          return (
            <div
              key={i}
              style={{
                width: 34, height: h, borderRadius: 10,
                background: playing
                  ? `linear-gradient(180deg, ${theme.gold}, ${theme.gold}66)`
                  : 'rgba(255,255,255,.14)',
                boxShadow: playing ? `0 0 24px ${theme.gold}55` : 'none',
              }}
            />
          );
        })}
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
              top: 1050 + i * 116,
              width: 860,
              height: 98,
              borderRadius: 26,
              background: revealed && correct ? 'rgba(55,224,138,.12)' : theme.panel,
              border: `4px solid ${edge}`,
              boxShadow: revealed && correct ? `0 0 70px ${theme.green}55` : 'none',
              display: 'flex', alignItems: 'center', gap: 24, padding: '0 34px', boxSizing: 'border-box',
              opacity: interpolate(enter, [0, 1], [0, 1]) * dim,
              transform: `translateX(${interpolate(enter, [0, 1], [i % 2 ? 160 : -160, 0])}px) scale(${
                revealed && correct ? 1 + 0.03 * pop : 1})`,
            }}
          >
            <span style={{font: `900 36px ${theme.fontUI}`, color: revealed && correct ? theme.green : theme.gold, letterSpacing: 2}}>
              {'ABC'[i]}
            </span>
            <span style={{font: `800 42px ${theme.fontUI}`, color: theme.text}}>{label}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
