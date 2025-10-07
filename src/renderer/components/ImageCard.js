import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, 
  Paper, 
  Typography, 
  CircularProgress, 
  IconButton 
} from '@mui/material';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import FavoriteIcon from '@mui/icons-material/Favorite';
import DeleteIcon from '@mui/icons-material/Delete';
import { useFavorites } from '../contexts/FavoritesContext';
import imageCache from '../utils/ImageCacheManager';
import { getBasename } from '../utils/pathUtils';
import useIsVisible from '../hooks/useIsVisible';

// 安全地获取electron对象
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

/**
 * 图片卡片组件 - 固定 2:3 宽高比显示
 *
 * @param {Object} props
 * @param {Object} props.image - 图片对象 {path, name, size}
 * @param {Function} props.onClick - 点击卡片的回调
 * @param {string} props.density - 显示密度 'compact' | 'standard' | 'comfortable'
 * @param {string} props.albumPath - 相簿路径
 * @param {boolean} props.lazyLoad - 是否启用懒加载 (默认false)
 * @param {boolean} props.isFavoritesPage - 是否在收藏页面 (默认false)
 * @param {Function} props.onAlbumClick - 点击相册名称的回调
 * @param {boolean} props.showAlbumLink - 是否显示相册链接 (默认false)
 */
