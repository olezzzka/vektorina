import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {OddRound, PriceRound, Quiz, Round, roundLength, theme} from './theme';
import {Background} from './components/Background';
import {Captions} from './components/Captions';
import {Fonts} from './Fonts';
import {Intro} from './components/Intro';
import {OddRoundScene} from './components/OddRound';
import {Outro} from './components/Outro';
import {PriceRoundScene} from './components/PriceRound';
import {RoundScene} from './components/Round';

export const QuizVideo: React.FC<{quiz: Quiz}> = ({quiz}) => {
  const rl = roundLength(quiz.timing);
  // первая реплика — кликбейтный опенинг: показываем его крупно в интро,
  // а не мелкой строкой субтитров внизу
  const first = quiz.narration?.[0];
  const hook = first && first.frame < quiz.timing.intro ? first.text : undefined;
  return (
    <AbsoluteFill style={{background: theme.bg, fontFamily: theme.fontUI}}>
      <Fonts />
      <Background />
      {quiz.voice ? (
        <Audio src={staticFile(quiz.voice)} volume={(quiz.audio?.master ?? 1) * (quiz.audio?.voice ?? 1)} />
      ) : null}
      <Sequence durationInFrames={quiz.timing.intro}>
        <Intro quiz={quiz} hook={hook} />
      </Sequence>
      {quiz.rounds.map((r, i) => (
        <Sequence key={i} from={quiz.timing.intro + i * rl} durationInFrames={rl}>
          {quiz.format === 'price' ? (
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
