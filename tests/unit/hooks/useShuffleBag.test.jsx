import { renderHook, act } from '@testing-library/react';
import useShuffleBag from '../../../src/renderer/hooks/useShuffleBag';

const getPath = (item) => item.path;

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

  test('starts a fresh bag after remount with the same scope and candidates', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    const items = [{ path: '/a' }, { path: '/b' }];
    const first = renderHook(() => useShuffleBag(items, '/scope', { getKey: getPath }));

    let firstDraw;
    act(() => {
      firstDraw = first.result.current.drawNext()?.path;
    });
    first.unmount();

    const second = renderHook(() => useShuffleBag(items, '/scope', { getKey: getPath }));
    let remountedDraw;
    act(() => {
      remountedDraw = second.result.current.drawNext()?.path;
    });

    expect(firstDraw).toBe('/b');
    expect(remountedDraw).toBe('/b');
    randomSpy.mockRestore();
  });

  test('resets the bag when excludeKey changes', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    const items = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
    const { result, rerender } = renderHook(
      ({ excludeKey }) => useShuffleBag(items, '/scope', { getKey: getPath, excludeKey }),
      { initialProps: { excludeKey: '/a' } }
    );

    act(() => {
      expect(result.current.drawNext()?.path).toBe('/c');
    });
    rerender({ excludeKey: '/b' });
    act(() => {
      expect(result.current.drawNext()?.path).toBe('/c');
    });

    randomSpy.mockRestore();
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
