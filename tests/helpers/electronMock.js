const createBrowserWindowStub = () => {
  const eventHandlers = new Map();

  const stub = {
    id: Math.floor(Math.random() * 1000),
    loadURL: jest.fn(),
    show: jest.fn(),
    focus: jest.fn(),
    setAlwaysOnTop: jest.fn(),
    maximize: jest.fn(),
    restore: jest.fn(),
    isVisible: jest.fn(() => true),
    webContents: {
      send: jest.fn(),
      isDestroyed: jest.fn(() => false),
      openDevTools: jest.fn(),
      once: jest.fn((event, handler) => {
        eventHandlers.set(`webContents:${event}`, handler);
      }),
      on: jest.fn((event, handler) => {
        eventHandlers.set(`webContents:${event}`, handler);
      })
    },
    once: jest.fn((event, handler) => {
      eventHandlers.set(event, handler);
    }),
    on: jest.fn((event, handler) => {
      eventHandlers.set(event, handler);
    }),
    emit: (event, ...args) => {
      const handler = eventHandlers.get(event);
      if (handler) handler(...args);
    },
    webEmit: (event, ...args) => {
      const handler = eventHandlers.get(`webContents:${event}`);
      if (handler) handler(...args);
    },
    close: jest.fn()
  };

  return stub;
};

const createAppStub = () => {
  const listeners = {};
  return {
    getPath: jest.fn(() => '/mock/userData'),
    isReady: jest.fn(() => true),
    whenReady: jest.fn(() => Promise.resolve()),
    on: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    emit: (event, ...args) => {
      if (listeners[event]) listeners[event](...args);
    },
    quit: jest.fn(),
    focus: jest.fn(),
    dock: {
      show: jest.fn(),
      bounce: jest.fn()
    }
  };
};

const createIpcMainStub = () => {
  const handlers = new Map();
  return {
    handle: jest.fn((channel, handler) => {
      handlers.set(channel, handler);
    }),
    invoke: (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler for channel ${channel}`);
      }
      return handler({}, ...args);
    },
    _handlers: handlers
  };
};

const createElectronMocks = () => {
  const app = createAppStub();
  const BrowserWindow = jest.fn(() => createBrowserWindowStub());
  const ipcMain = createIpcMainStub();

  BrowserWindow._instances = [];
  BrowserWindow.mockImplementation(() => {
    const instance = createBrowserWindowStub();
    BrowserWindow._instances.push(instance);
    return instance;
  });

  BrowserWindow.getAllWindows = jest.fn(() => BrowserWindow._instances);
  BrowserWindow.fromId = jest.fn((id) =>
    BrowserWindow._instances.find((instance) => instance.id === id) || null
  );

  return {
    app,
    BrowserWindow,
    ipcMain,
    nativeImage: {
      createThumbnailFromPath: jest.fn(),
      createFromPath: jest.fn()
    },
    __resetWindows: () => (BrowserWindow._instances = [])
  };
};

module.exports = {
  createBrowserWindowStub,
  createAppStub,
  createIpcMainStub,
  createElectronMocks
};
