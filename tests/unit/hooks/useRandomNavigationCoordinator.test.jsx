import { act, renderHook, waitFor } from '@testing-library/react';
import CHANNELS from '../../../src/common/ipc-channels';
import {
  createDirectoryErrorEnvelopeV1,
  createDirectorySuccessEnvelopeV1
} from '../../../src/common/contracts/directory-contract-v1';
import { useRandomNavigationCoordinator } from '../../../src/renderer/hooks/useRandomNavigationCoordinator';

const SOURCE_ID = 'src_AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const SECOND_SOURCE_ID = 'src_BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const OBSERVED_AT = 1783728000000;
const SOURCE = {
  schemaVersion: 1,
  sourceId: SOURCE_ID,
  label: 'Photos',
  rootPath: '/Volumes/Photos',
  sourceGeneration: 1
};
const SECOND_SOURCE = {
  ...SOURCE,
  sourceId: SECOND_SOURCE_ID,
  label: 'Archive',
  rootPath: '/Volumes/Archive'
};

function createDirectoryLocation(relativePath, viewMode = 'browse', sourceId = SOURCE_ID) {
  return {
    kind: 'directory',
    target: {
      sourceId,
      relativePath,
      viewMode,
      initialMediaRelativePath: null
    }
  };
}

function createChild(relativePath, viewMode = 'photoSet', sourceId = SOURCE_ID) {
  const name = relativePath.split('/').at(-1);
  const directMediaCount = viewMode === 'photoSet' ? 1 : 0;
  const childDirectoryCount = viewMode === 'browse' ? 1 : 0;
  return {
    ref: { sourceId, relativePath },
    name,
    status: 'ready',
    completeness: { directMedia: 'complete', children: 'complete' },
    facts: { directMediaCount, childDirectoryCount },
    approximate: {
      coverSamples: [],
      hasDescendantMedia: directMediaCount > 0 ? 'yes' : 'unknown',
      observedAt: OBSERVED_AT,
      truncated: childDirectoryCount > 0
    }
  };
}

function createSnapshot(relativePath, {
  children = [],
  viewMode = null,
  sourceId = SOURCE_ID,
  revision = `revision-${relativePath || 'root'}`
} = {}) {
  const name = relativePath.split('/').at(-1) || 'Photos';
  const directMedia = viewMode === 'photoSet'
    ? [{
      relativePath: `${relativePath ? `${relativePath}/` : ''}cover.jpg`,
      name: 'cover.jpg',
      size: 128,
      mtimeMs: OBSERVED_AT
    }]
    : [];
  const snapshotChildren = viewMode === 'browse'
    ? [createChild(`${relativePath ? `${relativePath}/` : ''}nested`, 'photoSet', sourceId)]
    : children;
  const directMediaCount = directMedia.length;
  const childDirectoryCount = snapshotChildren.length;

  return {
    contractVersion: 1,
    ref: { sourceId, relativePath },
    locator: {
      absolutePath: `${SOURCE.rootPath}${relativePath ? `/${relativePath}` : ''}`
    },
    name,
    status: 'ready',
    observedAt: OBSERVED_AT,
    revision,
    completeness: { entries: 'complete', directMedia: 'complete', children: 'complete' },
    facts: { directMediaCount, childDirectoryCount },
    directMedia,
    children: snapshotChildren,
    approximate: {
      coverSamples: [],
      hasDescendantMedia: directMediaCount > 0
        ? 'yes'
        : (childDirectoryCount === 0 ? 'no' : 'unknown'),
      observedAt: OBSERVED_AT,
      truncated: childDirectoryCount > 0
    }
  };
}

function createTab(id, relativePath = 'S', viewMode = 'browse', sourceId = SOURCE_ID) {
  return { id, location: createDirectoryLocation(relativePath, viewMode, sourceId) };
}

