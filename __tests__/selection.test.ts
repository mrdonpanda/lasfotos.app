import { allSelected, pruneSelection, toggleAll, toggleKey } from '../src/lib/selection';

describe('gallery selection', () => {
  const keys = ['a', 'b', 'c'];
  it('toggles one photo without mutating the previous set', () => {
    const start = new Set(['a']);
    const next = toggleKey(start, 'b');
    expect([...next].sort()).toEqual(['a', 'b']);
    expect([...start]).toEqual(['a']);
    expect([...toggleKey(next, 'a')]).toEqual(['b']);
  });
  it('Select all selects everything, then clears', () => {
    const all = toggleAll(keys, new Set(['a']));
    expect([...all].sort()).toEqual(keys);
    expect(allSelected(keys, all)).toBe(true);
    expect(toggleAll(keys, all).size).toBe(0);
  });
  it('is never "all selected" for an empty list', () => {
    expect(allSelected([], new Set())).toBe(false);
  });
  it('drops photos that disappeared after a reload', () => {
    expect([...pruneSelection(new Set(['a', 'x']), keys)]).toEqual(['a']);
  });
});
