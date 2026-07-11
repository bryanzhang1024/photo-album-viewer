/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const CHANNELS = require('../../src/common/ipc-channels');
const {
  validateSourceRootsEnvelopeV1
} = require('../../src/common/contracts/navigation-contract-v1');
const { setupMainProcess } = require('../helpers/mainProcessHarness');
const {
  createLoadSourceRootsRequestV1,
  createNavigationTargetV1,
  createSaveSourceRootRequestV1,
  createSourceRootV1
} = require('../helpers/sourceRootFixtures');

function expectValidNavigationEnvelope(result) {
  expect(validateSourceRootsEnvelopeV1(result)).toMatchObject({
    valid: true,
    issues: []
  });
}

function mockMissingApprovedRootsFile() {
  jest.spyOn(fs, 'readFile').mockImplementation((filePath, encoding, callback) => {
    callback(Object.assign(new Error('missing approved roots'), { code: 'ENOENT' }));
  });
}

function mockApprovedRootsWrite() {
  return jest.spyOn(fs, 'writeFile').mockImplementation((filePath, data, encoding, callback) => {
    callback(null);
  });
}

async function flushMainReady() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('SourceRoot V1 IPC', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('instantiates the registry under userData and registers both versioned handlers', () => {
    const { electron, createSourceRootService } = setupMainProcess();

    expect(CHANNELS.LOAD_SOURCE_ROOTS_V1).toBe('load-source-roots-v1');
    expect(CHANNELS.SAVE_SOURCE_ROOT_V1).toBe('save-source-root-v1');
    expect(createSourceRootService).toHaveBeenCalledWith({
      registryPath: path.join('/mock/userData', 'library-sources.json')
    });
    expect(electron.ipcMain._handlers.has(CHANNELS.LOAD_SOURCE_ROOTS_V1)).toBe(true);
    expect(electron.ipcMain._handlers.has(CHANNELS.SAVE_SOURCE_ROOT_V1)).toBe(true);
  });

  test('loads SourceRoots in a strict success envelope', async () => {
    const sources = [createSourceRootV1()];
    const listSourceRoots = jest.fn().mockResolvedValue(sources);
    const { electron } = setupMainProcess({ sourceRootService: { listSourceRoots } });

    const result = await electron.ipcMain.invoke(
      CHANNELS.LOAD_SOURCE_ROOTS_V1,
      createLoadSourceRootsRequestV1()
    );

    expect(result).toEqual({ contractVersion: 1, ok: true, data: { sources } });
    expectValidNavigationEnvelope(result);
    expect(listSourceRoots).toHaveBeenCalledTimes(1);
  });

  test('saves a SourceRoot without adding it to approved roots', async () => {
    const request = createSaveSourceRootRequestV1();
    const saved = { source: createSourceRootV1(), created: true };
    const saveSourceRoot = jest.fn().mockResolvedValue(saved);
    const approvedRootStat = jest.spyOn(fs.promises, 'stat');
    const { electron } = setupMainProcess({ sourceRootService: { saveSourceRoot } });

    const result = await electron.ipcMain.invoke(CHANNELS.SAVE_SOURCE_ROOT_V1, request);

    expect(result).toEqual({ contractVersion: 1, ok: true, data: saved });
    expectValidNavigationEnvelope(result);
    expect(saveSourceRoot).toHaveBeenCalledWith({
      sourceId: request.sourceId,
      rootPath: request.rootPath,
      label: request.label
    });
    expect(approvedRootStat).not.toHaveBeenCalled();
  });

  test.each([
    [
      'LOAD rejects an unsupported version',
      'load',
      createLoadSourceRootsRequestV1({ contractVersion: 2 }),
      'UNSUPPORTED_CONTRACT_VERSION'
    ],
    [
      'LOAD rejects an extra field',
      'load',
      createLoadSourceRootsRequestV1({ extra: true }),
      'INVALID_REQUEST'
    ],
    [
      'SAVE rejects an unsupported version',
      'save',
      createSaveSourceRootRequestV1({ contractVersion: 2 }),
      'UNSUPPORTED_CONTRACT_VERSION'
    ],
    [
      'SAVE rejects an extra field',
      'save',
      createSaveSourceRootRequestV1({ extra: true }),
      'INVALID_REQUEST'
    ],
    [
      'SAVE rejects a malformed source id',
      'save',
      createSaveSourceRootRequestV1({ sourceId: 'src_not-a-uuid' }),
      'INVALID_REQUEST'
    ]
  ])('%s without calling the service', async (_label, operation, request, expectedCode) => {
    const listSourceRoots = jest.fn();
    const saveSourceRoot = jest.fn();
    const { electron } = setupMainProcess({
      sourceRootService: { listSourceRoots, saveSourceRoot }
    });
    const channel = operation === 'load'
      ? CHANNELS.LOAD_SOURCE_ROOTS_V1
      : CHANNELS.SAVE_SOURCE_ROOT_V1;

    const result = await electron.ipcMain.invoke(channel, request);

    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: { code: expectedCode, retryable: false }
    });
    expectValidNavigationEnvelope(result);
    expect(listSourceRoots).not.toHaveBeenCalled();
    expect(saveSourceRoot).not.toHaveBeenCalled();
  });

  test('preserves a known service code without serializing the raw error', async () => {
    const serviceError = Object.assign(
      new Error('Failed to persist the SourceRoot registry atomically'),
      { code: 'SOURCE_ROOT_PERSIST_FAILED', cause: new Error('sensitive disk path') }
    );
    const { electron } = setupMainProcess({
      sourceRootService: { saveSourceRoot: jest.fn().mockRejectedValue(serviceError) }
    });

    const result = await electron.ipcMain.invoke(
      CHANNELS.SAVE_SOURCE_ROOT_V1,
      createSaveSourceRootRequestV1()
    );

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'SOURCE_ROOT_PERSIST_FAILED',
        message: 'Failed to persist the SourceRoot registry atomically',
        retryable: true
      }
    });
    expectValidNavigationEnvelope(result);
    expect(result.error).not.toHaveProperty('stack');
    expect(JSON.stringify(result)).not.toContain('sensitive disk path');
  });

  test('sanitizes unknown service failures', async () => {
    const serviceError = Object.assign(new Error('sensitive native detail'), {
      code: 'UNEXPECTED_NATIVE_ERROR'
    });
    const { electron } = setupMainProcess({
      sourceRootService: { listSourceRoots: jest.fn().mockRejectedValue(serviceError) }
    });

    const result = await electron.ipcMain.invoke(
      CHANNELS.LOAD_SOURCE_ROOTS_V1,
      createLoadSourceRootsRequestV1()
    );

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'SourceRoot operation failed',
        retryable: false
      }
    });
    expectValidNavigationEnvelope(result);
    expect(JSON.stringify(result)).not.toContain('sensitive native detail');
  });

  test('replaces malformed service data with a strict INVALID_RESPONSE envelope', async () => {
    const { electron } = setupMainProcess({
      sourceRootService: { listSourceRoots: jest.fn().mockResolvedValue([{}]) }
    });

    const result = await electron.ipcMain.invoke(
      CHANNELS.LOAD_SOURCE_ROOTS_V1,
      createLoadSourceRootsRequestV1()
    );

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Invalid SourceRoot response',
        retryable: false
      }
    });
    expectValidNavigationEnvelope(result);
  });

  test.each([
    ['CREATE_NEW_WINDOW', 'create-new-window'],
    ['CREATE_NEW_INSTANCE', 'create-new-instance']
  ])('%s resolves a canonical payload and passes only the target to WindowService', async (
    channelKey,
    channelName
  ) => {
    const target = createNavigationTargetV1();
    const resolvedTarget = {
      source: createSourceRootV1(),
      target,
      absolutePath: '/Photos/2026/旅行',
      initialMediaAbsolutePath: '/Photos/2026/旅行/001.jpg'
    };
    const resolveNavigationTarget = jest.fn().mockResolvedValue(resolvedTarget);
    const approvedRootStat = jest.spyOn(fs.promises, 'stat');
    const { electron } = setupMainProcess({
      sourceRootService: { resolveNavigationTarget }
    });
    const WindowService = require('../../src/main/services/WindowService');
    const newWindow = {
      id: 701,
      show: jest.fn(),
      focus: jest.fn()
    };
    WindowService.createWindow.mockReturnValue(newWindow);

    const result = await electron.ipcMain.invoke(channelName, {
      contractVersion: 1,
      target
    });

    expect(result).toMatchObject({ success: true, windowId: 701 });
    expect(resolveNavigationTarget).toHaveBeenCalledWith(target);
    expect(WindowService.createWindow).toHaveBeenCalledWith(target);
    expect(approvedRootStat).not.toHaveBeenCalled();
    expect(CHANNELS[channelKey]).toBe(channelName);
  });

  test.each([
    ['CREATE_NEW_WINDOW', 'create-new-window'],
    ['CREATE_NEW_INSTANCE', 'create-new-instance']
  ])('%s retains the legacy absolute string payload', async (_channelKey, channelName) => {
    const legacyPath = '/Photos/Legacy Trip';
    const approvedRootStat = jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      isDirectory: () => true
    });
    jest.spyOn(fs, 'writeFile').mockImplementation((filePath, data, encoding, callback) => {
      callback(null);
    });
    const resolveNavigationTarget = jest.fn();
    const { electron } = setupMainProcess({
      sourceRootService: { resolveNavigationTarget }
    });
    const WindowService = require('../../src/main/services/WindowService');
    WindowService.createWindow.mockReturnValue({
      id: 702,
      show: jest.fn(),
      focus: jest.fn()
    });

    const result = await electron.ipcMain.invoke(channelName, legacyPath);

    expect(result).toMatchObject({ success: true, windowId: 702 });
    expect(resolveNavigationTarget).not.toHaveBeenCalled();
    expect(WindowService.createWindow).toHaveBeenCalledWith(legacyPath);
    expect(approvedRootStat).toHaveBeenCalledWith(legacyPath);
  });

  test.each([
    ['wrong wrapper version', { contractVersion: 2, target: createNavigationTargetV1() }],
    ['extra wrapper field', {
      contractVersion: 1,
      target: createNavigationTargetV1(),
      extra: true
    }],
    ['invalid target', {
      contractVersion: 1,
      target: createNavigationTargetV1({ relativePath: '../escape' })
    }]
  ])('rejects a canonical window payload with %s', async (_label, payload) => {
    const resolveNavigationTarget = jest.fn();
    const { electron } = setupMainProcess({
      sourceRootService: { resolveNavigationTarget }
    });
    const WindowService = require('../../src/main/services/WindowService');
    WindowService.createWindow.mockReturnValue({ id: 703 });

    const result = await electron.ipcMain.invoke(CHANNELS.CREATE_NEW_WINDOW, payload);

    expect(result).toEqual({ success: false, error: 'Invalid window launch target' });
    expect(resolveNavigationTarget).not.toHaveBeenCalled();
    expect(WindowService.createWindow).not.toHaveBeenCalled();
  });

  test('startup --folder registers the explicit root before opening a canonical window', async () => {
    const originalArgv = process.argv;
    process.argv = ['electron', '.', '--folder', '/Photos/Startup'];
    mockMissingApprovedRootsFile();
    const approvedRootStat = jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      isDirectory: () => true
    });
    const approvedRootsWrite = mockApprovedRootsWrite();
    const source = createSourceRootV1({ rootPath: '/Photos/Startup' });
    const saveSourceRoot = jest.fn().mockResolvedValue({ source, created: true });

    try {
      setupMainProcess({
        sourceRootService: { saveSourceRoot },
        configureElectron(electron) {
          electron.app.whenReady.mockReturnValue(Promise.resolve());
        }
      });
      const WindowService = require('../../src/main/services/WindowService');
      WindowService.createWindow.mockReturnValue({ id: 703 });

      await flushMainReady();

      expect(saveSourceRoot).toHaveBeenCalledWith({
        sourceId: null,
        rootPath: '/Photos/Startup',
        label: null
      });
      expect(approvedRootStat).toHaveBeenCalledWith('/Photos/Startup');
      expect(approvedRootsWrite).toHaveBeenCalledWith(
        path.join('/mock/userData', 'approved-roots.json'),
        expect.stringContaining('/Photos/Startup'),
        'utf8',
        expect.any(Function)
      );
      expect(WindowService.createWindow).toHaveBeenCalledWith({
        sourceId: source.sourceId,
        relativePath: '',
        viewMode: 'browse',
        initialMediaRelativePath: null
      });
    } finally {
      process.argv = originalArgv;
    }
  });

  test('startup --folder fallback still opens a legacy window when root registration fails', async () => {
    const originalArgv = process.argv;
    process.argv = ['electron', '.', '--folder=/Photos/Startup-Fallback'];
    mockMissingApprovedRootsFile();
    const saveSourceRoot = jest.fn().mockRejectedValue(new Error('registry unavailable'));
    const registrationError = Object.assign(new Error('registration unavailable'), {
      code: 'EACCES'
    });
    const approvedRootStat = jest.spyOn(fs.promises, 'stat').mockRejectedValue(registrationError);

    try {
      setupMainProcess({
        sourceRootService: { saveSourceRoot },
        configureElectron(electron) {
          electron.app.whenReady.mockReturnValue(Promise.resolve());
        }
      });
      const WindowService = require('../../src/main/services/WindowService');
      WindowService.createWindow.mockReturnValue({ id: 704 });

      await flushMainReady();

      expect(saveSourceRoot).toHaveBeenCalledWith({
        sourceId: null,
        rootPath: '/Photos/Startup-Fallback',
        label: null
      });
      expect(approvedRootStat).toHaveBeenCalledWith('/Photos/Startup-Fallback');
      expect(WindowService.createWindow).toHaveBeenCalledWith('/Photos/Startup-Fallback');
    } finally {
      process.argv = originalArgv;
    }
  });

  test('second-instance --folder attempts root registration without blocking canonical window', async () => {
    const appHandlers = new Map();
    const source = createSourceRootV1({ rootPath: '/Photos/CLI' });
    const saveSourceRoot = jest.fn().mockResolvedValue({ source, created: true });
    const registrationError = Object.assign(new Error('registration unavailable'), {
      code: 'EACCES'
    });
    const approvedRootStat = jest.spyOn(fs.promises, 'stat').mockRejectedValue(registrationError);
    setupMainProcess({
      sourceRootService: { saveSourceRoot },
      configureElectron(electron) {
        electron.app.on.mockImplementation((event, handler) => {
          appHandlers.set(event, handler);
        });
      }
    });
    const WindowService = require('../../src/main/services/WindowService');
    WindowService.createWindow.mockReturnValue({
      id: 704,
      isMinimized: jest.fn(() => false),
      focus: jest.fn(),
      setAlwaysOnTop: jest.fn(),
      maximize: jest.fn(),
      restore: jest.fn()
    });

    await appHandlers.get('second-instance')({}, [
      'electron',
      '.',
      '--folder',
      '/Photos/CLI'
    ], '/');

    expect(saveSourceRoot).toHaveBeenCalledWith({
      sourceId: null,
      rootPath: '/Photos/CLI',
      label: null
    });
    expect(WindowService.createWindow).toHaveBeenCalledWith({
      sourceId: source.sourceId,
      relativePath: '',
      viewMode: 'browse',
      initialMediaRelativePath: null
    });
    expect(approvedRootStat).toHaveBeenCalledWith('/Photos/CLI');
  });

  test('second-instance --folder falls back to the legacy target when SourceRoot save fails', async () => {
    const appHandlers = new Map();
    const saveSourceRoot = jest.fn().mockRejectedValue(new Error('registry unavailable'));
    const approvedRootStat = jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      isDirectory: () => true
    });
    const approvedRootsWrite = mockApprovedRootsWrite();
    setupMainProcess({
      sourceRootService: { saveSourceRoot },
      configureElectron(electron) {
        electron.app.on.mockImplementation((event, handler) => {
          appHandlers.set(event, handler);
        });
      }
    });
    const WindowService = require('../../src/main/services/WindowService');
    WindowService.createWindow.mockReturnValue({
      id: 705,
      isMinimized: jest.fn(() => false),
      focus: jest.fn(),
      setAlwaysOnTop: jest.fn(),
      maximize: jest.fn(),
      restore: jest.fn()
    });

    await appHandlers.get('second-instance')({}, [
      'electron',
      '.',
      '--folder=/Photos/Fallback'
    ], '/');

    expect(saveSourceRoot).toHaveBeenCalledWith({
      sourceId: null,
      rootPath: '/Photos/Fallback',
      label: null
    });
    expect(approvedRootStat).toHaveBeenCalledWith('/Photos/Fallback');
    expect(approvedRootsWrite).toHaveBeenCalledWith(
      path.join('/mock/userData', 'approved-roots.json'),
      expect.stringContaining('/Photos/Fallback'),
      'utf8',
      expect.any(Function)
    );
    expect(WindowService.createWindow).toHaveBeenCalledWith('/Photos/Fallback');
  });
});
