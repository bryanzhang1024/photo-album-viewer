/** @jest-environment node */

const { createDirectoryWatchService } = require('../../../src/main/services/DirectoryWatchService');

function createFakeWatch() {
  const calls = [];
  const watcher = {
    closed: false,
    listeners: {},
    on(event, handler) { this.listeners[event] = handler; },
    close() { this.closed = true; }
  };
  const fsWatch = jest.fn((target, options, callback) => {
    calls.push({ target, options });
    watcher.trigger = callback;
    return watcher;
  });
  return { fsWatch, watcher, calls };
}

describe('DirectoryWatchService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('连续事件防抖成一次回调', () => {
    const { fsWatch, watcher } = createFakeWatch();
    const service = createDirectoryWatchService({ fsWatch, debounceMs: 400 });
    const onChange = jest.fn();

    service.watch('wc:1', '/Photos/套图', onChange);
    watcher.trigger('rename', 'a.jpg');
    watcher.trigger('rename', 'b.jpg');
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('/Photos/套图');
  });

  test('切换目录时关闭旧监听，同一窗口只保留一个', () => {
    const { fsWatch, watcher } = createFakeWatch();
    const service = createDirectoryWatchService({ fsWatch });
    const first = jest.fn();

    service.watch('wc:1', '/Photos/a', first);
    service.watch('wc:1', '/Photos/b', first);

    expect(watcher.closed).toBe(true);
    expect(fsWatch).toHaveBeenCalledTimes(2);
    watcher.trigger();
    jest.advanceTimersByTime(400);
    expect(first).toHaveBeenCalledWith('/Photos/b');
  });

  test('关闭监听后事件不再回调；监听失败返回 false', () => {
    const { fsWatch, watcher } = createFakeWatch();
    const service = createDirectoryWatchService({ fsWatch });
    const onChange = jest.fn();

    service.watch('wc:1', '/Photos/a', onChange);
    service.close('wc:1');
    watcher.trigger();
    jest.advanceTimersByTime(400);
    expect(onChange).not.toHaveBeenCalled();

    const failing = createDirectoryWatchService({
      fsWatch: () => { throw new Error('EMFILE'); }
    });
    expect(failing.watch('wc:2', '/Photos/a', onChange)).toBe(false);
  });
});
