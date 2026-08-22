import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {Quiz, roundLength, theme} from './theme';
import {Background} from './components/Background';
import {Fonts} from './Fonts';
import {Intro} from './components/Intro';
import {Outro} from './components/Outro';
import {RoundScene} from './components/Round';

export const QuizVideo: React.FC<{quiz: Quiz}> = ({quiz}) => {
  const rl = roundLength(quiz.timing);
  return (
    <AbsoluteFill style={{background: theme.bg, fontFamily: theme.fontUI}}>
      <Fonts />
      <Background />
      <Sequence durationInFrames={quiz.timing.intro}>
        <Intro quiz={quiz} />
      </Sequence>
      {quiz.rounds.map((r, i) => (
        <Sequence key={i} from={quiz.timing.intro + i * rl} durationInFrames={rl}>
          <RoundScene round={r} index={i} total={quiz.rounds.length} quiz={quiz} />
        </Sequence>
      ))}
      <Sequence from={quiz.timing.intro + quiz.rounds.length * rl} durationInFrames={quiz.timing.outro}>
        <Outro quiz={quiz} />
      </Sequence>
    </AbsoluteFill>
  );
};
