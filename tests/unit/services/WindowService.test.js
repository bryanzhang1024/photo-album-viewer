/** @jest-environment node */

const path = require('path');
const { createElectronMocks } = require('../../helpers/electronMock');

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
      expect.stringContaining('http://localhost:3000/?initialPath=%2Falbums%2Fdev')
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
});
