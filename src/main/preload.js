const { contextBridge, ipcRenderer, webUtils } = require('electron');

let crypto = null;
try {
  crypto = require('crypto');
} catch (error) {
  // Keep preload alive even when crypto is unavailable.
}

let CHANNELS;
try {
  CHANNELS = require('../common/ipc-channels');
} catch (error) {
  // Fallback to literal channel names to avoid preload hard failure.
  CHANNELS = {
    SELECT_DIRECTORY: 'select-directory',
    SCAN_NAVIGATION_LEVEL: 'scan-navigation-level',
    GET_DIRECTORY_LEVEL_V1: 'get-directory-level-v1',
    LOAD_SOURCE_ROOTS_V1: 'load-source-roots-v1',
    SAVE_SOURCE_ROOT_V1: 'save-source-root-v1',
    VALIDATE_NAVIGATION_TARGET_V1: 'validate-navigation-target-v1',
    RESOLVE_DROPPED_FOLDERS: 'resolve-dropped-folders',
    GET_IMAGE_THUMBNAIL: 'get-image-thumbnail',
    GET_THUMBNAIL: 'get-thumbnail',
    GET_BATCH_THUMBNAILS: 'get-batch-thumbnails',
    GET_ALBUM_IMAGES: 'get-album-images',
    GET_ALBUM_IMAGE_COUNT: 'get-album-image-count',
    UPDATE_PERFORMANCE_SETTINGS: 'update-performance-settings',
    GET_CACHE_STATS: 'get-cache-stats',
    SAVE_FAVORITES: 'save-favorites',
    LOAD_FAVORITES: 'load-favorites',
    CLEAR_THUMBNAIL_CACHE: 'clear-thumbnail-cache',
    SHOW_IN_FOLDER: 'show-in-folder',
    COPY_IMAGE_TO_CLIPBOARD: 'copy-image-to-clipboard',
    TRASH_IMAGE: 'trash-image',
    CREATE_NEW_WINDOW: 'create-new-window',
    CREATE_NEW_INSTANCE: 'create-new-instance',
    GET_WINDOWS_INFO: 'get-windows-info',
    SCAN_DIRECTORY_TREE: 'scan-directory-tree',
    SCAN_NAVIGATION_PROGRESS: 'scan-navigation-progress',
    FAVORITES_UPDATED: 'favorites-updated',
    COS_GET_STATUS: 'cos-get-status',
    COS_SELECT_ROOT: 'cos-select-root',
    COS_REMOVE_ROOT: 'cos-remove-root',
    COS_REFRESH: 'cos-refresh',
    COS_LIST_CHARACTERS: 'cos-list-characters',
    COS_LIST_LOOKS: 'cos-list-looks',
    COS_LIST_COSERS: 'cos-list-cosers',
    COS_LIST_SETS: 'cos-list-sets',
    COS_GET_SET: 'cos-get-set',
    COS_GET_SET_IMAGES: 'cos-get-set-images',
    COS_GET_SET_ALBUM_PATH: 'cos-get-set-album-path',
    COS_GET_MEDIA_THUMBNAIL: 'cos-get-media-thumbnail',
    COS_SHOW_SET_IN_FOLDER: 'cos-show-set-in-folder',
    COS_OPEN_IN_PICTUREVIEW: 'cos-open-in-pictureview',
    COS_INDEX_PROGRESS: 'cos-index-progress'
  };
}

