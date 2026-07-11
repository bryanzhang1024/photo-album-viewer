/** @jest-environment node */

const CHANNELS = require('../../src/common/ipc-channels');

function loadPreload({ useFallback = false } = {}) {
  jest.resetModules();
  const exposed = {};
  const electron = {
    contextBridge: {
      exposeInMainWorld: jest.fn((name, api) => { exposed[name] = api; })
    },
    ipcRenderer: {
      invoke: jest.fn().mockResolvedValue('ok'),
      send: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn()
    },
    webUtils: { getPathForFile: jest.fn(() => '') }
  };
  jest.doMock('electron', () => electron);
  if (useFallback) {
    jest.doMock('../../src/common/ipc-channels', () => {
      throw new Error('unavailable');
    });
  }
  require('../../src/main/preload');
  return { api: exposed.electronAPI, electron };
}

describe('preload IPC allowlist', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('electron');
    jest.dontMock('../../src/common/ipc-channels');
    jest.resetModules();
  });

  test.each([false, true])('allows GET_DIRECTORY_LEVEL_V1 (fallback=%s)', async (useFallback) => {
    const { api, electron } = loadPreload({ useFallback });
    const request = { contractVersion: 1 };
    await expect(api.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request)).resolves.toBe('ok');
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      'get-directory-level-v1',
      request
    );
  });

  test('continues blocking unknown invoke channels', () => {
    const { api } = loadPreload();
    expect(() => api.invoke('unknown-channel')).toThrow('Blocked IPC invoke channel');
  });
});