function createOptions(overrides = {}) {
  const activeTab = overrides.activeTab || createTab('tab-a');
  return {
    activeTab,
    activeTabId: activeTab.id,
    activeSourceRoot: SOURCE,
    tabs: [activeTab],
    commitTabLocation: jest.fn(),
    ipcRenderer: { invoke: jest.fn() },
    onError: jest.fn(),
    ...overrides
  };
}

function createSnapshotInvoke(snapshotForRef) {
  return jest.fn(async (channel, request) => {
    if (channel !== CHANNELS.GET_DIRECTORY_LEVEL_V1) {
      throw new Error(`Unexpected channel: ${channel}`);
    }
    const snapshot = snapshotForRef(request.ref.relativePath);
    if (!snapshot) throw new Error(`Missing snapshot for ${request.ref.relativePath}`);
    return createDirectorySuccessEnvelopeV1(snapshot);
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function draw(result) {
  let outcome;
  await act(async () => {
    outcome = await result.current.handleRandomBrowse();
  });
  return outcome;
}

describe('useRandomNavigationCoordinator normal draws', () => {
  let randomSpy;

  beforeEach(() => {
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  test('loads the canonical scope and validates a target before committing navigation', async () => {
    const parentSnapshot = createSnapshot('S', {
      children: [createChild('S/A'), createChild('S/B')]
    });
    const invoke = createSnapshotInvoke((relativePath) => {
      if (relativePath === 'S') return parentSnapshot;
      if (relativePath === 'S/A' || relativePath === 'S/B') {
        return createSnapshot(relativePath, { viewMode: 'photoSet' });
      }
      return null;
    });
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));

    expect(result.current).toMatchObject({
      available: true,
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
    await expect(draw(result)).resolves.toBe(true);

    expect(invoke).toHaveBeenNthCalledWith(1, CHANNELS.GET_DIRECTORY_LEVEL_V1, {
      contractVersion: 1,
      runtimeSource: { sourceId: SOURCE_ID, rootPath: SOURCE.rootPath },
      ref: { sourceId: SOURCE_ID, relativePath: 'S' }
    });
    expect(invoke).toHaveBeenNthCalledWith(2, CHANNELS.GET_DIRECTORY_LEVEL_V1, {
      contractVersion: 1,
      runtimeSource: { sourceId: SOURCE_ID, rootPath: SOURCE.rootPath },
      ref: { sourceId: SOURCE_ID, relativePath: 'S/A' }
    });
    expect(options.commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/A', 'photoSet')
    });
    expect(options.onError).not.toHaveBeenCalled();
  });

  test('keeps an independent no-replacement queue for each tab at the same scope', async () => {
    const tabA = createTab('tab-a');
    const tabB = createTab('tab-b');
    const invoke = createSnapshotInvoke((relativePath) => {
      if (relativePath === 'S') {
        return createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B'), createChild('S/C')]
        });
      }
      if (/^S\/[ABC]$/.test(relativePath)) {
        return createSnapshot(relativePath, { viewMode: 'photoSet' });
      }
      return null;
    });
    const commitTabLocation = jest.fn();
    const initialProps = createOptions({
      activeTab: tabA,
      activeTabId: tabA.id,
      tabs: [tabA, tabB],
      commitTabLocation,
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );

    expect(await draw(result)).toBe(true);
    rerender({ ...initialProps, activeTab: tabB, activeTabId: tabB.id });
    expect(await draw(result)).toBe(true);
    rerender({ ...initialProps, activeTab: tabA, activeTabId: tabA.id });
    expect(await draw(result)).toBe(true);

    expect(commitTabLocation.mock.calls.map(([call]) => [
      call.tabId,
      call.browserLocation.target.relativePath
    ])).toEqual([
      ['tab-a', 'S/A'],
      ['tab-b', 'S/A'],
      ['tab-a', 'S/B']
    ]);
    expect(invoke.mock.calls.filter(([, request]) => request.ref.relativePath === 'S'))
      .toHaveLength(2);
  });

  test('keeps at most eight recently used scopes per tab', async () => {
    const invoke = createSnapshotInvoke((relativePath) => {
      if (relativePath.endsWith('/A')) {
        return createSnapshot(relativePath, { viewMode: 'photoSet' });
      }
      return createSnapshot(relativePath, {
        children: [createChild(`${relativePath}/A`)]
      });
    });
    const tab = createTab('tab-a', 'S1');
    const initialProps = createOptions({
      activeTab: tab,
      tabs: [tab],
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );

    for (let index = 1; index <= 9; index += 1) {
      const nextTab = createTab('tab-a', `S${index}`);
      rerender({ ...initialProps, activeTab: nextTab, tabs: [nextTab] });
      expect(await draw(result)).toBe(true);
    }

    const firstScopeAgain = createTab('tab-a', 'S1');
    rerender({ ...initialProps, activeTab: firstScopeAgain, tabs: [firstScopeAgain] });
    expect(await draw(result)).toBe(true);

    expect(invoke.mock.calls.filter(([, request]) => request.ref.relativePath === 'S1'))
      .toHaveLength(2);
  });

  test('disables an empty scope until invalidation makes its pool unknown again', async () => {
    const invoke = createSnapshotInvoke((relativePath) => (
      relativePath === 'S' ? createSnapshot('S') : null
    ));
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));

    expect(result.current.randomBrowseDisabled).toBe(false);
    expect(await draw(result)).toBe(false);
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: true
    });
    expect(options.commitTabLocation).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);

    act(() => result.current.invalidateActiveScope());
    expect(result.current.randomBrowseDisabled).toBe(false);

    expect(await draw(result)).toBe(false);
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: true
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(options.commitTabLocation).not.toHaveBeenCalled();
  });

  test('disables a photoSet scope when its current album is the only target', async () => {
    const albumTab = createTab('tab-a', 'S/A', 'photoSet');
    const invoke = createSnapshotInvoke((relativePath) => (
      relativePath === 'S'
        ? createSnapshot('S', { children: [createChild('S/A')] })
        : null
    ));
    const options = createOptions({
      activeTab: albumTab,
      tabs: [albumTab],
      ipcRenderer: { invoke }
    });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));

    expect(await draw(result)).toBe(false);

    expect(result.current).toMatchObject({
      available: true,
      randomBrowseLoading: false,
      randomBrowseDisabled: true
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(options.commitTabLocation).not.toHaveBeenCalled();
  });
});

