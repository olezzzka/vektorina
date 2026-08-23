import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {OddRound, PriceRound, Quiz, RarityRound, Round, SoundRound, SpotRound, ZoomRound, roundLength, theme, totalLength} from './theme';
import {Background} from './components/Background';
import {Captions} from './components/Captions';
import {Fonts} from './Fonts';
import {Intro} from './components/Intro';
import {OddRoundScene} from './components/OddRound';
import {Outro} from './components/Outro';
import {PriceRoundScene} from './components/PriceRound';
import {SpotRoundScene} from './components/SpotRound';
import {SoundRoundScene} from './components/SoundRound';
import {RarityRoundScene, ZoomRoundScene} from './components/GuessRound';
import {RoundScene} from './components/Round';

export const QuizVideo: React.FC<{quiz: Quiz}> = ({quiz}) => {
  const rl = roundLength(quiz.timing);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  /**
   * Рывок камеры в первые кадры: кадр наезжает и тут же отскакивает назад.
   * Вместе с ударом звуком это то, ради чего зритель тормозит палец — без
   * такого начала ролик пролистывают до того, как поймут, о чём он.
   */
  const punch = spring({frame, fps, config: {damping: 11, mass: 0.45, stiffness: 190}});
  const punchScale = interpolate(punch, [0, 1], [1.28, 1]);
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
      {quiz.voice ? (
        <Audio src={staticFile(quiz.voice)} volume={(quiz.audio?.master ?? 1) * (quiz.audio?.voice ?? 1)} />
      ) : null}
      {music?.file ? (
        <Audio src={staticFile(music.file)} volume={musicVolume} loop />
      ) : null}
      {quiz.audio?.enabled === false ? null : (
        <Sequence from={0} durationInFrames={Math.round(1.6 * fps)}>
          <Audio src={staticFile('sfx/impact.mp3')} volume={(quiz.audio?.master ?? 1) * (quiz.audio?.impact ?? 0.9)} />
        </Sequence>
      )}

      {/* всё изображение целиком, включая фон, — чтобы наезд читался как движение камеры */}
      <AbsoluteFill style={{transform: `scale(${punchScale})`, transformOrigin: 'center center'}}>
        <Background video={quiz.background} />
        <Sequence durationInFrames={quiz.timing.intro}>
          <Intro quiz={quiz} hook={hook} />
        </Sequence>
        {quiz.rounds.map((r, i) => (
          <Sequence key={i} from={quiz.timing.intro + i * rl} durationInFrames={rl}>
            {quiz.format === 'zoom' ? (
              <ZoomRoundScene round={r as ZoomRound} index={i} total={quiz.rounds.length} quiz={quiz} />
            ) : quiz.format === 'rarity' ? (
              <RarityRoundScene round={r as RarityRound} index={i} total={quiz.rounds.length} quiz={quiz} />
            ) : quiz.format === 'sound' ? (
              <SoundRoundScene round={r as SoundRound} index={i} total={quiz.rounds.length} quiz={quiz} />
            ) : quiz.format === 'spot' ? (
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
    </AbsoluteFill>
  );
};