function ImageCard({
  image,
  onClick,
  density,
  isFavoritesPage = false,
  albumPath,
  onAlbumClick,
  showAlbumLink = false,
  lazyLoad = false
}) {
  const cardRef = useRef(null);
  const isVisible = useIsVisible(cardRef);
  const initialCachedUrl = image ? imageCache.get('thumbnail', image.path) : null;
  const [imageUrl, setImageUrl] = useState(initialCachedUrl || '');
  const [loading, setLoading] = useState(lazyLoad && !initialCachedUrl);
  const [imageLoaded, setImageLoaded] = useState(!!initialCachedUrl);
  const [imageError, setImageError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2; // 最大重试次数

  // 使用收藏上下文
  const { isImageFavorited, toggleImageFavorite } = useFavorites();
  const isFavorited = image ? isImageFavorited(image.path) : false;

  // 使用密度设置
  const actualDensity = density || 'standard';

  useEffect(() => {
    let isMounted = true; // 组件挂载标志

    const loadImage = async () => {
      if (!image || !ipcRenderer || !isMounted) return;

      try {
        setLoading(true);
        setImageLoaded(false);
        setImageError(false);

        // 设置优先级 - 根据文件名排序，常见的首图文件名排在前面
        const filename = image.name.toLowerCase();
        const isPriority =
          filename.includes('cover') ||
          filename.includes('folder') ||
          filename.startsWith('0') ||
          filename.startsWith('1') ||
          filename.startsWith('a') ||
          filename.startsWith('front') ||
          filename.startsWith('main');

        // 获取缩略图 - 使用主进程中配置的分辨率
        const url = await ipcRenderer.invoke('get-image-thumbnail', image.path, isPriority ? 0 : 1);

        if (!isMounted) return; // 组件已卸载，忽略结果

        if (!url) {
          console.error(`无法获取缩略图: ${image.path}`);
          setImageError(true);
          setLoading(false);
          return;
        }

        // 将文件路径转换为自定义协议URL
        const thumbnailUrl = `thumbnail-protocol://${getBasename(url)}`;

        // 缓存到统一缓存管理器
        imageCache.set('thumbnail', image.path, thumbnailUrl);

        setImageUrl(thumbnailUrl);
        setImageLoaded(true);
      } catch (err) {
        if (!isMounted) return; // 组件已卸载，忽略错误
        console.error('加载图片出错:', err);
        setImageError(true);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (!image || !ipcRenderer) {
      setImageUrl('');
      setLoading(false);
      setImageLoaded(false);
      return () => {
        isMounted = false;
      };
    }

    const cachedUrl = imageCache.get('thumbnail', image.path);
    if (cachedUrl) {
      setImageUrl(cachedUrl);
      setImageLoaded(true);
      setImageError(false);
      setLoading(false);
    } else if (lazyLoad && !isVisible) {
      setImageUrl('');
      setImageLoaded(false);
      setLoading(true);
    } else {
      setImageUrl('');
      setImageLoaded(false);
      loadImage();
    }

    // Cleanup函数：组件卸载时执行
    return () => {
      isMounted = false;
    };
  }, [image, retryCount, isVisible, lazyLoad]);
  
    
  // 处理图片加载完成
  const handleImageLoaded = () => {
    setImageLoaded(true);
  };
  
  // 处理图片加载错误
  const handleImageError = (e) => {
    console.error(`图片加载失败: ${image.path}`);

    // 尝试重试加载
    if (retryCount < maxRetries) {
      console.log(`重试加载图片(${retryCount + 1}/${maxRetries}): ${image.path}`);
      // 清除缓存
      imageCache.clearType('thumbnail');
      // 增加重试计数并触发重新加载
      setRetryCount(prev => prev + 1);
    } else {
      // 重试次数用尽，显示错误状态
      setImageError(true);
      e.target.onerror = null;
      e.target.style.display = 'none';
      e.target.parentNode.style.backgroundColor = 'rgba(0,0,0,0.05)';
    }
  };
  
  // 点击处理
  const handleClick = (e) => {
    // 即使缩略图加载失败，也允许点击查看原图
    onClick(e);
  };

  // 处理相册点击
  const handleAlbumClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (onAlbumClick && image) {
      onAlbumClick();
    }
  };

  // 处理收藏点击
  const handleFavoriteClick = (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发卡片点击
    if (image) {
      // 获取相簿名称
      const albumName = albumPath ? albumPath.split('/').pop() : image.albumName;
      toggleImageFavorite(image, albumPath || image.albumPath, albumName);
    }
  };
  
  return (
    <Paper
      ref={cardRef}
      sx={{
        width: '100%',
        height: 'auto',
        aspectRatio: '2/3',
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 6px 12px rgba(0,0,0,0.15)'
        },
        overflow: 'hidden',
        borderRadius: 1
      }}
      onClick={handleClick}
      elevation={1}
    >
      <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        {loading ? (
          <Box sx={{
            width: '100%',
            height: '100%',
            bgcolor: 'rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <CircularProgress size={24} />
          </Box>
        ) : imageError ? (
          <Box sx={{
            width: '100%',
            height: '100%',
            bgcolor: 'rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Typography variant="caption" color="text.secondary">
              加载失败
            </Typography>
          </Box>
        ) : (
          <img
            src={imageUrl}
            alt={image.name}
            className={imageLoaded ? 'loaded' : ''}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block'
            }}
            loading="lazy"
            onLoad={handleImageLoaded}
            onError={handleImageError}
          />
        )}
      </Box>
      
      {/* 底部信息覆盖层 - 所有模式都显示 */}
      <Box sx={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '5%', // 更少的高度范围
        background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)', // 简单渐变，快速透明
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end', // 内容贴底
        padding: 0, // 完全无内边距，文字紧贴底部
        zIndex: 2
      }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ flexGrow: 1, overflow: 'hidden', mr: 1, ml: 1 }}>
            <Typography
              variant="subtitle2"
              component="div"
              noWrap
              title={image.name}
              sx={{
                fontSize: actualDensity === 'compact' ? '0.7rem' : '0.8rem',
                fontWeight: 'medium',
                textShadow: '1px 1px 2px rgba(0,0,0,0.5)'
              }}
            >
              {image.name}
            </Typography>

            {showAlbumLink && image.albumName && (
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.8)',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
                  '&:hover': { color: 'rgba(255,255,255,1)' }
                }}
                onClick={handleAlbumClick}
                title={`点击跳转到相册: ${image.albumName}`}
              >
                {image.albumName}
              </Typography>
            )}
          </Box>

          <IconButton
            size="small"
            sx={{
              p: 0.5,
              color: 'white',
              backgroundColor: 'rgba(0,0,0,0.3)',
              '&:hover': {
                backgroundColor: 'rgba(0,0,0,0.5)',
                color: isFavoritesPage ? 'error.main' : (isFavorited ? 'error.main' : 'white')
              }
            }}
            onClick={handleFavoriteClick}
            aria-label={isFavoritesPage ? "取消收藏" : (isFavorited ? "取消收藏" : "添加收藏")}
          >
            {isFavoritesPage ?
              <DeleteIcon fontSize="small" /> :
              (isFavorited ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />)
            }
          </IconButton>
        </Box>
      </Box>
    </Paper>
  );
}

export default React.memo(ImageCard); 
