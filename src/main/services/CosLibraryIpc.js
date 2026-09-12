const { execFile } = require('child_process');
const CHANNELS = require('../../common/ipc-channels');

function openPictureViewWithSystem(imagePath) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', 'PictureView', imagePath], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function registerCosLibraryIpcHandlers({
  ipcMain,
  service,
  dialog,
  shell,
  thumbnailService,
  registerApprovedRoot,
  getMainWindow,
  openPictureView = openPictureViewWithSystem,
  thumbnailResolution = () => 600
}) {
  const withService = (handler) => async (...args) => {
    // initialize() returns a full status summary even when already ready.
    // Repeating that work per cover blocks the main thread and delays image responses.
    if (!service.initialized || service.initializing) await service.initialize();
    return handler(...args);
  };
  const progressSender = (event) => (payload) => {
    if (!event?.sender?.isDestroyed?.()) {
      event?.sender?.send?.(CHANNELS.COS_INDEX_PROGRESS, payload);
    }
  };

  ipcMain.handle(CHANNELS.COS_GET_STATUS, withService(async () => service.getStatus()));

  ipcMain.handle(CHANNELS.COS_SELECT_ROOT, withService(async (event) => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: '选择 Cos 套图库根目录',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) return service.getStatus();
    const rootPath = result.filePaths[0];
    const approved = await registerApprovedRoot(rootPath);
    if (!approved) throw new Error('无法授权访问所选 Cos 图库目录');
    const sendProgress = progressSender(event);
    const status = await service.addRoot(rootPath, { onProgress: sendProgress });
    sendProgress({ done: true });
    return status;
  }));

  ipcMain.handle(CHANNELS.COS_REMOVE_ROOT, withService(async (_event, rootId) => (
    service.removeRoot(rootId)
  )));

  ipcMain.handle(CHANNELS.COS_REFRESH, withService(async (event) => {
    const sendProgress = progressSender(event);
    const result = await service.refresh({ onProgress: sendProgress });
    sendProgress({ done: true });
    return result;
  }));

  ipcMain.handle(CHANNELS.COS_LIST_CHARACTERS, withService(async (_event, options) => (
    service.listCharacters(options)
  )));
  ipcMain.handle(CHANNELS.COS_LIST_LOOKS, withService(async (_event, options) => (
    service.listLooks(options)
  )));
  ipcMain.handle(CHANNELS.COS_LIST_COSERS, withService(async (_event, options) => (
    service.listCosers(options)
  )));
  ipcMain.handle(CHANNELS.COS_LIST_SETS, withService(async (_event, options) => (
    service.listSets(options)
  )));
  ipcMain.handle(CHANNELS.COS_GET_SET_IMAGES, withService(async (_event, setId, options) => service.getSetImagesPage(setId, options)));
  ipcMain.handle(CHANNELS.COS_GET_SET, withService(async (_event, setId) => service.getSet(setId)));
  ipcMain.handle(CHANNELS.COS_GET_SET_ALBUM_PATH, withService(async (_event, setId) => (
    service.resolveSetAlbumPath(setId)
  )));

  ipcMain.handle(CHANNELS.COS_GET_MEDIA_THUMBNAIL, withService(async (_event, mediaId) => {
    const imagePath = service.resolveMediaPath(mediaId);
    if (!imagePath) return null;
    const width = Number(thumbnailResolution()) || 600;
    return thumbnailService.generateThumbnail(imagePath, width, width * 1.5);
  }));

  ipcMain.handle(CHANNELS.COS_SHOW_SET_IN_FOLDER, withService(async (_event, setId) => {
    const albumPath = await service.resolveSetAlbumPath(setId);
    if (!albumPath) return { success: false, error: '套图所在磁盘当前不可用' };
    shell.showItemInFolder(albumPath);
    return { success: true };
  }));

  ipcMain.handle(CHANNELS.COS_OPEN_IN_PICTUREVIEW, withService(async (_event, setId) => {
    await service.resolveSetAlbumPath?.(setId);
    const firstMedia = service.listSetMedia(setId, { offset: 0, limit: 1 }).items[0];
    const imagePath = firstMedia ? service.resolveMediaPath(firstMedia.id) : null;
    if (!imagePath) return { success: false, error: '套图没有可打开的在线图片' };
    try {
      await openPictureView(imagePath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `无法打开 PictureView：${error?.message || error}`
      };
    }
  }));
}

module.exports = {
  registerCosLibraryIpcHandlers,
  openPictureViewWithSystem
};
