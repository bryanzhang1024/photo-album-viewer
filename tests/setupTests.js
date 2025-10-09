import '@testing-library/jest-dom';

class LocalStorageMock {
  constructor() {
    this.store = new Map();
  }

  clear() {
    this.store.clear();
  }

  getItem(key) {
    return this.store.has(String(key)) ? this.store.get(String(key)) : null;
  }

  removeItem(key) {
    this.store.delete(String(key));
  }

  setItem(key, value) {
    this.store.set(String(key), String(value));
  }
}

const electronMock = {
  ipcRenderer: {
    invoke: jest.fn(() => Promise.resolve()),
    send: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn()
  },
  shell: {
    openPath: jest.fn(),
    openExternal: jest.fn()
  },
  clipboard: {
    writeText: jest.fn()
  },
  nativeImage: {
    createFromPath: jest.fn(() => ({
      toPNG: jest.fn(() => Buffer.from([]))
    }))
  },
  remote: {
    app: {
      getPath: jest.fn(() => '/tmp')
    },
    require: jest.fn(() => ({
      join: (...parts) => parts.join('/')
    }))
  }
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: new LocalStorageMock(),
    writable: true
  });

  window.electronAPI = {
    invoke: jest.fn(() => Promise.resolve()),
    send: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn()
  };

  window.require = jest.fn((moduleName) => {
    if (moduleName === 'electron') {
      return electronMock;
    }
    return {};
  });
}

global.electronMock = electronMock;
