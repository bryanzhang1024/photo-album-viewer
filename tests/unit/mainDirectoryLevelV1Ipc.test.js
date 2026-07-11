/** @jest-environment node */

const CHANNELS = require('../../src/common/ipc-channels');
const { setupMainProcess } = require('../helpers/mainProcessHarness');
const {
  validateDirectoryEnvelopeV1
} = require('../../src/common/contracts/directory-contract-v1');
const {
  createDirectoryLevelRequestV1,
  createDirectorySnapshotV1
} = require('../helpers/directoryContractFixtures');

function expectValidV1Envelope(result) {
  expect(validateDirectoryEnvelopeV1(result)).toMatchObject({
    valid: true,
    issues: []
  });
}

describe('GET_DIRECTORY_LEVEL_V1 IPC', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns one success envelope for a valid snapshot', async () => {
    const request = createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: '/forged/photos' }
    });
    const locator = {
      ref: request.ref,
      absolutePath: '/registered/photos',
      name: 'photos'
    };
    const snapshot = createDirectorySnapshotV1({
      locator: { absolutePath: '/registered/photos' }
    });
    const resolveDirectoryLocatorV1 = jest.fn(() => locator);
    const scanDirectorySnapshot = jest.fn().mockResolvedValue(snapshot);
    const scanNavigationLevel = jest.fn();
    const { electron } = setupMainProcess({
      fileSystemService: { scanNavigationLevel },
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot },
      sourceRootService: {
        getSourceRoot: jest.fn().mockResolvedValue({
          schemaVersion: 1,
          sourceId: request.ref.sourceId,
          label: 'photos',
          rootPath: '/registered/photos',
          sourceGeneration: 1
        })
      }
    });
    const handler = electron.ipcMain._handlers.get(CHANNELS.GET_DIRECTORY_LEVEL_V1);
    const event = { sender: { isDestroyed: jest.fn(() => false), send: jest.fn() } };
    const result = await handler(event, request);
    expect(result).toEqual({ contractVersion: 1, ok: true, data: snapshot });
    expectValidV1Envelope(result);
    expect(resolveDirectoryLocatorV1).toHaveBeenCalledWith({
      contractVersion: 1,
      runtimeSource: {
        sourceId: request.ref.sourceId,
        rootPath: '/registered/photos'
      },
      ref: request.ref
    });
    expect(scanDirectorySnapshot).toHaveBeenCalledWith(locator, {
      concurrencyLimit: expect.any(Number)
    });
    expect(scanNavigationLevel).not.toHaveBeenCalled();
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  test('maps an unavailable root service response to INVALID_RESPONSE', async () => {
    const request = createDirectoryLevelRequestV1();
    const snapshot = createDirectorySnapshotV1({
      status: 'missing',
      completeness: { entries: 'partial', directMedia: 'partial', children: 'partial' },
      facts: { directMediaCount: 0, childDirectoryCount: 0 },
      directMedia: [],
      children: [],
      approximate: {
        coverSamples: [],
        hasDescendantMedia: 'unknown',
        observedAt: 1783728000000,
        truncated: true
      }
    });
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({
          ref: request.ref,
          absolutePath: '/photos',
          name: 'photos'
        })),
        scanDirectorySnapshot: jest.fn().mockResolvedValue(snapshot)
      }
    });
    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);
    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: { code: 'INVALID_RESPONSE', retryable: false }
    });
    expectValidV1Envelope(result);
  });

  test('rejects unsupported versions without scanning', async () => {
    const resolveDirectoryLocatorV1 = jest.fn();
    const scanDirectorySnapshot = jest.fn();
    const { electron } = setupMainProcess({
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot }
    });
    const result = await electron.ipcMain.invoke(
      CHANNELS.GET_DIRECTORY_LEVEL_V1,
      createDirectoryLevelRequestV1({ contractVersion: 2 })
    );
    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'UNSUPPORTED_CONTRACT_VERSION',
        message: 'Unsupported contract version',
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(resolveDirectoryLocatorV1).not.toHaveBeenCalled();
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });

  test.each([
    [
      'missing contract version',
      (request) => { delete request.contractVersion; },
      'INVALID_REQUEST',
      'Contract version is required'
    ],
    [
      'non-numeric contract version',
      (request) => { request.contractVersion = '1'; },
      'INVALID_REQUEST',
      'Contract version must be a number'
    ],
    [
      'mismatched source ids',
      (request) => {
        request.ref.sourceId = 'src_22222222-2222-4222-8222-222222222222';
      },
      'SOURCE_ID_MISMATCH',
      'Directory ref must match runtime source'
    ],
    [
      'missing compatibility runtime source',
      (request) => { delete request.runtimeSource; },
      'INVALID_REQUEST',
      'runtimeSource is required'
    ]
  ])('classifies %s with the selected validation message', async (
    _label,
    mutateRequest,
    expectedCode,
    expectedMessage
  ) => {
    const request = createDirectoryLevelRequestV1();
    mutateRequest(request);
    const resolveDirectoryLocatorV1 = jest.fn();
    const scanDirectorySnapshot = jest.fn();
    const { electron } = setupMainProcess({
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot }
    });

    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);

    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: {
        code: expectedCode,
        message: expectedMessage,
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(resolveDirectoryLocatorV1).not.toHaveBeenCalled();
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });

  test('returns SOURCE_NOT_FOUND before resolving an unregistered DirectoryRef', async () => {
    const request = createDirectoryLevelRequestV1();
    const resolveDirectoryLocatorV1 = jest.fn();
    const scanDirectorySnapshot = jest.fn();
    const getSourceRoot = jest.fn().mockResolvedValue(null);
    const { electron } = setupMainProcess({
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot },
      sourceRootService: { getSourceRoot }
    });

    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'SOURCE_NOT_FOUND',
        message: 'Source root not found',
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(getSourceRoot).toHaveBeenCalledWith(request.ref.sourceId);
    expect(resolveDirectoryLocatorV1).not.toHaveBeenCalled();
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });

  test.each([
    ['ENOENT', 'ENOENT', false],
    ['ENOTDIR', 'ENOTDIR', false],
    ['EACCES', 'EACCES', false],
    ['EPERM', 'EACCES', false],
    ['EIO', 'IO_ERROR', true]
  ])('maps %s without leaking a raw error', async (sourceCode, expectedCode, retryable) => {
    const error = Object.assign(new Error('scan failed'), { code: sourceCode });
    const request = createDirectoryLevelRequestV1();
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({
          ref: request.ref,
          absolutePath: '/photos',
          name: 'photos'
        })),
        scanDirectorySnapshot: jest.fn().mockRejectedValue(error)
      }
    });
    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);
    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: { code: expectedCode, message: 'scan failed', retryable }
    });
    expectValidV1Envelope(result);
    expect(result.error).not.toHaveProperty('stack');
  });

  test('preserves a service INVALID_RESPONSE without exposing internal validation details', async () => {
    const request = createDirectoryLevelRequestV1();
    const error = Object.assign(new Error('internal snapshot invariant details'), {
      code: 'INVALID_RESPONSE'
    });
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({
          ref: request.ref,
          absolutePath: '/photos',
          name: 'photos'
        })),
        scanDirectorySnapshot: jest.fn().mockRejectedValue(error)
      }
    });

    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Invalid directory response',
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(JSON.stringify(result)).not.toContain('internal snapshot invariant details');
  });

  test('sanitizes unknown service errors', async () => {
    const request = createDirectoryLevelRequestV1();
    const error = Object.assign(new Error('sensitive filesystem detail'), {
      code: 'UNEXPECTED_NATIVE_ERROR'
    });
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({
          ref: request.ref,
          absolutePath: '/photos',
          name: 'photos'
        })),
        scanDirectorySnapshot: jest.fn().mockRejectedValue(error)
      }
    });

    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Directory scan failed',
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(result.error).not.toHaveProperty('stack');
    expect(JSON.stringify(result)).not.toContain('sensitive filesystem detail');
  });

  test('keeps legacy SCAN_NAVIGATION_LEVEL isolated from V1', async () => {
    const legacyResponse = {
      success: true,
      nodes: [],
      directImages: [],
      metadata: { totalNodes: 0 }
    };
    const scanNavigationLevel = jest.fn().mockResolvedValue(legacyResponse);
    const scanDirectorySnapshot = jest.fn();
    const { electron } = setupMainProcess({
      fileSystemService: { scanNavigationLevel },
      directorySnapshotService: { scanDirectorySnapshot }
    });
    const handler = electron.ipcMain._handlers.get(CHANNELS.SCAN_NAVIGATION_LEVEL);
    const event = { sender: { isDestroyed: jest.fn(() => false), send: jest.fn() } };
    const result = await handler(event, '/legacy');
    expect(result).toBe(legacyResponse);
    expect(scanNavigationLevel).toHaveBeenCalledWith('/legacy', expect.objectContaining({
      concurrencyLimit: expect.any(Number),
      onProgress: expect.any(Function)
    }));
    expect(event.sender.send).toHaveBeenCalledWith(
      CHANNELS.SCAN_NAVIGATION_PROGRESS,
      expect.objectContaining({ done: true, targetPath: '/legacy' })
    );
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });
});