describe('useRandomNavigationCoordinator retries and async guards', () => {
  let randomSpy;

  beforeEach(() => {
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  function createRetryHarness(targetFailure) {
    let parentScanCount = 0;
    const invoke = jest.fn(async (channel, request) => {
      if (channel !== CHANNELS.GET_DIRECTORY_LEVEL_V1) {
        throw new Error(`Unexpected channel: ${channel}`);
      }
      const { relativePath } = request.ref;
      if (relativePath === 'S') {
        parentScanCount += 1;
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')],
          revision: `parent-${parentScanCount}`
        }));
      }
      if (relativePath === 'S/A') return targetFailure('S/A');
      if (relativePath === 'S/B') {
        return createDirectorySuccessEnvelopeV1(
          createSnapshot('S/B', { viewMode: 'photoSet' })
        );
      }
      throw new Error(`Missing response for ${relativePath}`);
    });
    const options = createOptions({ ipcRenderer: { invoke } });
    const hook = renderHook(() => useRandomNavigationCoordinator(options));
    return { ...hook, invoke, options, getParentScanCount: () => parentScanCount };
  }

  test('rescans the parent once after ENOENT and validates a different target', async () => {
    const harness = createRetryHarness(() => createDirectoryErrorEnvelopeV1(
      'ENOENT',
      'target disappeared',
      { retryable: true, details: { syscall: 'scandir' } }
    ));

    expect(await draw(harness.result)).toBe(true);

    expect(harness.getParentScanCount()).toBe(2);
    expect(harness.options.commitTabLocation).toHaveBeenCalledTimes(1);
    expect(harness.options.commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/B', 'photoSet')
    });
    expect(harness.invoke).toHaveBeenCalledTimes(4);
    expect(harness.options.onError).not.toHaveBeenCalled();
    expect(harness.result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
  });

  test('treats a target view change as recoverable and validates a different target', async () => {
    const harness = createRetryHarness(() => createDirectorySuccessEnvelopeV1(
      createSnapshot('S/A', { viewMode: 'browse' })
    ));

    expect(await draw(harness.result)).toBe(true);

    expect(harness.getParentScanCount()).toBe(2);
    expect(harness.options.commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/B', 'photoSet')
    });
    expect(harness.invoke).toHaveBeenCalledTimes(4);
    expect(harness.options.onError).not.toHaveBeenCalled();
    expect(harness.result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
  });

  test('rejects a malformed success envelope without a recoverable parent retry', async () => {
    let parentScans = 0;
    let targetValidations = 0;
    const invoke = jest.fn(async (_channel, request) => {
      const { relativePath } = request.ref;
      if (relativePath === 'S') {
        parentScans += 1;
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')]
        }));
      }
      targetValidations += 1;
      return {
        contractVersion: 1,
        ok: true,
        data: {
          status: 'ready',
          completeness: { directMedia: 'complete' },
          facts: { directMediaCount: 1 }
        }
      };
    });
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));

    expect(await draw(result)).toBe(false);

    expect(parentScans).toBe(1);
    expect(targetValidations).toBe(1);
    expect(options.commitTabLocation).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith('目录扫描返回无效数据');
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
  });

  test('stops after one parent rescan when both target validations are recoverable', async () => {
    let parentScanCount = 0;
    const attemptedTargets = [];
    const invoke = jest.fn(async (_channel, request) => {
      const { relativePath } = request.ref;
      if (relativePath === 'S') {
        parentScanCount += 1;
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')],
          revision: `parent-${parentScanCount}`
        }));
      }
      attemptedTargets.push(relativePath);
      if (attemptedTargets.length > 2) {
        return createDirectorySuccessEnvelopeV1(
          createSnapshot(relativePath, { viewMode: 'photoSet' })
        );
      }
      return createDirectoryErrorEnvelopeV1(
        attemptedTargets.length === 1 ? 'ENOENT' : 'ENOTDIR',
        'stale target',
        { retryable: true, details: { relativePath } }
      );
    });
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));

    expect(await draw(result)).toBe(false);

    expect(parentScanCount).toBe(2);
    expect(attemptedTargets).toEqual(['S/A', 'S/B']);
    expect(options.commitTabLocation).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });

    expect(await draw(result)).toBe(true);

    expect(parentScanCount).toBe(2);
    expect(attemptedTargets).toEqual(['S/A', 'S/B', 'S/A']);
    expect(options.commitTabLocation).toHaveBeenCalledTimes(1);
    expect(options.commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/A', 'photoSet')
    });
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
  });

  test.each(['EACCES', 'IO_ERROR'])(
    'does not rescan the parent after nonrecoverable %s',
    async (code) => {
      const harness = createRetryHarness(() => createDirectoryErrorEnvelopeV1(
        code,
        'target cannot be read',
        { retryable: true, details: { code } }
      ));

      expect(await draw(harness.result)).toBe(false);

      expect(harness.getParentScanCount()).toBe(1);
      expect(harness.invoke).toHaveBeenCalledTimes(2);
      expect(harness.options.commitTabLocation).not.toHaveBeenCalled();
      expect(harness.options.onError).toHaveBeenCalledWith('target cannot be read');
      expect(harness.result.current).toMatchObject({
        randomBrowseLoading: false,
        randomBrowseDisabled: false
      });
    }
  );

  test('does not consume the bag when the active tab changes during validation', async () => {
    const validation = createDeferred();
    const tabA = createTab('tab-a');
    const tabB = createTab('tab-b', 'T');
    let targetACalls = 0;
    const invoke = jest.fn(async (_channel, request) => {
      const { relativePath } = request.ref;
      if (relativePath === 'S') {
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')]
        }));
      }
      if (relativePath === 'S/A') {
        targetACalls += 1;
        if (targetACalls === 1) return validation.promise;
      }
      if (relativePath === 'S/A' || relativePath === 'S/B') {
        return createDirectorySuccessEnvelopeV1(
          createSnapshot(relativePath, { viewMode: 'photoSet' })
        );
      }
      throw new Error(`Missing response for ${relativePath}`);
    });
    const commitTabLocation = jest.fn();
    const initialProps = createOptions({
      activeTab: tabA,
      tabs: [tabA, tabB],
      commitTabLocation,
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );
    let pendingDraw;
    await act(async () => {
      pendingDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });
    await waitFor(() => expect(targetACalls).toBe(1));

    rerender({ ...initialProps, activeTab: tabB, activeTabId: tabB.id });
    await act(async () => {
      validation.resolve(createDirectorySuccessEnvelopeV1(
        createSnapshot('S/A', { viewMode: 'photoSet' })
      ));
      await expect(pendingDraw).resolves.toBe(false);
    });
    expect(commitTabLocation).not.toHaveBeenCalled();

    rerender({ ...initialProps, activeTab: tabA, activeTabId: tabA.id });
    expect(await draw(result)).toBe(true);
    expect(commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/A', 'photoSet')
    });
  });

  test('does not consume the bag when BrowserLocation changes during validation', async () => {
    const validation = createDeferred();
    const originalTab = createTab('tab-a');
    const movedTab = createTab('tab-a', 'T');
    let targetACalls = 0;
    const invoke = jest.fn(async (_channel, request) => {
      const { relativePath } = request.ref;
      if (relativePath === 'S') {
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')]
        }));
      }
      if (relativePath === 'S/A') {
        targetACalls += 1;
        if (targetACalls === 1) return validation.promise;
      }
      if (relativePath === 'S/A' || relativePath === 'S/B') {
        return createDirectorySuccessEnvelopeV1(
          createSnapshot(relativePath, { viewMode: 'photoSet' })
        );
      }
      throw new Error(`Missing response for ${relativePath}`);
    });
    const commitTabLocation = jest.fn();
    const initialProps = createOptions({
      activeTab: originalTab,
      tabs: [originalTab],
      commitTabLocation,
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );
    let pendingDraw;
    await act(async () => {
      pendingDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });
    await waitFor(() => expect(targetACalls).toBe(1));

    rerender({ ...initialProps, activeTab: movedTab, tabs: [movedTab] });
    await act(async () => {
      validation.resolve(createDirectorySuccessEnvelopeV1(
        createSnapshot('S/A', { viewMode: 'photoSet' })
      ));
      await expect(pendingDraw).resolves.toBe(false);
    });
    expect(commitTabLocation).not.toHaveBeenCalled();

    rerender({ ...initialProps, activeTab: originalTab, tabs: [originalTab] });
    expect(await draw(result)).toBe(true);
    expect(commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/A', 'photoSet')
    });
  });

  test('prevents concurrent draws from repeated clicks on the same tab', async () => {
    const parentScan = createDeferred();
    const invoke = jest.fn(async (_channel, request) => {
      if (request.ref.relativePath === 'S') return parentScan.promise;
      return createDirectorySuccessEnvelopeV1(
        createSnapshot(request.ref.relativePath, { viewMode: 'photoSet' })
      );
    });
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));
    let firstDraw;
    await act(async () => {
      firstDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });

    expect(result.current.randomBrowseLoading).toBe(true);
    expect(result.current.randomBrowseDisabled).toBe(true);
    await expect(draw(result)).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      parentScan.resolve(createDirectorySuccessEnvelopeV1(createSnapshot('S', {
        children: [createChild('S/A')]
      })));
      await expect(firstDraw).resolves.toBe(true);
    });
    expect(options.commitTabLocation).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
  });

  test('clearAllRandomState invalidates pending work without consuming its bag', async () => {
    const validation = createDeferred();
    let targetACalls = 0;
    let parentScans = 0;
    const invoke = jest.fn(async (_channel, request) => {
      const { relativePath } = request.ref;
      if (relativePath === 'S') {
        parentScans += 1;
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')]
        }));
      }
      if (relativePath === 'S/A') {
        targetACalls += 1;
        if (targetACalls === 1) return validation.promise;
      }
      return createDirectorySuccessEnvelopeV1(
        createSnapshot(relativePath, { viewMode: 'photoSet' })
      );
    });
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));
    let pendingDraw;
    await act(async () => {
      pendingDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });
    await waitFor(() => expect(targetACalls).toBe(1));

    act(() => result.current.clearAllRandomState());
    await act(async () => {
      validation.resolve(createDirectorySuccessEnvelopeV1(
        createSnapshot('S/A', { viewMode: 'photoSet' })
      ));
      await expect(pendingDraw).resolves.toBe(false);
    });
    expect(options.commitTabLocation).not.toHaveBeenCalled();

    expect(await draw(result)).toBe(true);
    expect(parentScans).toBe(2);
    expect(options.commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/A', 'photoSet')
    });
  });

  test.each([
    ['closed', (_tabA, tabB) => [tabB]],
    [
      'moved to another source',
      (tabA, tabB) => [
        createTab(tabA.id, 'T', 'browse', SECOND_SOURCE_ID),
        tabB
      ]
    ]
  ])('does not cancel tab B when unrelated tab A is %s', async (_label, mutateTabs) => {
    const validation = createDeferred();
    const tabA = createTab('tab-a', 'T');
    const tabB = createTab('tab-b', 'S');
    let parentScans = 0;
    let targetValidations = 0;
    const invoke = jest.fn(async (_channel, request) => {
      if (request.ref.relativePath === 'S') {
        parentScans += 1;
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')]
        }));
      }
      targetValidations += 1;
      return validation.promise;
    });
    const commitTabLocation = jest.fn();
    const initialProps = createOptions({
      activeTab: tabB,
      activeTabId: tabB.id,
      tabs: [tabA, tabB],
      commitTabLocation,
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );
    let pendingDraw;
    await act(async () => {
      pendingDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });
    await waitFor(() => expect(targetValidations).toBe(1));
    expect(result.current).toMatchObject({
      randomBrowseLoading: true,
      randomBrowseDisabled: true
    });

    rerender({ ...initialProps, tabs: mutateTabs(tabA, tabB) });
    expect(result.current.randomBrowseLoading).toBe(true);

    await act(async () => {
      validation.resolve(createDirectorySuccessEnvelopeV1(
        createSnapshot('S/A', { viewMode: 'photoSet' })
      ));
      await expect(pendingDraw).resolves.toBe(true);
    });

    expect(parentScans).toBe(1);
    expect(targetValidations).toBe(1);
    expect(commitTabLocation).toHaveBeenCalledTimes(1);
    expect(commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-b',
      browserLocation: createDirectoryLocation('S/A', 'photoSet')
    });
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
  });

  test('clears the old loading owner when the same tab changes source', async () => {
    const validation = createDeferred();
    const originalTab = createTab('tab-a', 'S');
    let targetValidations = 0;
    const invoke = jest.fn(async (_channel, request) => {
      if (request.ref.relativePath === 'S') {
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A')]
        }));
      }
      targetValidations += 1;
      return validation.promise;
    });
    const commitTabLocation = jest.fn();
    const initialProps = createOptions({
      activeTab: originalTab,
      tabs: [originalTab],
      commitTabLocation,
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );
    let pendingDraw;
    await act(async () => {
      pendingDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });
    await waitFor(() => expect(targetValidations).toBe(1));
    expect(result.current.randomBrowseLoading).toBe(true);

    const replacementTab = createTab('tab-a', 'S', 'browse', SECOND_SOURCE_ID);
    rerender({
      ...initialProps,
      activeTab: replacementTab,
      activeSourceRoot: SECOND_SOURCE,
      tabs: [replacementTab]
    });
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });

    await act(async () => {
      validation.resolve(createDirectorySuccessEnvelopeV1(
        createSnapshot('S/A', { viewMode: 'photoSet' })
      ));
      await expect(pendingDraw).resolves.toBe(false);
    });
    expect(commitTabLocation).not.toHaveBeenCalled();
    expect(result.current.randomBrowseLoading).toBe(false);
  });

  test('keeps a newer same-tab loading owner when an invalidated request finishes', async () => {
    const firstValidation = createDeferred();
    const secondValidation = createDeferred();
    let parentScans = 0;
    let targetValidations = 0;
    const invoke = jest.fn(async (_channel, request) => {
      if (request.ref.relativePath === 'S') {
        parentScans += 1;
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          children: [createChild('S/A'), createChild('S/B')]
        }));
      }
      targetValidations += 1;
      return targetValidations === 1
        ? firstValidation.promise
        : secondValidation.promise;
    });
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));
    let firstDraw;
    await act(async () => {
      firstDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });
    await waitFor(() => expect(targetValidations).toBe(1));
    expect(result.current.randomBrowseLoading).toBe(true);

    act(() => result.current.clearAllRandomState());
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });

    let secondDraw;
    await act(async () => {
      secondDraw = result.current.handleRandomBrowse();
      await Promise.resolve();
    });
    await waitFor(() => expect(targetValidations).toBe(2));
    expect(parentScans).toBe(2);
    expect(result.current).toMatchObject({
      randomBrowseLoading: true,
      randomBrowseDisabled: true
    });

    await act(async () => {
      firstValidation.resolve(createDirectorySuccessEnvelopeV1(
        createSnapshot('S/A', { viewMode: 'photoSet' })
      ));
      await expect(firstDraw).resolves.toBe(false);
    });
    expect(options.commitTabLocation).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      randomBrowseLoading: true,
      randomBrowseDisabled: true
    });

    await act(async () => {
      secondValidation.resolve(createDirectorySuccessEnvelopeV1(
        createSnapshot('S/A', { viewMode: 'photoSet' })
      ));
      await expect(secondDraw).resolves.toBe(true);
    });
    expect(parentScans).toBe(2);
    expect(targetValidations).toBe(2);
    expect(options.commitTabLocation).toHaveBeenCalledTimes(1);
    expect(options.commitTabLocation).toHaveBeenCalledWith({
      tabId: 'tab-a',
      browserLocation: createDirectoryLocation('S/A', 'photoSet')
    });
    expect(result.current).toMatchObject({
      randomBrowseLoading: false,
      randomBrowseDisabled: false
    });
  });
});

