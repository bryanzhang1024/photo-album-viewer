import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';

// 安全地获取electron对象
const ipcRenderer = window.electronAPI || null;

// 创建收藏上下文
export const FavoritesContext = createContext({
  favorites: { folders: [], albums: [], images: [], collections: [] },
  isLoading: true,
  isFolderFavorited: () => false,
  isAlbumFavorited: () => false,
  isImageFavorited: () => false,
  toggleFolderFavorite: () => {},
  toggleAlbumFavorite: () => {},
  toggleImageFavorite: () => {},
  removeImageFavorite: () => {},
  addCollection: () => {},
  removeCollection: () => {},
  addToCollection: () => {},
  removeFromCollection: () => {}
});

// 辅助函数：获取路径的基本名称
const getBasename = (filePath) => {
  if (!filePath) return '';
  const parts = filePath.split(/[/\\]/); // 处理不同操作系统的路径分隔符
  return parts[parts.length - 1];
};

const normalizeFavoritesData = (data = {}) => ({
  folders: Array.isArray(data.folders) ? data.folders : [],
  albums: Array.isArray(data.albums) ? data.albums : [],
  images: Array.isArray(data.images) ? data.images : [],
  collections: Array.isArray(data.collections) ? data.collections : [],
  version: data.version,
  lastModified: data.lastModified
});

