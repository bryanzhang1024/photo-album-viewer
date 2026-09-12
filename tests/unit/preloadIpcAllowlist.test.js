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

  test('exposes the runtime platform as read-only bootstrap data', () => {
    const { api } = loadPreload();
    expect(api.platform).toBe(process.platform);
  });

  test.each([
    ['LOAD_SOURCE_ROOTS_V1', 'load-source-roots-v1'],
    ['SAVE_SOURCE_ROOT_V1', 'save-source-root-v1'],
    ['VALIDATE_NAVIGATION_TARGET_V1', 'validate-navigation-target-v1']
  ])('keeps %s synchronized across common, fallback, and invoke allowlists', async (
    channelKey,
    channelName
  ) => {
    expect(CHANNELS[channelKey]).toBe(channelName);

    for (const useFallback of [false, true]) {
      const { api, electron } = loadPreload({ useFallback });
      const request = { contractVersion: 1 };

      await expect(api.invoke(channelName, request)).resolves.toBe('ok');
      expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(channelName, request);
    }
  });

  test('continues blocking unknown invoke channels', () => {
    const { api } = loadPreload();
    expect(() => api.invoke('unknown-channel')).toThrow('Blocked IPC invoke channel');
  });

  test.each([
    'COS_GET_STATUS',
    'COS_SELECT_ROOT',
    'COS_REMOVE_ROOT',
    'COS_REFRESH',
    'COS_LIST_CHARACTERS',
    'COS_LIST_LOOKS',
    'COS_LIST_COSERS',
    'COS_LIST_SETS',
    'COS_GET_SET',
    'COS_GET_SET_ALBUM_PATH',
    'COS_GET_MEDIA_THUMBNAIL',
    'COS_SHOW_SET_IN_FOLDER',
    'COS_OPEN_IN_PICTUREVIEW'
  ])('allows the %s Cos library channel in common and fallback mode', async (channelKey) => {
    for (const useFallback of [false, true]) {
      const { api } = loadPreload({ useFallback });
      await expect(api.invoke(CHANNELS[channelKey], {})).resolves.toBe('ok');
    }
  });

  test('allows Cos index progress listeners in common and fallback mode', () => {
    for (const useFallback of [false, true]) {
      const { api, electron } = loadPreload({ useFallback });
      const listener = jest.fn();
      expect(() => api.on(CHANNELS.COS_INDEX_PROGRESS, listener)).not.toThrow();
      expect(electron.ipcRenderer.on).toHaveBeenCalledWith('cos-index-progress', listener);
    }
  });
});
