import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, fmtPrice, Item, OddRound as OR, Quiz} from '../theme';

/** «Что лишнее»: три скина, один — из другой ценовой лиги. */

const MiniCard: React.FC<{
  item: Item; label: string; enter: number; odd: boolean; revealFrame: number;
  symbol: string; rate: number;
}> = ({item, label, enter, odd, revealFrame, symbol, rate}) => {
  const {fps} = useVideoConfig();
  const s = spring({frame: enter, fps, config: {damping: 16, mass: 0.6}});
  const revealed = revealFrame >= 0;
  const pop = revealed ? spring({frame: revealFrame, fps, config: {damping: 12, mass: 0.5}}) : 0;
  const edge = revealed ? (odd ? theme.green : theme.red) : item.color;
  const dim = revealed && !odd ? interpolate(pop, [0, 1], [1, 0.45]) : 1;

  const priceT = revealed
    ? interpolate(revealFrame, [2, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 0;
  const shown = item.price * rate * (1 - Math.pow(1 - priceT, 3));

  return (
    <div
      style={{
        width: 920,
        height: 372,
        borderRadius: 40,
        background: `linear-gradient(160deg, ${item.color}1f, rgba(255,255,255,0.03))`,
        border: `4px solid ${edge}`,
        boxShadow: revealed && odd ? `0 0 90px ${theme.green}55` : `0 0 50px ${item.color}22`,
        display: 'flex',
        alignItems: 'center',
        gap: 26,
        padding: '0 34px',
        boxSizing: 'border-box',
        opacity: interpolate(s, [0, 1], [0, 1]) * dim,
        transform: `translateX(${interpolate(s, [0, 1], [-220, 0])}px) scale(${revealed && odd ? 1 + 0.03 * pop : 1})`,
      }}
    >
      <span style={{font: `900 34px ${theme.fontUI}`, color: revealed ? edge : theme.gold, letterSpacing: 2, width: 44}}>
        {label}
      </span>
      <Img
        src={staticFile(item.imageLocal ?? '')}
        style={{width: 330, height: 220, objectFit: 'contain', filter: 'drop-shadow(0 18px 30px rgba(0,0,0,.55))'}}
      />
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{font: `900 40px ${theme.fontUI}`, color: theme.text, lineHeight: 1.1}}>
          {item.name}
        </div>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 14}}>
          {item.wearShort ? (
            <span
              style={{
                font: `700 24px ${theme.fontUI}`,
                color: theme.dim,
                border: '2px solid rgba(255,255,255,.18)',
                borderRadius: 999,
                padding: '4px 14px',
              }}
            >
              {item.wearShort}
            </span>
          ) : null}
          <span
            style={{
              font: `400 58px ${theme.fontNum}`,
              color: revealed ? (odd ? theme.green : theme.text) : 'transparent',
              lineHeight: 1,
              textShadow: revealed && odd ? `0 0 40px ${theme.green}88` : 'none',
            }}
          >
            {revealed ? fmtPrice(shown, symbol) : '—'}
          </span>
        </div>
      </div>
    </div>
  );
};

export const OddRoundScene: React.FC<{round: OR; index: number; total: number; quiz: Quiz}> = ({
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

      <div style={{marginTop: 118, textAlign: 'center', opacity: headIn}}>
        <div style={{font: `700 34px ${theme.fontUI}`, color: theme.gold, letterSpacing: 8}}>
          РАУНД {index + 1}/{total}
        </div>
        <div style={{font: `900 66px ${theme.fontUI}`, color: theme.text, marginTop: 6, letterSpacing: -1}}>
          ЛИШНИЙ ПО ЦЕНЕ
        </div>
        {/* критерий всегда на экране: иначе непонятно, по чему искать чужака */}
        <div style={{font: `600 30px ${theme.fontUI}`, color: theme.gold, marginTop: 8, opacity: 0.9}}>
          два стоят почти одинаково
        </div>
      </div>

      {/* компактный таймер справа от заголовка */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 918,
          width: 112,
          height: 112,
          borderRadius: '50%',
          background: '#0b0f16',
          border: `5px solid ${revealed ? theme.green : theme.gold}`,
          boxShadow: `0 0 46px ${(revealed ? theme.green : theme.gold)}66`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${inCountdown ? tickPop : 1})`,
        }}
      >
        <span
          style={{
            font: `400 ${revealed ? 56 : inCountdown ? 70 : 50}px ${theme.fontNum}`,
            color: revealed ? theme.green : inCountdown ? theme.text : theme.gold,
            lineHeight: 1,
            paddingTop: 6,
          }}
        >
          {revealed ? 'ABC'[round.answer] : inCountdown ? secondsLeft : '?'}
        </span>
      </div>

      {round.items.map((item, i) => (
        <div key={i} style={{position: 'absolute', top: 356 + i * 400}}>
          <MiniCard
            item={item}
            label={'ABC'[i]}
            enter={f - i * 4}
            odd={i === round.answer}
            revealFrame={revealFrame - (i === round.answer ? 0 : 3)}
            symbol={quiz.symbol}
            rate={quiz.rate}
          />
        </div>
      ))}

      <div
        style={{
          position: 'absolute',
          top: 1596,
          font: `500 30px ${theme.fontUI}`,
          color: theme.dim,
          textAlign: 'center',
          width: 900,
        }}
      >
        {revealed
          ? `лишний ${round.dearer ? 'дороже' : 'дешевле'} остальных в ${round.ratio}x`
          : 'один из трёх — из другой ценовой лиги'}
      </div>
    </AbsoluteFill>
  );
};
