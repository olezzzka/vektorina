import React from 'react';
import {Composition} from 'remotion';
import {QuizVideo} from './QuizVideo';
import {Quiz, totalLength} from './theme';
import sample from './sample-quiz.json';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Quiz"
    component={QuizVideo as never}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={totalLength(sample as unknown as Quiz)}
    defaultProps={{quiz: sample as unknown as Quiz}}
    calculateMetadata={({props}: {props: {quiz: Quiz}}) => ({
      durationInFrames: totalLength(props.quiz),
    })}
  />
);
