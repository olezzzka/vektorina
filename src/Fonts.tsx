import React, {useEffect, useState} from 'react';
import {staticFile, delayRender, continueRender} from 'remotion';

const face = (family: string, file: string, weight: number) => `
@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;
src:url(${staticFile('fonts/' + file)}) format('woff2');}`;

export const Fonts: React.FC = () => {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    const done = () => continueRender(handle);
    Promise.all([
      document.fonts.load('900 100px "InterQuiz"', 'ЧТО ДОРОЖЕ 0123456789'),
      document.fonts.load('700 100px "InterQuiz"', 'Раунд скины'),
      document.fonts.load('500 100px "InterQuiz"', 'цены комменты'),
      document.fonts.load('400 100px "BebasQuiz"', '0123456789$VS'),
    ]).then(() => document.fonts.ready).then(done, done);
  }, [handle]);
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: [
          face('InterQuiz', 'inter-cyrillic-500-normal.woff2', 500),
          face('InterQuiz', 'inter-cyrillic-700-normal.woff2', 700),
          face('InterQuiz', 'inter-cyrillic-900-normal.woff2', 900),
          face('InterQuiz', 'inter-latin-500-normal.woff2', 500),
          face('InterQuiz', 'inter-latin-700-normal.woff2', 700),
          face('InterQuiz', 'inter-latin-900-normal.woff2', 900),
          face('BebasQuiz', 'bebas-neue-latin-400-normal.woff2', 400),
        ].join('\n'),
      }}
    />
  );
};