const INVOKE_CHANNELS = new Set([
  CHANNELS.SELECT_DIRECTORY,
  CHANNELS.SCAN_NAVIGATION_LEVEL,
  CHANNELS.GET_DIRECTORY_LEVEL_V1,
  CHANNELS.LOAD_SOURCE_ROOTS_V1,
  CHANNELS.SAVE_SOURCE_ROOT_V1,
  CHANNELS.VALIDATE_NAVIGATION_TARGET_V1,
  CHANNELS.RESOLVE_DROPPED_FOLDERS,
  CHANNELS.GET_IMAGE_THUMBNAIL,
  CHANNELS.GET_THUMBNAIL,
  CHANNELS.GET_BATCH_THUMBNAILS,
  CHANNELS.GET_ALBUM_IMAGES,
  CHANNELS.GET_ALBUM_IMAGE_COUNT,
  CHANNELS.GET_ALBUM_IMAGE_COUNT,
  CHANNELS.UPDATE_PERFORMANCE_SETTINGS,
  CHANNELS.GET_CACHE_STATS,
  CHANNELS.SAVE_FAVORITES,
  CHANNELS.LOAD_FAVORITES,
  CHANNELS.CLEAR_THUMBNAIL_CACHE,
  CHANNELS.SHOW_IN_FOLDER,
  CHANNELS.COPY_IMAGE_TO_CLIPBOARD,
  CHANNELS.TRASH_IMAGE,
  CHANNELS.CREATE_NEW_WINDOW,
  CHANNELS.CREATE_NEW_INSTANCE,
  CHANNELS.GET_WINDOWS_INFO,
  CHANNELS.SCAN_DIRECTORY_TREE,
  CHANNELS.COS_GET_STATUS,
  CHANNELS.COS_SELECT_ROOT,
  CHANNELS.COS_REMOVE_ROOT,
  CHANNELS.COS_REFRESH,
  CHANNELS.COS_LIST_CHARACTERS,
  CHANNELS.COS_LIST_LOOKS,
  CHANNELS.COS_LIST_COSERS,
  CHANNELS.COS_LIST_SETS,
  CHANNELS.COS_GET_SET,
  CHANNELS.COS_GET_SET_IMAGES,
  CHANNELS.COS_GET_SET_ALBUM_PATH,
  CHANNELS.COS_GET_MEDIA_THUMBNAIL,
  CHANNELS.COS_SHOW_SET_IN_FOLDER,
  CHANNELS.COS_OPEN_IN_PICTUREVIEW
]);

const LISTEN_CHANNELS = new Set([
  CHANNELS.FAVORITES_UPDATED,
  CHANNELS.SCAN_NAVIGATION_PROGRESS,
  CHANNELS.COS_INDEX_PROGRESS
]);

function ensureInvokeChannel(channel) {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC invoke channel: ${channel}`);
  }
}

function ensureListenChannel(channel) {
  if (!LISTEN_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC listen channel: ${channel}`);
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  invoke(channel, ...args) {
    ensureInvokeChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, ...args) {
    ensureListenChannel(channel);
    ipcRenderer.send(channel, ...args);
  },
  on(channel, listener) {
    ensureListenChannel(channel);
    if (typeof listener !== 'function') {
      throw new Error('IPC listener must be a function');
    }
    ipcRenderer.on(channel, listener);
  },
  once(channel, listener) {
    ensureListenChannel(channel);
    if (typeof listener !== 'function') {
      throw new Error('IPC listener must be a function');
    }
    ipcRenderer.once(channel, listener);
  },
  removeListener(channel, listener) {
    ensureListenChannel(channel);
    if (typeof listener !== 'function') {
      return;
    }
    ipcRenderer.removeListener(channel, listener);
  },
  getThumbnailUrl(imagePath, resolution = 600) {
    if (!imagePath || typeof imagePath !== 'string') {
      return null;
    }

    const width = Number(resolution);
    if (!Number.isFinite(width) || width <= 0) {
      return null;
    }

    const height = width * 1.5;
    if (!crypto) {
      // Non-empty placeholder keeps renderer fallback path working.
      return `thumbnail-protocol://fallback-${encodeURIComponent(imagePath)}-${width}.webp`;
    }
    const hash = crypto.createHash('md5').update(imagePath + width + height).digest('hex');
    return `thumbnail-protocol://${hash}.webp`;
  },
  getLocalImageUrl(imagePath) {
    if (!imagePath || typeof imagePath !== 'string') {
      return null;
    }
    return `local-image-protocol://${encodeURIComponent(imagePath)}`;
  },
  getPathForFile(file) {
    if (!file || !webUtils?.getPathForFile) {
      return '';
    }
    return webUtils.getPathForFile(file);
  },
  // Reserved for future disk cache integration.
  saveToDiskCache() {
    return false;
  }
});
