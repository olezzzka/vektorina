import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame} from 'remotion';
import {theme} from '../theme';

export const Background: React.FC<{accentA?: string; accentB?: string; video?: string}> = ({
  accentA = '#2b6cff',
  accentB = '#ff5a2b',
  video,
}) => {
  const f = useCurrentFrame();
  const drift = Math.sin(f / 90) * 60;
  return (
    <AbsoluteFill style={{background: theme.bg}}>
      {/* подложка уже размыта и притемнена в prepare-bg.mjs — тут её только показываем */}
      {video ? (
        <OffthreadVideo
          src={staticFile(video)}
          muted
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 900px at ${20 + drift / 6}% 18%, ${accentA}38, transparent 60%),
                       radial-gradient(900px 900px at ${82 - drift / 6}% 84%, ${accentB}33, transparent 60%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage:
            'repeating-linear-gradient(115deg, rgba(255,255,255,.9) 0 2px, transparent 2px 26px)',
        }}
      />
      <AbsoluteFill
        style={{boxShadow: 'inset 0 0 400px 120px rgba(0,0,0,.85)'}}
      />
    </AbsoluteFill>
  );
};
