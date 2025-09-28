const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const FAVORITES_FILE_PATH = path.join(app.getPath('userData'), 'favorites.json');
let favoritesWatcher = null;

async function loadFavoritesInternal() {
    try {
        await stat(FAVORITES_FILE_PATH);
    } catch (err) {
        const defaultData = { albums: [], images: [], collections: [], version: 1, lastModified: Date.now() };
        await writeFile(FAVORITES_FILE_PATH, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    const data = await readFile(FAVORITES_FILE_PATH, 'utf8');
    return JSON.parse(data);
}

function startFavoritesWatcher() {
    try {
        if (favoritesWatcher) {
            favoritesWatcher.close();
        }
        favoritesWatcher = fs.watch(FAVORITES_FILE_PATH, (eventType, filename) => {
            if (eventType === 'change') {
                setTimeout(async () => {
                    try {
                        const favoritesData = await loadFavoritesInternal();
                        BrowserWindow.getAllWindows().forEach(window => {
                            if (window.webContents && !window.webContents.isDestroyed()) {
                                window.webContents.send('favorites-updated', favoritesData);
                            }
                        });
                    } catch (error) {
                        console.error('文件监听处理失败:', error);
                    }
                }, 100);
            }
        });
    } catch (error) {
        console.error('启动文件监听失败:', error);
    }
}

function stopFavoritesWatcher() {
    if (favoritesWatcher) {
        favoritesWatcher.close();
        favoritesWatcher = null;
    }
}

function registerIpcHandlers() {
    ipcMain.handle('load-favorites', async () => {
        return await loadFavoritesInternal();
    });

    ipcMain.handle('save-favorites', async (event, favoritesData, expectedVersion) => {
        try {
            const currentData = await loadFavoritesInternal();
            if (expectedVersion !== undefined && currentData.version !== expectedVersion) {
                return { success: false, error: '版本冲突，请刷新后重试', currentVersion: currentData.version, expectedVersion: expectedVersion };
            }
            const enhancedData = { ...favoritesData, version: (currentData.version || 1) + 1, lastModified: Date.now() };
            await writeFile(FAVORITES_FILE_PATH, JSON.stringify(enhancedData, null, 2));
            BrowserWindow.getAllWindows().forEach(window => {
                if (window.webContents && !window.webContents.isDestroyed()) {
                    window.webContents.send('favorites-updated', enhancedData);
                }
            });
            return { success: true, version: enhancedData.version };
        } catch (error) {
            console.error('保存收藏数据失败:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    startFavoritesWatcher,
    stopFavoritesWatcher,
    registerIpcHandlers
};