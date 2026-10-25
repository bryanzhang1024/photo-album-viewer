/** @jest-environment node */

const mockExposeCalls = [];
const mockListeners = new Map();
let mockRemoved = [];

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: jest.fn((name, api) => { mockExposeCalls.push({ name, api }); })
  },
  ipcRenderer: {
    invoke: jest.fn(),
    send: jest.fn(),
    on: jest.fn((channel, listener) => {
      mockListeners.set(channel, listener);
    }),
    once: jest.fn((channel, listener) => {
      mockListeners.set(channel, listener);
    }),
    removeListener: jest.fn((channel, listener) => {
      mockRemoved.push({ channel, listener });
    })
  }
}));

require('../../src/main/preload');

const api = () => mockExposeCalls[0].api;

describe('preload 监听通道', () => {
  test('回调只收到主进程参数，不带 IPC 事件对象', () => {
    const received = [];
    const off = api().on('menu-command', (payload) => received.push(payload));
    const wrapped = mockListeners.get('menu-command');

    wrapped({ sender: { id: 1 } }, { command: 'view-list' });
    expect(received).toEqual([{ command: 'view-list' }]);
    expect(typeof off).toBe('function');

    off();
    expect(mockRemoved.at(-1).listener).toBe(wrapped);
  });

  test('未登记的通道仍然拒绝监听', () => {
    expect(() => api().on('unknown-channel', () => {})).toThrow(/Blocked IPC listen channel/);
  });
});
