/** @jest-environment node */

const CHANNELS = require('../../src/common/ipc-channels');
const { registerCosLibraryIpcHandlers } = require('../../src/main/services/CosLibraryIpc');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: jest.fn((channel, handler) => handlers.set(channel, handler))
  };
}

describe('CosLibraryIpc', () => {
  test('registers read-only query handlers and resolves thumbnails by media id', async () => {
    const ipcMain = createIpcMain();
    const service = {
      initialize: jest.fn().mockResolvedValue(),
      getStatus: jest.fn(() => ({ state: 'ready' })),
      listCharacters: jest.fn(() => ({ items: [], total: 0 })),
      listLooks: jest.fn(() => ({ items: [], total: 0 })),
      listCosers: jest.fn(() => ({ items: [], total: 0 })),
      listSets: jest.fn(() => ({ items: [], total: 0 })),
      getSet: jest.fn(() => null),
      resolveMediaPath: jest.fn(() => '/library/set/01.jpg')
    };
    const thumbnailService = { generateThumbnail: jest.fn().mockResolvedValue('thumbnail-protocol://cover.webp') };

    registerCosLibraryIpcHandlers({
      ipcMain,
      service,
      dialog: { showOpenDialog: jest.fn() },
      shell: { showItemInFolder: jest.fn() },
      thumbnailService,
      registerApprovedRoot: jest.fn(),
      getMainWindow: jest.fn(),
      openPictureView: jest.fn()
    });

    const characters = await ipcMain.handlers.get(CHANNELS.COS_LIST_CHARACTERS)(null, { query: '初音' });
    const thumbnail = await ipcMain.handlers.get(CHANNELS.COS_GET_MEDIA_THUMBNAIL)(null, 'media:one');

    expect(characters).toEqual({ items: [], total: 0 });
    expect(service.listCharacters).toHaveBeenCalledWith({ query: '初音' });
    expect(service.resolveMediaPath).toHaveBeenCalledWith('media:one');
    expect(thumbnailService.generateThumbnail).toHaveBeenCalledWith('/library/set/01.jpg', 600, 900);
    expect(thumbnail).toBe('thumbnail-protocol://cover.webp');
  });

  test('selects roots in the main process and reports refresh progress', async () => {
    const ipcMain = createIpcMain();
    const sender = { isDestroyed: jest.fn(() => false), send: jest.fn() };
    const service = {
      initialize: jest.fn().mockResolvedValue(),
      addRoot: jest.fn(async (_rootPath, { onProgress }) => {
        onProgress({ processed: 1, total: 2 });
        return { state: 'ready' };
      }),
      refresh: jest.fn(async ({ onProgress }) => {
        onProgress({ processed: 1, total: 2 });
        return { state: 'ready', ok: true };
      })
    };
    const registerApprovedRoot = jest.fn().mockResolvedValue(true);

    registerCosLibraryIpcHandlers({
      ipcMain,
      service,
      dialog: { showOpenDialog: jest.fn().mockResolvedValue({ canceled: false, filePaths: ['/library'] }) },
      shell: { showItemInFolder: jest.fn() },
      thumbnailService: { generateThumbnail: jest.fn() },
      registerApprovedRoot,
      getMainWindow: jest.fn(),
      openPictureView: jest.fn()
    });

    await expect(ipcMain.handlers.get(CHANNELS.COS_SELECT_ROOT)({ sender })).resolves.toEqual({ state: 'ready' });
    expect(registerApprovedRoot).toHaveBeenCalledWith('/library');
    expect(service.addRoot).toHaveBeenCalledWith('/library', { onProgress: expect.any(Function) });
    expect(sender.send).toHaveBeenCalledWith(CHANNELS.COS_INDEX_PROGRESS, { processed: 1, total: 2 });

    sender.send.mockClear();
    await ipcMain.handlers.get(CHANNELS.COS_REFRESH)({ sender });
    expect(sender.send).toHaveBeenCalledWith(CHANNELS.COS_INDEX_PROGRESS, { processed: 1, total: 2 });
  });

  test('opens the first set image in PictureView and keeps Finder as a separate action', async () => {
    const ipcMain = createIpcMain();
    const openPictureView = jest.fn().mockResolvedValue();
    const shell = { showItemInFolder: jest.fn() };
    const service = {
      initialize: jest.fn().mockResolvedValue(),
      listSetMedia: jest.fn(() => ({ items: [{ id: 'media:first' }] })),
      resolveMediaPath: jest.fn(() => '/library/set/01.jpg'),
      resolveSetAlbumPath: jest.fn(() => '/library/set')
    };

    registerCosLibraryIpcHandlers({
      ipcMain,
      service,
      dialog: { showOpenDialog: jest.fn() },
      shell,
      thumbnailService: { generateThumbnail: jest.fn() },
      registerApprovedRoot: jest.fn(),
      getMainWindow: jest.fn(),
      openPictureView
    });

    await expect(ipcMain.handlers.get(CHANNELS.COS_OPEN_IN_PICTUREVIEW)(null, 'set-one'))
      .resolves.toEqual({ success: true });
    expect(openPictureView).toHaveBeenCalledWith('/library/set/01.jpg');

    await expect(ipcMain.handlers.get(CHANNELS.COS_SHOW_SET_IN_FOLDER)(null, 'set-one'))
      .resolves.toEqual({ success: true });
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/library/set');
  });
});
