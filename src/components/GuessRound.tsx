import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {theme, Quiz, ZoomRound, RarityRound} from '../theme';

/** Три варианта ответа — общий вид для всех «один предмет + A/B/C» форматов. */
const Options: React.FC<{
  options: string[]; answer: number; revealed: boolean; revealFrame: number; top: number;
}> = ({options, answer, revealed, revealFrame, top}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <>
      {options.map((label, i) => {
        const enter = spring({frame: f - 6 - i * 4, fps, config: {damping: 15, mass: 0.6}});
        const correct = i === answer;
        const pop = revealed ? spring({frame: revealFrame, fps, config: {damping: 12, mass: 0.5}}) : 0;
        const edge = revealed ? (correct ? theme.green : theme.red) : theme.panelEdge;
        const dim = revealed && !correct ? interpolate(pop, [0, 1], [1, 0.4]) : 1;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: top + i * 108,
              width: 860,
              height: 92,
              borderRadius: 26,
              background: revealed && correct ? 'rgba(55,224,138,.12)' : theme.panel,
              border: `4px solid ${edge}`,
              boxShadow: revealed && correct ? `0 0 70px ${theme.green}55` : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              padding: '0 32px',
              boxSizing: 'border-box',
              opacity: interpolate(enter, [0, 1], [0, 1]) * dim,
              transform: `translateX(${interpolate(enter, [0, 1], [i % 2 ? 160 : -160, 0])}px) scale(${
                revealed && correct ? 1 + 0.03 * pop : 1})`,
            }}
          >
            <span style={{font: `900 34px ${theme.fontUI}`, color: revealed && correct ? theme.green : theme.gold, letterSpacing: 2}}>
              {'ABC'[i]}
            </span>
            <span style={{font: `800 38px ${theme.fontUI}`, color: theme.text, lineHeight: 1.1}}>{label}</span>
          </div>
        );
      })}
    </>
  );
};

/** Общая обвязка: прогресс, заголовок, таймер, звуки раунда. */
const Frame: React.FC<{
  quiz: Quiz; index: number; total: number; title: string; revealed: boolean;
  answerLetter: string; children: React.ReactNode;
}> = ({quiz, index, total, title, revealed, answerLetter, children}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {roundIn, countdown, reveal} = quiz.timing;
  const inCountdown = f >= roundIn && f < roundIn + countdown;
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
        <div style={{font: `900 74px ${theme.fontUI}`, color: theme.text, marginTop: 6, letterSpacing: -1}}>{title}</div>
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
          {revealed ? answerLetter : inCountdown ? secondsLeft : '?'}
        </span>
      </div>

      {children}
    </AbsoluteFill>
  );
};

/**
 * «Что за скин»: показываем сильно увеличенный кусок текстуры, на ответе
 * плавно отъезжаем к целой картинке — так видно, где именно был этот кусок.
 */
export const ZoomRoundScene: React.FC<{round: ZoomRound; index: number; total: number; quiz: Quiz}> = ({
  round, index, total, quiz,
}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {roundIn, countdown} = quiz.timing;
  const revealFrame = f - (roundIn + countdown);
  const revealed = revealFrame >= 0;

  const back = revealed
    ? spring({frame: revealFrame, fps, config: {damping: 20, mass: 0.9}})
    : 0;
  const scale = interpolate(back, [0, 1], [round.zoom, 1]);
  // увеличиваем вокруг выбранной точки: так она остаётся на месте, а вокруг
  // растёт масштаб. Сдвигать картинку отдельно нельзя — проценты в translate
  // тоже умножаются на scale, и кусок улетает за рамку
  const origin = `${(round.focus.x * 100).toFixed(1)}% ${(round.focus.y * 100).toFixed(1)}%`;

  const BOX = 760;
  return (
    <Frame quiz={quiz} index={index} total={total} title="ЧТО ЗА СКИН?" revealed={revealed} answerLetter={'ABC'[round.answer]}>
      <div
        style={{
          position: 'absolute', top: 330, width: BOX, height: BOX,
          borderRadius: 32, overflow: 'hidden',
          background: 'linear-gradient(160deg, rgba(255,255,255,.06), rgba(255,255,255,.02))',
          border: `4px solid ${revealed ? theme.green : theme.panelEdge}`,
          boxShadow: revealed ? `0 0 80px ${theme.green}44` : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Img
          src={staticFile(round.item.imageLocal ?? '')}
          style={{
            width: BOX, height: BOX, objectFit: 'contain',
            transformOrigin: origin,
            transform: `scale(${scale})`,
            filter: 'drop-shadow(0 20px 40px rgba(0,0,0,.5))',
          }}
        />
      </div>

      {revealed ? (
        <div style={{position: 'absolute', top: 1110, font: `800 40px ${theme.fontUI}`, color: theme.green, textAlign: 'center', width: 900}}>
          {round.item.name}
        </div>
      ) : null}

      <Options options={round.options} answer={round.answer} revealed={revealed} revealFrame={revealFrame} top={1180} />
    </Frame>
  );
};

/**
 * «Какая редкость»: карточка намеренно без фирменного цвета редкости —
 * иначе рамка выдаёт ответ раньше вопроса.
 */
export const RarityRoundScene: React.FC<{round: RarityRound; index: number; total: number; quiz: Quiz}> = ({
  round, index, total, quiz,
}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {roundIn, countdown} = quiz.timing;
  const revealFrame = f - (roundIn + countdown);
  const revealed = revealFrame >= 0;
  const enter = spring({frame: f, fps, config: {damping: 16, mass: 0.6}});

  return (
    <Frame quiz={quiz} index={index} total={total} title="КАКАЯ РЕДКОСТЬ?" revealed={revealed} answerLetter={'ABC'[round.answer]}>
      <div
        style={{
          position: 'absolute', top: 340, width: 900, height: 560, borderRadius: 36,
          background: revealed
            ? `linear-gradient(160deg, ${round.item.color}33, rgba(255,255,255,.03))`
            : 'linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,.02))',
          border: `4px solid ${revealed ? round.item.color : theme.panelEdge}`,
          boxShadow: revealed ? `0 0 90px ${round.item.color}55` : 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          opacity: interpolate(enter, [0, 1], [0, 1]),
          transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
        }}
      >
        <Img
          src={staticFile(round.item.imageLocal ?? '')}
          style={{width: 700, height: 330, objectFit: 'contain', filter: 'drop-shadow(0 24px 40px rgba(0,0,0,.55))'}}
        />
        <div style={{font: `900 44px ${theme.fontUI}`, color: theme.text, textAlign: 'center', marginTop: 10, padding: '0 30px'}}>
          {round.item.name}
        </div>
        {round.item.wearShort ? (
          <div style={{font: `700 26px ${theme.fontUI}`, color: theme.dim, marginTop: 10}}>{round.item.wearShort}</div>
        ) : null}
      </div>

      <Options options={round.options} answer={round.answer} revealed={revealed} revealFrame={revealFrame} top={960} />

      <div style={{position: 'absolute', top: 1310, font: `500 30px ${theme.fontUI}`, color: theme.dim, textAlign: 'center', width: 900}}>
        {revealed ? 'цвет рамки — подсказка, которую скрывали' : 'цвет намеренно скрыт'}
      </div>
    </Frame>
  );
};
