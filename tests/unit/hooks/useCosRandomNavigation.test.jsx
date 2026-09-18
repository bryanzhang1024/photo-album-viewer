import { act, renderHook } from '@testing-library/react';
import useCosRandomNavigation from '../../../src/renderer/hooks/useCosRandomNavigation';
import CHANNELS from '../../../src/common/ipc-channels';

function setup(ids = ['a', 'b', 'c']) {
  const ipcRenderer = { invoke: jest.fn(async (channel, id) => {
    if (channel === CHANNELS.COS_LIST_RANDOM_SET_IDS) return ids;
    if (channel === CHANNELS.COS_GET_SET) return { id, displayName: id };
    return `/library/${id}`;
  }) };
  const props = { scope: { viewKind: 'sets', query: '' }, locationIdentity: '/cos/sets',
    currentSetId: null, available: true, ipcRenderer, onOpen: jest.fn(), onError: jest.fn() };
  const hook = renderHook(p => useCosRandomNavigation(p), { initialProps: props });
  return { ...hook, props, ipcRenderer };
}

async function draw(result) {
  await act(async () => { await result.current.handleRandomBrowse(); });
}

test('retains a round across locations and excludes the current set without resetting', async () => {
  const { result, rerender, props } = setup();
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    await draw(result);
    const id = props.onOpen.mock.calls[i][0].id;
    seen.push(id);
    rerender({ ...props, currentSetId: id, locationIdentity: `/cos/album?set=${id}` });
  }
  expect(new Set(seen).size).toBe(3);
  await draw(result);
  expect(props.onOpen.mock.calls[3][0].id).not.toBe(seen[2]);
});

test('skips unavailable paths and reports an empty pool', async () => {
  const { result, props, ipcRenderer } = setup(['a']);
  ipcRenderer.invoke.mockImplementation(async channel => channel === CHANNELS.COS_LIST_RANDOM_SET_IDS
    ? ['a'] : channel === CHANNELS.COS_GET_SET ? { id: 'a' } : null);
  await draw(result);
  expect(props.onOpen).not.toHaveBeenCalled();
  expect(props.onError).toHaveBeenCalledWith(expect.stringContaining('可打开'));
  expect(result.current.randomBrowseDisabled).toBe(true);
});

test('disables an exhausted singleton while viewing it', async () => {
  const { result, rerender, props } = setup(['a']);
  await draw(result);
  rerender({ ...props, currentSetId: 'a', locationIdentity: '/cos/album?set=a' });
  expect(result.current.randomBrowseDisabled).toBe(true);
});

test('does not navigate after changing scope during an asynchronous request', async () => {
  const { result, rerender, props, ipcRenderer } = setup();
  let finish;
  ipcRenderer.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending;
  act(() => { pending = result.current.handleRandomBrowse(); });
  rerender({ ...props, locationIdentity: '/cos/sets?q=other', scope: { viewKind: 'sets', query: 'other' } });
  await act(async () => { finish(['a']); await pending; });
  expect(props.onOpen).not.toHaveBeenCalled();
});

test('locks repeated clicks and discards results after refresh', async () => {
  const { result, props, ipcRenderer } = setup();
  let finish;
  ipcRenderer.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending;
  act(() => { pending = result.current.handleRandomBrowse(); });
  await draw(result);
  expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1);
  act(() => result.current.clearRandomState());
  await act(async () => { finish(['a']); await pending; });
  expect(props.onOpen).not.toHaveBeenCalled();
  await draw(result);
  expect(props.onOpen).toHaveBeenCalledTimes(1);
});

test('reports query errors and releases the loading state for retry', async () => {
  const { result, props, ipcRenderer } = setup();
  ipcRenderer.invoke.mockRejectedValueOnce(new Error('读取失败'));
  await draw(result);
  expect(props.onError).toHaveBeenCalledWith('读取失败');
  expect(result.current.randomBrowseLoading).toBe(false);
  await draw(result);
  expect(props.onOpen).toHaveBeenCalled();
});
