import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Card,
  Typography,
  Box,
  Skeleton,
  IconButton
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import DeleteIcon from '@mui/icons-material/Delete';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
// import LazyLoad from 'react-lazyload'; // 注释掉懒加载导入

const ipcRenderer = window.electronAPI || null;

import useIsVisible from '../hooks/useIsVisible';
import CHANNELS from '../../common/ipc-channels';
import { getThumbnailUrl } from '../utils/thumbnailUrl';
import { getBasename } from '../utils/pathUtils';

// 观察器已移除 - 使用isVisible属性替代

// 全局请求映射 - 防止重复请求
const thumbnailRequests = new Map();

const normalizeThumbnailUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return null;
  }
  if (url.startsWith('thumbnail-protocol://')) {
    return url;
  }
  return `thumbnail-protocol://${getBasename(url)}`;
};

// 相簿/文件夹预览卡片组件 - 重构版本
function AlbumCard({ 
  node,           // 新的导航节点数据
  album,          // 兼容性：旧的相册数据 
  displayPath, 
  onClick, 
  isCompactMode, 
  isFavoritesPage = false 
}) {
  // 同步从缓存初始化，消除首次渲染的骨架屏闪烁
  const initialPath = node?.path || album?.path;
  const [previewUrls, setPreviewUrls] = useState(() =>
    initialPath ? (imageCache.get('preview', initialPath) || []) : []
  );
  const [loading, setLoading] = useState(() =>
    initialPath ? !imageCache.get('preview', initialPath) : true
  );
  const cardRef = useRef(null);
  const ipcFallbackAttempted = useRef(false);
  const isVisible = useIsVisible(cardRef);
  
  // 数据兼容性处理：优先使用新的node数据，回退到旧的album数据
  const cardData = useMemo(() => {
    if (node) {
      return {
        path: node.path,
        name: node.name,
        type: node.type,
        imageCount: node.imageCount,
        samples: node.samples || node.previewSamples || [],
        hasImages: node.hasImages,
        childFolders: node.childFolders
      };
    } else if (album) {
      return {
        path: album.path,
        name: album.name,
        type: 'album',
        imageCount: album.imageCount,
        samples: album.previewImages?.map(img => img.path) || [],
        hasImages: true,
        childFolders: 0
      };
    }
    return null;
  }, [node, album]);
  
  // 使用统一缓存管理器的缓存键
  const cacheKey = useMemo(() => {
    if (!cardData?.path) return '';
    return cardData.path;
  }, [cardData?.path]);
  
  // 使用收藏上下文
  const { isAlbumFavorited, toggleAlbumFavorite } = useFavorites();
  const isFavorited = cardData ? isAlbumFavorited(cardData.path) : false;
  
  // 如果没有有效数据，返回空组件
  if (!cardData) {
    return null;
  }
  
  // 根据可见性加载预览图
  useEffect(() => {
    if (!cardData) {
      setLoading(false);
      return;
    }

    ipcFallbackAttempted.current = false;

    // 内存缓存命中
    const cachedUrls = imageCache.get('preview', cacheKey);
    if (cachedUrls) {
      setPreviewUrls(cachedUrls.map(normalizeThumbnailUrl).filter(Boolean));
      setLoading(false);
      return;
    }

    if (!isVisible) return;

    const isFolder = cardData.type === 'folder';

    if (!isFolder) {
      // 相册类型（单图）：直接用预算 URL，零 IPC
      const sample = cardData.samples?.[0];
      const predicted = sample ? getThumbnailUrl(sample) : null;
      if (predicted) {
        setPreviewUrls([predicted]);
        setLoading(false);
        return;
      }
    }

    // 文件夹类型（2×2）或相册无法预算时：走 IPC
    if (!ipcRenderer) {
      setLoading(false);
      return;
    }

    const requestId = `req_${cardData.path}`;
    if (thumbnailRequests.has(requestId)) return;
    thumbnailRequests.set(requestId, true);

    const loadViaIpc = async () => {
      try {
        setLoading(true);
        const maxSamples = isFolder ? 4 : 1;
        const imagePaths = cardData.samples ? cardData.samples.slice(0, maxSamples) : [];
        if (imagePaths.length === 0) return;

        const results = await ipcRenderer.invoke(CHANNELS.GET_BATCH_THUMBNAILS, imagePaths, 0);
        const validUrls = imagePaths
          .map((p) => normalizeThumbnailUrl(results[p]))
          .filter(Boolean);
        imageCache.set('preview', cacheKey, validUrls);
        setPreviewUrls(validUrls);
      } catch (err) {
        console.error('加载预览图出错:', err);
      } finally {
        setLoading(false);
        thumbnailRequests.delete(requestId);
      }
    };

    loadViaIpc();
  }, [cardData, cacheKey, isVisible]);

  // 相册封面图加载失败（磁盘无缓存）→ IPC fallback 生成
  const handleAlbumPreviewError = async () => {
    if (ipcFallbackAttempted.current || !ipcRenderer || !cardData) return;
    ipcFallbackAttempted.current = true;

    const sample = cardData.samples?.[0];
    if (!sample) return;

    try {
      setPreviewUrls([]);
      setLoading(true);
      const results = await ipcRenderer.invoke(CHANNELS.GET_BATCH_THUMBNAILS, [sample], 0);
      const url = results[sample];
      if (url) {
        const thumbnailUrl = `thumbnail-protocol://${getBasename(url)}`;
        imageCache.set('preview', cacheKey, [thumbnailUrl]);
        setPreviewUrls([thumbnailUrl]);
      }
    } catch (err) {
      console.error('预览图 IPC fallback 失败:', err);
    } finally {
      setLoading(false);
    }
  };
  
  // 清理旧的会话缓存（兼容性保留）
  const clearOldSessionCache = () => {
    // 统一缓存管理器会自动处理LRU淘汰
    console.log('使用统一缓存管理器，无需手动清理');
  };
  
  // 占位符组件
  const PreviewPlaceholder = () => (
    <Box sx={{ height: '100%', bgcolor: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Skeleton variant="rectangular" width="100%" height="100%" />
    </Box>
  );

  // 文件夹预览渲染
  const renderFolderPreview = () => {
    const hasPreviewImages = previewUrls.length > 0;
    
    return (
      <Box sx={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {/* 主要内容区域 */}
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          bgcolor: hasPreviewImages ? 'transparent' : 'rgba(0,0,0,0.03)'
        }}>
          {hasPreviewImages ? (
            // 有预览图时的网格布局
            <Box sx={{ 
              width: '100%', 
              height: '100%',
              display: 'grid',
              gridTemplateColumns: previewUrls.length === 1 ? '1fr' : '1fr 1fr',
              gridTemplateRows: previewUrls.length <= 2 ? '1fr' : '1fr 1fr',
              gap: '2px',
              p: 1
            }}>
              {previewUrls.slice(0, 4).map((url, index) => (
                <Box
                  key={index}
                  sx={{
                    bgcolor: 'rgba(0,0,0,0.05)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  <img
                    src={url}
                    alt={`预览 ${index + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentNode.style.backgroundColor = 'rgba(0,0,0,0.05)';
                    }}
                  />
                </Box>
              ))}
            </Box>
          ) : (
            // 无预览图时的文件夹图标
            <FolderIcon sx={{ 
              fontSize: 64, 
              color: 'primary.main',
              opacity: 0.6
            }} />
          )}
        </Box>

        {/* 文件夹统计信息 */}
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'rgba(0,0,0,0.7)',
            color: 'white',
            borderRadius: '12px',
            px: 1,
            py: 0.5,
            fontSize: '0.7rem',
            fontWeight: 'medium',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5
          }}
        >
          <FolderIcon sx={{ fontSize: '0.8rem' }} />
          {cardData.childFolders || 0}
        </Box>

      </Box>
    );
  };
  
  // 根据节点类型和预览图数量返回不同的预览布局
  const renderPreview = () => {
    if (!cardData) return null;

    const isFolder = cardData.type === 'folder';
    
    if (loading) {
      return (
        <Box sx={{ height: '100%', position: 'relative' }}>
          <PreviewPlaceholder />
        </Box>
      );
    }
    
    // 文件夹类型的特殊渲染
    if (isFolder) {
      return renderFolderPreview();
    }
    
    // 相册类型：单张封面图铺满
    return (
      <Box sx={{ height: '100%', position: 'relative' }}>
        {previewUrls.length > 0 ? (
          <img
            src={previewUrls[0]}
            alt={cardData.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
            onError={handleAlbumPreviewError}
          />
        ) : (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.05)' }}>
            <ImageIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
          </Box>
        )}
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'rgba(0,0,0,0.6)',
            color: 'white',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 'medium'
          }}
        >
          {cardData.imageCount || 0}
        </Box>
      </Box>
    );
  };
  
  // 处理收藏点击
  const handleFavoriteClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (cardData) {
      // 为了兼容性，构造album格式
      const albumForFavorite = {
        path: cardData.path,
        name: cardData.name,
        imageCount: cardData.imageCount
      };
      toggleAlbumFavorite(albumForFavorite);
    }
  };

  return (
    <Card 
      ref={cardRef}
      sx={{
        height: 'auto',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 6px 12px rgba(0,0,0,0.15)'
        },
        overflow: 'hidden',
        borderRadius: 1
      }}
      onClick={onClick}
      elevation={1}
    >
      {/* 图片区域 */}
      <Box sx={{
        aspectRatio: '2/3',
        position: 'relative',
        width: '100%',
        overflow: 'hidden',
        flexShrink: 0
      }}>
        <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          {renderPreview()}
        </Box>
      </Box>

      {/* 图片外部文字条 */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        px: isCompactMode ? 0.75 : 1,
        height: isCompactMode ? 28 : 32,
        bgcolor: 'background.paper',
        flexShrink: 0,
        minWidth: 0
      }}>
        <Typography
          variant="caption"
          component="div"
          noWrap
          title={cardData.name}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            fontWeight: 'medium',
            fontSize: isCompactMode ? '0.7rem' : '0.78rem',
            color: 'text.primary',
            lineHeight: 1
          }}
        >
          {cardData.name}
        </Typography>

        <IconButton
          size="small"
          sx={{
            ml: 0.5,
            p: 0.25,
            flexShrink: 0,
            color: 'text.secondary',
            width: isCompactMode ? 22 : 26,
            height: isCompactMode ? 22 : 26,
            '&:hover': { color: '#ff6b6b' }
          }}
          onClick={handleFavoriteClick}
          aria-label={isFavoritesPage ? "取消收藏" : (isFavorited ? "取消收藏" : "添加收藏")}
        >
          {isFavoritesPage
            ? <DeleteIcon sx={{ fontSize: isCompactMode ? '0.8rem' : '0.9rem' }} />
            : (isFavorited
                ? <FavoriteIcon sx={{ fontSize: isCompactMode ? '0.8rem' : '0.9rem' }} />
                : <FavoriteBorderIcon sx={{ fontSize: isCompactMode ? '0.8rem' : '0.9rem' }} />)
          }
        </IconButton>
      </Box>
    </Card>
  );
}

export default React.memo(AlbumCard); 
