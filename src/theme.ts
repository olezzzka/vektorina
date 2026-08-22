export const theme = {
  bg: '#080b10',
  panel: 'rgba(255,255,255,0.045)',
  panelEdge: 'rgba(255,255,255,0.10)',
  text: '#ffffff',
  dim: 'rgba(255,255,255,0.55)',
  gold: '#f0b232',
  green: '#37e08a',
  red: '#ff4d5e',
  fontUI: '"InterQuiz", system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontNum: '"BebasQuiz", "InterQuiz", sans-serif',
};

export type Item = {
  hash: string; name: string; weapon: string; pattern: string;
  wear: string | null; wearShort: string; rarity: string; color: string;
  knife?: boolean; price: number; image: string; imageLocal?: string;
};
export type Round = {a: Item; b: Item; answer: 'a' | 'b'; ratio: number; trap: boolean};
export type PriceRound = {item: Item; options: number[]; answer: number};
export type OddRound = {items: Item[]; answer: number; ratio: number; dearer: boolean};
export type AnyRound = Round | PriceRound | OddRound;
export type QuizFormat = 'duel' | 'price' | 'odd';
export type NarrationLine = {
  text: string; alts?: string[]; emotion?: 'hype' | 'neutral' | 'warm';
  frame: number; window: number;
  /** сколько кадров реально занимает синтезированная речь (проставляет voice.mjs) */
  spoken?: number;
};
export type Quiz = {
  id: string;
  format?: QuizFormat;
  symbol: string;
  rate: number;
  priceMeta: {source: string; updatedAt: string | null};
  timing: {intro: number; roundIn: number; countdown: number; reveal: number; outro: number};
  text: {introTitle: string; introSubtitle: string; outroTitle: string; outroSubtitle: string; outroCta: string};
  audio?: {
    enabled: boolean; master: number; whoosh: number; tick: number;
    reveal: number; riser: number; outro: number; voice?: number;
    music?: {file: string | null; volume: number; duckTo: number};
  };
  captions?: {enabled: boolean};
  narration?: NarrationLine[];
  voice?: string;
  rounds: AnyRound[];
};

export const roundLength = (t: Quiz['timing']) => t.roundIn + t.countdown + t.reveal;
export const totalLength = (q: Quiz) => q.timing.intro + q.rounds.length * roundLength(q.timing) + q.timing.outro;

export const fmtPrice = (v: number, symbol: string) => {
  const s = v >= 1000 ? Math.round(v).toLocaleString('ru-RU') : v >= 100 ? v.toFixed(0) : v.toFixed(2);
  return `${symbol}${s}`;
};
