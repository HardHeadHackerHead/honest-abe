import { describe, it, expect } from 'vitest';
import { applyDictionary, DictionaryEntry } from './wordDictionary';

const entry = (from: string, to: string): DictionaryEntry => ({ from, to, createdAt: '' });

describe('applyDictionary', () => {
  it('replaces whole words case-insensitively and keeps capitalization', () => {
    const entries = [entry('abe', 'Abe'), entry('kubernetes', 'Kubernetes')];
    expect(applyDictionary('hey abe, deploy to kubernetes.', entries)).toBe('hey Abe, deploy to Kubernetes.');
    expect(applyDictionary('ABE', [entry('abe', 'abel')])).toBe('ABEL');
    expect(applyDictionary('Teh cat', [entry('teh', 'the')])).toBe('The cat');
  });

  it('does not match inside other words', () => {
    expect(applyDictionary('cathedral cat', [entry('cat', 'dog')])).toBe('cathedral dog');
    expect(applyDictionary('cat_food 2cat', [entry('cat', 'dog')])).toBe('cat_food 2cat');
  });

  it('handles non-ASCII words and boundaries', () => {
    expect(applyDictionary('un café noir', [entry('café', 'thé')])).toBe('un thé noir');
    // "é" is a letter, so "caf" is not a whole word in "café"
    expect(applyDictionary('café', [entry('caf', 'X')])).toBe('café');
    expect(applyDictionary('привет мир', [entry('мир', 'world')])).toBe('привет world');
  });

  it('matches entries that start or end with punctuation', () => {
    expect(applyDictionary('I write c++ daily', [entry('c++', 'C++')])).toBe('I write C++ daily');
    expect(applyDictionary('use node.js here', [entry('node.js', 'Node.js')])).toBe('use Node.js here');
    expect(applyDictionary('a-b and a-b', [entry('a-b', 'A–B')])).toBe('A–B and A–B');
  });

  it('never chains replacements', () => {
    const entries = [entry('a', 'b'), entry('b', 'c')];
    expect(applyDictionary('a b', entries)).toBe('b c');
  });

  it('prefers the longest entry', () => {
    const entries = [entry('new', 'NEW'), entry('new york', 'New York')];
    expect(applyDictionary('i love new york', entries)).toBe('i love New York');
  });

  it('replaces adjacent repeats', () => {
    expect(applyDictionary('teh teh', [entry('teh', 'the')])).toBe('the the');
  });

  it('is a no-op without entries', () => {
    expect(applyDictionary('hello', [])).toBe('hello');
    expect(applyDictionary('', [entry('a', 'b')])).toBe('');
  });
});
