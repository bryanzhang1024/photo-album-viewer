import { act, renderHook } from '@testing-library/react';
import { useNavigationHistory } from '../../../src/renderer/hooks/useNavigationHistory';

const landing = { kind: 'landing' };
const favorites = { kind: 'favorites' };
const albumA = {
  kind: 'directory',
  target: { sourceId: 'src-1', relativePath: 'A', viewMode: 'photoSet', initialMediaRelativePath: null }
};
const albumB = {
  kind: 'directory',
  target: { sourceId: 'src-1', relativePath: 'B', viewMode: 'photoSet', initialMediaRelativePath: null }
};

function setup(initialTabId = 'tab-1', initialLocation = landing) {
  const applied = [];
  const view = renderHook(
    ({ tabId, location }) => useNavigationHistory({
      tabId,
      location,
      applyLocation: (next) => applied.push(next)
    }),
    { initialProps: { tabId: initialTabId, location: initialLocation } }
  );
  return { ...view, applied };
}

test('初始位置不可后退也不可前进', () => {
  const { result } = setup();
  expect(result.current.canGoBack).toBe(false);
  expect(result.current.canGoForward).toBe(false);
});

test('移动到新位置后可以后退，后退会应用上一个位置', () => {
  const { result, rerender, applied } = setup();
  rerender({ tabId: 'tab-1', location: favorites });
  expect(result.current.canGoBack).toBe(true);
  expect(result.current.canGoForward).toBe(false);

  act(() => { result.current.goBack(); });
  expect(applied).toEqual([landing]);

  // 页面随后把当前标签位置切到 landing
  rerender({ tabId: 'tab-1', location: landing });
  expect(result.current.canGoForward).toBe(true);
  expect(result.current.canGoBack).toBe(false);
});

test('前进与后退在标签之间互不影响', () => {
  const { result, rerender } = setup('tab-1', landing);
  rerender({ tabId: 'tab-1', location: albumA });
  rerender({ tabId: 'tab-1', location: albumB });
  expect(result.current.canGoBack).toBe(true);

  rerender({ tabId: 'tab-2', location: favorites });
  expect(result.current.canGoBack).toBe(false);

  rerender({ tabId: 'tab-1', location: albumB });
  expect(result.current.canGoBack).toBe(true);
});

test('在历史中间打开新位置会截断前进分支', () => {
  const { result, rerender, applied } = setup('tab-1', landing);
  rerender({ tabId: 'tab-1', location: albumA });
  rerender({ tabId: 'tab-1', location: albumB });
  act(() => { result.current.goBack(); });
  rerender({ tabId: 'tab-1', location: albumA });
  expect(result.current.canGoForward).toBe(true);

  rerender({ tabId: 'tab-1', location: favorites });
  expect(result.current.canGoForward).toBe(false);
  expect(applied).toEqual([albumA]);
});
