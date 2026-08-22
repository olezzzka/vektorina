import React from 'react';
import {Img, staticFile, interpolate, spring, useVideoConfig} from 'remotion';
import {theme, fmtPrice, Item} from '../theme';

type State = 'idle' | 'correct' | 'wrong';

export const Card: React.FC<{
  item: Item;
  label: string;
  from: 'left' | 'right';
  enter: number;      // кадры с начала появления
  state: State;
  reveal: number;     // -1 до реврила, иначе кадры с начала реврила
  symbol: string;
  rate: number;
}> = ({item, label, from, enter, state, reveal, symbol, rate}) => {
  const {fps} = useVideoConfig();
  const s = spring({frame: enter, fps, config: {damping: 16, mass: 0.6}});
  const dx = interpolate(s, [0, 1], [from === 'left' ? -220 : 220, 0]);
  const op = interpolate(s, [0, 1], [0, 1]);

  const revealed = reveal >= 0;
  const pop = revealed
    ? spring({frame: reveal, fps, config: {damping: 12, mass: 0.5}})
    : 0;
  const scale = state === 'correct' ? 1 + 0.035 * pop : state === 'wrong' ? 1 - 0.03 * pop : 1;
  const dim = state === 'wrong' ? interpolate(pop, [0, 1], [1, 0.45]) : 1;

  const edge =
    state === 'correct' ? theme.green : state === 'wrong' ? theme.red : item.color;
  const glow =
    state === 'correct' ? `0 0 90px ${theme.green}55` : state === 'wrong' ? 'none' : `0 0 60px ${item.color}22`;

  const priceT = revealed ? interpolate(reveal, [2, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;
  const shown = item.price * rate * (priceT < 1 ? easeOut(priceT) : 1);

  return (
    <div
      style={{
        position: 'relative',
        width: 900,
        height: 520,
        transform: `translateX(${dx}px) scale(${scale})`,
        opacity: op * dim,
        borderRadius: 42,
        background: `linear-gradient(160deg, ${item.color}1f, rgba(255,255,255,0.03))`,
        border: `4px solid ${edge}`,
        boxShadow: glow,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '26px 34px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between'}}>
        <span style={{font: `900 30px ${theme.fontUI}`, color: edge, letterSpacing: 2}}>{label}</span>
        {item.wearShort ? (
          <span
            style={{
              font: `700 26px ${theme.fontUI}`,
              color: theme.dim,
              border: '2px solid rgba(255,255,255,.18)',
              borderRadius: 999,
              padding: '6px 18px',
            }}
          >
            {item.wearShort}
          </span>
        ) : null}
      </div>

      <Img
        src={staticFile(item.imageLocal ?? '')}
        style={{width: 640, height: 260, objectFit: 'contain', marginTop: 6, filter: 'drop-shadow(0 24px 40px rgba(0,0,0,.55))'}}
      />

      <div style={{font: `900 46px ${theme.fontUI}`, color: theme.text, textAlign: 'center', lineHeight: 1.05, marginTop: 2}}>
        {item.name}
      </div>

      <div
        style={{
          marginTop: 'auto',
          font: `400 76px ${theme.fontNum}`,
          color: revealed ? (state === 'correct' ? theme.green : theme.text) : 'transparent',
          letterSpacing: 1,
          lineHeight: 1,
          textShadow: revealed && state === 'correct' ? `0 0 40px ${theme.green}88` : 'none',
        }}
      >
        {revealed ? fmtPrice(shown, symbol) : '—'}
      </div>
    </div>
  );
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