// 收藏上下文提供者组件
export const FavoritesProvider = ({ children }) => {
  const [favorites, setFavorites] = useState({ folders: [], albums: [], images: [], collections: [] });
  const [isLoading, setIsLoading] = useState(true);

  // 加载收藏数据
  useEffect(() => {
    const loadFavorites = async () => {
      if (!ipcRenderer) {
        console.error('无法访问ipcRenderer, Electron可能没有正确加载');
        setIsLoading(false);
        return;
      }

      try {
        const data = await ipcRenderer.invoke('load-favorites');
        setFavorites(normalizeFavoritesData(data));
      } catch (error) {
        console.error('加载收藏数据失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadFavorites();

    // 监听来自主进程的收藏数据更新
    const handleFavoritesUpdated = (event, data) => {
      console.log('收到收藏数据更新:', data);
      setFavorites(normalizeFavoritesData(data));
    };

    if (ipcRenderer) {
      ipcRenderer.on('favorites-updated', handleFavoritesUpdated);
    }

    // 清理监听器
    return () => {
      if (ipcRenderer) {
        ipcRenderer.removeListener('favorites-updated', handleFavoritesUpdated);
      }
    };
  }, []);

  // 保存收藏数据
  const saveFavorites = useCallback(async (data) => {
    if (!ipcRenderer) {
      console.error('无法访问ipcRenderer, Electron可能没有正确加载');
      return false;
    }

    try {
      const result = await ipcRenderer.invoke('save-favorites', data, data.version);
      if (!result.success) {
        console.warn('保存失败:', result.error);
        // 版本冲突时重新加载数据
        if (result.error.includes('版本冲突')) {
          const newData = await ipcRenderer.invoke('load-favorites');
          setFavorites(normalizeFavoritesData(newData));
        }
      }
      return result.success;
    } catch (error) {
      console.error('保存收藏数据失败:', error);
      return false;
    }
  }, []);

  // 检查文件夹是否已收藏
  const isFolderFavorited = useCallback((folderPath) => {
    return favorites.folders.some(folder => folder.path === folderPath);
  }, [favorites.folders]);

  // 检查相簿是否已收藏
  const isAlbumFavorited = useCallback((albumPath) => {
    return favorites.albums.some(album => album.path === albumPath && (album.kind || 'photoSet') === 'photoSet');
  }, [favorites.albums]);

  // 切换文件夹收藏状态
  const toggleFolderFavorite = useCallback(async (folder) => {
    const isCurrentlyFavorited = isFolderFavorited(folder.path);
    let newFavorites;

    if (isCurrentlyFavorited) {
      newFavorites = {
        ...favorites,
        folders: favorites.folders.filter(item => item.path !== folder.path)
      };
    } else {
      const newFolder = {
        id: `folder_${Date.now()}`,
        kind: 'folder',
        path: folder.path,
        name: folder.name,
        childFolders: folder.childFolders || 0,
        previewSamples: folder.previewSamples || folder.samples || [],
        addedAt: Date.now()
      };

      newFavorites = {
        ...favorites,
        folders: [...favorites.folders, newFolder]
      };
    }

    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
    return !isCurrentlyFavorited;
  }, [favorites, isFolderFavorited, saveFavorites]);

  // 检查图片是否已收藏
  const isImageFavorited = useCallback((imagePath) => {
    return favorites.images.some(image => image.path === imagePath);
  }, [favorites.images]);

  // 切换相簿收藏状态
  const toggleAlbumFavorite = useCallback(async (album) => {
    const isCurrentlyFavorited = isAlbumFavorited(album.path);
    let newFavorites;

    if (isCurrentlyFavorited) {
      // 取消收藏
      newFavorites = {
        ...favorites,
        albums: favorites.albums.filter(item => item.path !== album.path)
      };
    } else {
      // 添加收藏
      // 确保获取正确的预览图信息
      let previewImages = [];
      let previewImagePath = '';
      
      if (album.previewImages && album.previewImages.length > 0) {
        previewImages = album.previewImages.slice(0, 4); // 保存前4张预览图
        previewImagePath = album.previewImages[0].path;
      } else if (album.previewImagePath) {
        previewImagePath = album.previewImagePath;
        // 如果只有单个路径，构造预览图数组
        previewImages = [{
          path: album.previewImagePath,
          name: album.previewImagePath.split(/[/\\]/).pop()
        }];
      }

      const newAlbum = {
        id: `album_${Date.now()}`,
        kind: 'photoSet',
        path: album.path,
        name: album.name,
        imageCount: album.imageCount || 0,
        previewImages: previewImages, // 保存预览图数组
        previewImagePath: previewImagePath, // 保持向后兼容
        addedAt: Date.now()
      };

      newFavorites = {
        ...favorites,
        albums: [...favorites.albums, newAlbum]
      };
    }

    // 更新状态并保存到文件
    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
    return !isCurrentlyFavorited;
  }, [favorites, isAlbumFavorited, saveFavorites]);

  // 切换图片收藏状态
  const toggleImageFavorite = useCallback(async (image, albumPath, albumName) => {
    const isCurrentlyFavorited = isImageFavorited(image.path);
    let newFavorites;

    if (isCurrentlyFavorited) {
      // 取消收藏
      newFavorites = {
        ...favorites,
        images: favorites.images.filter(item => item.path !== image.path)
      };
    } else {
      // 添加收藏 - 保存完整的图片信息
      const newImage = {
        id: `image_${Date.now()}`,
        path: image.path,
        name: image.name,
        size: image.size || 0, // 保存文件大小
        lastModified: image.lastModified || Date.now(), // 保存修改时间
        albumPath: albumPath || '',
        albumName: albumName || getBasename(albumPath || ''),
        addedAt: Date.now()
      };

      newFavorites = {
        ...favorites,
        images: [...favorites.images, newImage]
      };
    }

    // 更新状态并保存到文件
    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
    return !isCurrentlyFavorited;
  }, [favorites, isImageFavorited, saveFavorites]);

  const removeImageFavorite = useCallback(async (imagePath) => {
    if (!imagePath) return false;

    const newFavorites = {
      ...favorites,
      images: favorites.images.filter(item => item.path !== imagePath)
    };

    if (newFavorites.images.length === favorites.images.length) {
      return false;
    }

    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
    return true;
  }, [favorites, saveFavorites]);

  // 添加收藏集
  const addCollection = useCallback(async (name, type = 'mixed') => {
    const newCollection = {
      id: `collection_${Date.now()}`,
      name,
      type,
      items: [],
      createdAt: Date.now()
    };

    const newFavorites = {
      ...favorites,
      collections: [...favorites.collections, newCollection]
    };

    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
    return newCollection.id;
  }, [favorites, saveFavorites]);

  // 删除收藏集
  const removeCollection = useCallback(async (collectionId) => {
    const newFavorites = {
      ...favorites,
      collections: favorites.collections.filter(c => c.id !== collectionId)
    };

    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
  }, [favorites, saveFavorites]);

  // 添加项目到收藏集
  const addToCollection = useCallback(async (collectionId, itemId) => {
    const newFavorites = {
      ...favorites,
      collections: favorites.collections.map(c => {
        if (c.id === collectionId && !c.items.includes(itemId)) {
          return {
            ...c,
            items: [...c.items, itemId]
          };
        }
        return c;
      })
    };

    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
  }, [favorites, saveFavorites]);

  // 从收藏集移除项目
  const removeFromCollection = useCallback(async (collectionId, itemId) => {
    const newFavorites = {
      ...favorites,
      collections: favorites.collections.map(c => {
        if (c.id === collectionId) {
          return {
            ...c,
            items: c.items.filter(id => id !== itemId)
          };
        }
        return c;
      })
    };

    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
  }, [favorites, saveFavorites]);

  // 提供上下文值
  const contextValue = {
    favorites,
    isLoading,
    isFolderFavorited,
    isAlbumFavorited,
    isImageFavorited,
    toggleFolderFavorite,
    toggleAlbumFavorite,
    toggleImageFavorite,
    removeImageFavorite,
    addCollection,
    removeCollection,
    addToCollection,
    removeFromCollection
  };

  return (
    <FavoritesContext.Provider value={contextValue}>
      {children}
    </FavoritesContext.Provider>
  );
};

// 自定义Hook，方便使用收藏上下文
export const useFavorites = () => useContext(FavoritesContext); 
