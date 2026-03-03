const { contextBridge, ipcRenderer } = require('electron');

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
    SCAN_DIRECTORY: 'scan-directory',
    GET_IMAGE_THUMBNAIL: 'get-image-thumbnail',
    GET_THUMBNAIL: 'get-thumbnail',
    GET_BATCH_THUMBNAILS: 'get-batch-thumbnails',
    GET_ALBUM_IMAGES: 'get-album-images',
    UPDATE_PERFORMANCE_SETTINGS: 'update-performance-settings',
    GET_CACHE_STATS: 'get-cache-stats',
    SAVE_FAVORITES: 'save-favorites',
    LOAD_FAVORITES: 'load-favorites',
    CLEAR_THUMBNAIL_CACHE: 'clear-thumbnail-cache',
    SHOW_IN_FOLDER: 'show-in-folder',
    COPY_IMAGE_TO_CLIPBOARD: 'copy-image-to-clipboard',
    CREATE_NEW_WINDOW: 'create-new-window',
    CREATE_NEW_INSTANCE: 'create-new-instance',
    GET_WINDOWS_INFO: 'get-windows-info',
    SCAN_DIRECTORY_TREE: 'scan-directory-tree',
    FAVORITES_UPDATED: 'favorites-updated'
  };
}

const INVOKE_CHANNELS = new Set([
  CHANNELS.SELECT_DIRECTORY,
  CHANNELS.SCAN_NAVIGATION_LEVEL,
  CHANNELS.SCAN_DIRECTORY,
  CHANNELS.GET_IMAGE_THUMBNAIL,
  CHANNELS.GET_THUMBNAIL,
  CHANNELS.GET_BATCH_THUMBNAILS,
  CHANNELS.GET_ALBUM_IMAGES,
  CHANNELS.UPDATE_PERFORMANCE_SETTINGS,
  CHANNELS.GET_CACHE_STATS,
  CHANNELS.SAVE_FAVORITES,
  CHANNELS.LOAD_FAVORITES,
  CHANNELS.CLEAR_THUMBNAIL_CACHE,
  CHANNELS.SHOW_IN_FOLDER,
  CHANNELS.COPY_IMAGE_TO_CLIPBOARD,
  CHANNELS.CREATE_NEW_WINDOW,
  CHANNELS.CREATE_NEW_INSTANCE,
  CHANNELS.GET_WINDOWS_INFO,
  CHANNELS.SCAN_DIRECTORY_TREE
]);

const LISTEN_CHANNELS = new Set([
  CHANNELS.FAVORITES_UPDATED
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
  // Reserved for future disk cache integration.
  saveToDiskCache() {
    return false;
  }
});
