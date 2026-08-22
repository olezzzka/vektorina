import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {OddRound, PriceRound, Quiz, Round, SpotRound, roundLength, theme, totalLength} from './theme';
import {Background} from './components/Background';
import {Captions} from './components/Captions';
import {Fonts} from './Fonts';
import {Intro} from './components/Intro';
import {OddRoundScene} from './components/OddRound';
import {Outro} from './components/Outro';
import {PriceRoundScene} from './components/PriceRound';
import {SpotRoundScene} from './components/SpotRound';
import {RoundScene} from './components/Round';

export const QuizVideo: React.FC<{quiz: Quiz}> = ({quiz}) => {
  const rl = roundLength(quiz.timing);
  // первая реплика — кликбейтный опенинг: показываем его крупно в интро,
  // а не мелкой строкой субтитров внизу
  const first = quiz.narration?.[0];
  const hook = first && first.frame < quiz.timing.intro ? (first.display ?? first.text) : undefined;

  /**
   * Фоновая музыка приглушается на время реплик, чтобы не спорить с голосом,
   * и возвращается в паузах. Переход плавный — резкий скачок громкости слышен
   * как «дыхание» трека.
   */
  const music = quiz.audio?.enabled === false ? undefined : quiz.audio?.music;
  // приглушаем по реальной длине речи (spoken), а не по окну реплики: окна
  // покрывают почти весь ролик, и музыка оказалась бы приглушена всегда
  const lines = quiz.voice ? (quiz.narration ?? []).filter((l) => l.spoken) : [];
  const total = totalLength(quiz);
  const RAMP = 9;
  const musicVolume = (f: number) => {
    const base = (quiz.audio?.master ?? 1) * (music?.volume ?? 0);
    let duck = 0;
    let nearest = Infinity;
    for (const l of lines) {
      const from = l.frame - 6;
      const to = l.frame + (l.spoken ?? 0) + 8;
      if (f >= from && f <= to) { duck = 1; break; }
      nearest = Math.min(nearest, f < from ? from - f : f - to);
    }
    if (duck === 0 && nearest < RAMP) duck = 1 - nearest / RAMP;
    const level = base * (1 - duck * (1 - (music?.duckTo ?? 0.45)));
    const fadeIn = Math.min(1, f / 20);
    const fadeOut = Math.min(1, Math.max(0, total - f) / 30);
    return level * fadeIn * fadeOut;
  };
  return (
    <AbsoluteFill style={{background: theme.bg, fontFamily: theme.fontUI}}>
      <Fonts />
      <Background video={quiz.background} />
      {quiz.voice ? (
        <Audio src={staticFile(quiz.voice)} volume={(quiz.audio?.master ?? 1) * (quiz.audio?.voice ?? 1)} />
      ) : null}
      {music?.file ? (
        <Audio src={staticFile(music.file)} volume={musicVolume} loop />
      ) : null}
      <Sequence durationInFrames={quiz.timing.intro}>
        <Intro quiz={quiz} hook={hook} />
      </Sequence>
      {quiz.rounds.map((r, i) => (
        <Sequence key={i} from={quiz.timing.intro + i * rl} durationInFrames={rl}>
          {quiz.format === 'spot' ? (
            <SpotRoundScene round={r as SpotRound} index={i} total={quiz.rounds.length} quiz={quiz} />
          ) : quiz.format === 'price' ? (
            <PriceRoundScene round={r as PriceRound} index={i} total={quiz.rounds.length} quiz={quiz} />
          ) : quiz.format === 'odd' ? (
            <OddRoundScene round={r as OddRound} index={i} total={quiz.rounds.length} quiz={quiz} />
          ) : (
            <RoundScene round={r as Round} index={i} total={quiz.rounds.length} quiz={quiz} />
          )}
        </Sequence>
      ))}
      <Sequence from={quiz.timing.intro + quiz.rounds.length * rl} durationInFrames={quiz.timing.outro}>
        <Outro quiz={quiz} />
      </Sequence>
      <Captions quiz={quiz} />
    </AbsoluteFill>
  );
};
