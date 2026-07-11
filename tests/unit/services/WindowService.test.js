/** @jest-environment node */

const {
  createNavigationTargetV1
} = require('../../helpers/sourceRootFixtures');

const setupWindowService = ({ isDev = true, httpImpl } = {}) => {
  jest.resetModules();

  let electronMocks;
  jest.doMock('electron', () => {
    const { createElectronMocks } = require('../../helpers/electronMock');
    electronMocks = createElectronMocks();
    return electronMocks;
  }, { virtual: true });

  jest.doMock('electron-is-dev', () => isDev, { virtual: true });

  const httpGetMock = jest.fn();
  jest.doMock('http', () => ({
    get: httpGetMock
  }));

  if (httpImpl) {
    httpGetMock.mockImplementation(httpImpl);
  }

  const WindowService = require('../../../src/main/services/WindowService');
  const http = require('http');

  if (!httpImpl) {
    http.get.mockImplementation((options, callback) => {
      const req = {
        on: jest.fn(),
        end: jest.fn()
      };
      callback({ statusCode: 200 });
      return req;
    });
  }

  return { WindowService, electron: electronMocks, httpGetMock: http.get };
};

describe('WindowService', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    jest.resetModules();
  });

  test('dev mode loads dev server url and sets main window', async () => {
    const httpImpl = (options, callback) => {
      const req = {
        on: jest.fn(),
        end: jest.fn()
      };
      callback({ statusCode: 200 });
      return req;
    };

    const { WindowService, electron } = setupWindowService({
      isDev: true,
      httpImpl
    });

    const win = WindowService.createWindow('/albums/dev');
    // Allow any pending microtasks (should be none after synchronous callback)
    await Promise.resolve();

    expect(electron.BrowserWindow).toHaveBeenCalledTimes(1);
    expect(win.loadURL).toHaveBeenCalledWith(
      'http://localhost:3000/#/browse?initialPath=%2Falbums%2Fdev'
    );
    expect(WindowService.getMainWindow()).toBe(win);
    expect(WindowService.windows.has(win)).toBe(true);
  });

  test('production mode loads file url and quits when last window closes', () => {
    const { WindowService, electron } = setupWindowService({ isDev: false });

    const win = WindowService.createWindow();

    expect(win.loadURL).toHaveBeenCalledWith(
      expect.stringContaining('file://')
    );
    expect(WindowService.getMainWindow()).toBe(win);

    win.emit('closed');

    expect(WindowService.windows.size).toBe(0);
    expect(electron.app.quit).toHaveBeenCalled();
    expect(WindowService.getMainWindow()).toBeNull();
  });

  test('builds a production HashRouter URL for a canonical target', () => {
    const { WindowService } = setupWindowService({ isDev: false });
    const target = createNavigationTargetV1({
      relativePath: '2026/Trip',
      initialMediaRelativePath: null
    });

    expect(WindowService.buildWindowUrl('file:///Applications/Photo/index.html', target)).toBe(
      'file:///Applications/Photo/index.html#/browse'
      + '?sourceId=src_11111111-1111-4111-8111-111111111111'
      + '&relativePath=2026%2FTrip&view=album'
    );
  });

  test.each([
    '/Photos/Family Trip',
    '/照片/旅行 100%',
    'C:\\Photos\\Trip 100%',
    '\\\\NAS\\Photos\\旅行%'
  ])('encodes and decodes one legacy %s cycle inside the hash', (legacyPath) => {
    const { WindowService } = setupWindowService({ isDev: false });
    const expectedParams = new URLSearchParams({ initialPath: legacyPath });

    const windowUrl = WindowService.buildWindowUrl('http://localhost:3000/', legacyPath);
    const hashQuery = new URL(windowUrl).hash.split('?')[1];

    expect(windowUrl).toBe(
      `http://localhost:3000/#/browse?${expectedParams.toString()}`
    );
    expect(new URLSearchParams(hashQuery).get('initialPath')).toBe(legacyPath);
  });

  test('encodes canonical fields once and emits only legacy view words', () => {
    const { WindowService } = setupWindowService({ isDev: false });
    const target = createNavigationTargetV1({
      relativePath: '2026/旅行 100%',
      initialMediaRelativePath: '2026/旅行 100%/封面 01%.jpg'
    });

    const windowUrl = WindowService.buildWindowUrl('http://localhost:3000/', target);
    const params = new URLSearchParams(new URL(windowUrl).hash.split('?')[1]);

    expect(windowUrl).toContain('#/browse?sourceId=');
    expect(windowUrl).toContain('&view=album&image=');
    expect(params.get('sourceId')).toBe(target.sourceId);
    expect(params.get('relativePath')).toBe(target.relativePath);
    expect(params.get('view')).toBe('album');
    expect(params.get('image')).toBe(target.initialMediaRelativePath);
    expect(windowUrl).not.toContain('photoSet');
  });

  test('rejects unsupported launch target shapes', () => {
    const { WindowService } = setupWindowService({ isDev: false });

    expect(() => WindowService.buildWindowUrl('http://localhost:3000/', 'relative/path'))
      .toThrow('Invalid window launch target');
    expect(() => WindowService.buildWindowUrl('http://localhost:3000/', {
      ...createNavigationTargetV1(),
      extra: true
    })).toThrow('Invalid window launch target');
  });
});
