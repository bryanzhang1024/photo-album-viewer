import { renderHook, act } from '@testing-library/react';
import useShuffleBag from '../../../src/renderer/hooks/useShuffleBag';

describe('useShuffleBag', () => {
  test('draws each item once before repeating', () => {
    const items = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
    const { result } = renderHook(() =>
      useShuffleBag(items, '/scope', { getKey: (item) => item.path })
    );

    const firstRound = [];
    act(() => {
      for (let i = 0; i < 3; i += 1) {
        firstRound.push(result.current.drawNext()?.path);
      }
    });

    expect(new Set(firstRound)).toEqual(new Set(['/a', '/b', '/c']));

    act(() => {
      expect(result.current.drawNext()?.path).toBeTruthy();
    });
  });

  test('resets bag when scope changes', () => {
    const items = [{ path: '/a' }, { path: '/b' }];
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useShuffleBag(items, scopeKey, { getKey: (item) => item.path }),
      { initialProps: { scopeKey: '/one' } }
    );

    act(() => {
      result.current.drawNext();
    });

    rerender({ scopeKey: '/two' });

    act(() => {
      expect(result.current.drawNext()?.path).toBeTruthy();
    });
  });

  test('resetBag clears the pocket', () => {
    const items = [{ path: '/a' }, { path: '/b' }];
    const { result } = renderHook(() =>
      useShuffleBag(items, '/scope', { getKey: (item) => item.path })
    );

    act(() => {
      result.current.drawNext();
      result.current.resetBag();
      expect(result.current.drawNext()?.path).toBeTruthy();
    });
  });
});
