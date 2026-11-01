import React from 'react';
import { act, renderHook, render, screen, fireEvent, waitFor } from '@testing-library/react';
import useImageMultiSelection from '../../src/ui/hooks/useImageMultiSelection';
import VirtualGrid from '../../src/ui/components/VirtualGrid';
import GridCard from '../../src/ui/components/GridCard';

const items = ['a', 'b', 'c', 'd'].map(key => ({ key, path: `/photos/${key}.png` }));
const click = (extra = {}) => ({ metaKey: true, preventDefault: jest.fn(), ...extra });
const requestCopy = () => {
  const event = new CustomEvent('pav:copy-selection', { cancelable: true });
  act(() => window.dispatchEvent(event));
  return event;
};

beforeEach(() => {
  window.electronAPI.invoke.mockReset();
  window.electronAPI.invoke.mockImplementation(async (channel, paths) => ({ success: true, count: paths?.length }));
});

test('⌘点选增减，Shift 连选，复制顺序按显示顺序；普通单击交还原打开行为', async () => {
  const { result } = renderHook(() => useImageMultiSelection({ items, scopeKey: 'one' }));
  act(() => {
    result.current.handleClick('c', click());
    result.current.handleClick('a', click());
  });
  expect(result.current.selectedPaths).toEqual(['/photos/a.png', '/photos/c.png']);
  expect(requestCopy().defaultPrevented).toBe(true);
  await waitFor(() => expect(result.current.message).toBe('已复制 2 张原图'));
  expect(window.electronAPI.invoke).toHaveBeenCalledWith('copy-images-to-clipboard', ['/photos/a.png', '/photos/c.png']);
  act(() => result.current.handleClick('a', click()));
  expect([...result.current.selectedKeys]).toEqual(['c']);
  act(() => result.current.handleClick('d', click({ metaKey: false, shiftKey: true })));
  expect(result.current.selectedPaths).toEqual(['/photos/a.png', '/photos/b.png', '/photos/c.png', '/photos/d.png']);
  expect(result.current.handleClick('b', click({ metaKey: false }))).toBe(false);
});

test('无锚点 Shift 只选当前图；框选仅接受当前范围，清空后 ⌘C 不接管', () => {
  const { result } = renderHook(() => useImageMultiSelection({ items, scopeKey: 'one' }));
  act(() => result.current.handleClick('c', click({ metaKey: false, shiftKey: true })));
  expect(result.current.selectedPaths).toEqual(['/photos/c.png']);
  act(() => result.current.setBoxSelection(['d', 'a', 'folder', 'a']));
  expect(result.current.selectedPaths).toEqual(['/photos/a.png', '/photos/d.png']);
  act(() => result.current.clear());
  expect(requestCopy().defaultPrevented).toBe(false);
  expect(window.electronAPI.invoke).not.toHaveBeenCalled();
});

test('分页增加和滚动不丢选中，范围/排序/标签变化清空，查看器打开时不接管复制', () => {
  const { result, rerender } = renderHook(props => useImageMultiSelection(props), { initialProps: { items: items.slice(0, 2), scopeKey: 'one', enabled: true } });
  act(() => result.current.handleClick('a', click()));
  rerender({ items, scopeKey: 'one', enabled: true });
  expect(result.current.selectedPaths).toEqual(['/photos/a.png']);
  rerender({ items, scopeKey: 'one', enabled: false });
  expect(requestCopy().defaultPrevented).toBe(false);
  rerender({ items, scopeKey: 'two', enabled: true });
  expect(result.current.selectedPaths).toEqual([]);
});

test('输入框、可编辑区域保留文本复制；IPC 失败显示失败原因', async () => {
  const { result } = renderHook(() => useImageMultiSelection({ items, scopeKey: 'one' }));
  act(() => result.current.handleClick('b', click()));
  const { unmount } = render(<input aria-label="text" />);
  screen.getByLabelText('text').focus();
  expect(requestCopy().defaultPrevented).toBe(false);
  unmount();
  window.electronAPI.invoke.mockResolvedValue({ success: false, error: '图片已被移动' });
  expect(requestCopy().defaultPrevented).toBe(true);
  await waitFor(() => expect(result.current.message).toBe('复制失败：图片已被移动'));
});

test('多选 hook 不单独抢方向键或新增 Esc 层级，由原导航监听器负责交接', () => {
  const { result } = renderHook(() => useImageMultiSelection({ items, scopeKey: 'one' }));
  act(() => result.current.handleClick('c', click()));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(result.current.selectedPaths).toEqual(['/photos/c.png']);
  const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  act(() => window.dispatchEvent(event));
  expect(result.current.selectedPaths).toEqual(['/photos/c.png']);
  expect(event.defaultPrevented).toBe(false);
});

test('真实网格框选从空白开始，选中相交卡片，松开不误打开；空白点击取消', () => {
  const rect = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 };
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  const onOpen = jest.fn();
  function Grid() {
    const selection = useImageMultiSelection({ items, scopeKey: 'one' });
    return <VirtualGrid items={items} selection={selection} renderItem={(item, width, coverHeight) => <GridCard key={item.key} dataKey={item.key} selected={selection.selectedKeys.has(item.key)} name={item.key} width={width} coverHeight={coverHeight} onClick={onOpen} cover={<span>{item.key}</span>} />} />;
  }
  const { container } = render(<Grid />);
  const grid = screen.getByLabelText('文件网格');
  // jsdom 没有 PointerEvent，沿用原生 MouseEvent 以保留坐标。
  const pointer = (type, x, y) => fireEvent(grid, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  pointer('pointerdown', 5, 5);
  pointer('pointermove', 490, 150);
  expect(container.querySelectorAll('.grid-card.selected')).toHaveLength(2);
  expect(container.querySelector('.grid-selection-box')).toBeTruthy();
  pointer('pointerup', 490, 150);
  fireEvent.click(grid);
  expect(onOpen).not.toHaveBeenCalled();
  expect(container.querySelectorAll('.grid-card.selected')).toHaveLength(2);
  pointer('pointerdown', 5, 5);
  pointer('pointerup', 5, 5);
  fireEvent.click(grid);
  expect(container.querySelectorAll('.grid-card.selected')).toHaveLength(0);
  jest.restoreAllMocks();
});