describe('useRandomNavigationCoordinator cache lifecycle', () => {
  let randomSpy;

  beforeEach(() => {
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  function createLifecycleInvoke() {
    return jest.fn(async (_channel, request) => {
      const { sourceId, relativePath } = request.ref;
      if (relativePath === 'S') {
        return createDirectorySuccessEnvelopeV1(createSnapshot('S', {
          sourceId,
          children: [
            createChild('S/A', 'photoSet', sourceId),
            createChild('S/B', 'photoSet', sourceId)
          ]
        }));
      }
      return createDirectorySuccessEnvelopeV1(createSnapshot(relativePath, {
        sourceId,
        viewMode: 'photoSet'
      }));
    });
  }

  test('invalidates only cached targets and preserves the remaining bag for an identical signature', async () => {
    const invoke = createLifecycleInvoke();
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));

    expect(await draw(result)).toBe(true);
    act(() => result.current.invalidateActiveScope());
    expect(await draw(result)).toBe(true);

    expect(options.commitTabLocation.mock.calls.map(([call]) => (
      call.browserLocation.target.relativePath
    ))).toEqual(['S/A', 'S/B']);
    expect(invoke.mock.calls.filter(([, request]) => request.ref.relativePath === 'S'))
      .toHaveLength(2);
  });

  test('clears a tab store when its source identity is replaced', async () => {
    const invoke = createLifecycleInvoke();
    const firstTab = createTab('tab-a');
    const initialProps = createOptions({
      activeTab: firstTab,
      tabs: [firstTab],
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );

    expect(await draw(result)).toBe(true);
    const replacementTab = createTab('tab-a', 'S', 'browse', SECOND_SOURCE_ID);
    rerender({
      ...initialProps,
      activeTab: replacementTab,
      activeSourceRoot: SECOND_SOURCE,
      tabs: [replacementTab]
    });
    rerender({ ...initialProps, activeTab: firstTab, tabs: [firstTab] });
    expect(await draw(result)).toBe(true);

    expect(initialProps.commitTabLocation.mock.calls.map(([call]) => (
      call.browserLocation.target.relativePath
    ))).toEqual(['S/A', 'S/A']);
    expect(invoke.mock.calls.filter(([, request]) => (
      request.runtimeSource.sourceId === SOURCE_ID && request.ref.relativePath === 'S'
    ))).toHaveLength(2);
  });

  test('removes a closed tab store before the same id is reintroduced', async () => {
    const invoke = createLifecycleInvoke();
    const tabA = createTab('tab-a');
    const tabB = createTab('tab-b', 'T');
    const initialProps = createOptions({
      activeTab: tabA,
      tabs: [tabA, tabB],
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );

    expect(await draw(result)).toBe(true);
    rerender({ ...initialProps, activeTab: tabB, activeTabId: tabB.id, tabs: [tabB] });
    rerender({ ...initialProps, activeTab: tabA, activeTabId: tabA.id, tabs: [tabA, tabB] });
    expect(await draw(result)).toBe(true);

    expect(initialProps.commitTabLocation.mock.calls.map(([call]) => (
      call.browserLocation.target.relativePath
    ))).toEqual(['S/A', 'S/A']);
    expect(invoke.mock.calls.filter(([, request]) => request.ref.relativePath === 'S'))
      .toHaveLength(2);
  });

  test('preserves a tab store across browse and photoSet views within the same source', async () => {
    const invoke = createLifecycleInvoke();
    const browseTab = createTab('tab-a');
    const initialProps = createOptions({
      activeTab: browseTab,
      tabs: [browseTab],
      ipcRenderer: { invoke }
    });
    const { result, rerender } = renderHook(
      (props) => useRandomNavigationCoordinator(props),
      { initialProps }
    );

    expect(await draw(result)).toBe(true);
    const photoTab = createTab('tab-a', 'S/A', 'photoSet');
    rerender({ ...initialProps, activeTab: photoTab, tabs: [photoTab] });
    expect(await draw(result)).toBe(true);

    expect(initialProps.commitTabLocation.mock.calls.map(([call]) => (
      call.browserLocation.target.relativePath
    ))).toEqual(['S/A', 'S/B']);
    expect(invoke.mock.calls.filter(([, request]) => request.ref.relativePath === 'S'))
      .toHaveLength(1);
  });

  test('clearAllRandomState removes every cached tab scope', async () => {
    const invoke = createLifecycleInvoke();
    const options = createOptions({ ipcRenderer: { invoke } });
    const { result } = renderHook(() => useRandomNavigationCoordinator(options));

    expect(await draw(result)).toBe(true);
    act(() => result.current.clearAllRandomState());
    expect(await draw(result)).toBe(true);

    expect(options.commitTabLocation.mock.calls.map(([call]) => (
      call.browserLocation.target.relativePath
    ))).toEqual(['S/A', 'S/A']);
    expect(invoke.mock.calls.filter(([, request]) => request.ref.relativePath === 'S'))
      .toHaveLength(2);
  });
});
