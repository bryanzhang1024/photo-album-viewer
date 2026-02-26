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
import { getThumbnailUrl } from '../utils/thumbnailUrl';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

/**
 * 图片卡片组件 - 固定 2:3 宽高比显示
 *
 * 加载策略（快速路径优先）：
 *   1. 内存缓存命中 → 直接显示，零 IPC
 *   2. 内存缓存未命中 → 用预算 URL 直接加载（thumbnail-protocol），零 IPC
 *   3. 预算 URL 加载失败（文件不在磁盘）→ IPC 生成缩略图，缓存后显示
 *
 * @param {Object} props
 * @param {Object} props.image        - 图片对象 {path, name, size}
 * @param {Function} props.onClick    - 点击卡片的回调
 * @param {string} props.density      - 显示密度 'compact' | 'standard' | 'comfortable'
 * @param {string} props.albumPath    - 相簿路径
 * @param {boolean} props.lazyLoad    - 是否启用懒加载（默认 false）
 * @param {boolean} props.isFavoritesPage - 是否在收藏页面（默认 false）
 * @param {Function} props.onAlbumClick   - 点击相册名称的回调
 * @param {boolean} props.showAlbumLink   - 是否显示相册链接（默认 false）
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
  const ipcFallbackAttempted = useRef(false);

  // 同步从缓存或预算 URL 初始化，消除首次渲染的空白闪烁
  const [imageUrl, setImageUrl] = useState(() => {
    if (!image) return '';
    return imageCache.get('thumbnail', image.path) || getThumbnailUrl(image.path) || '';
  });
  const [loading, setLoading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(() => {
    if (!image) return false;
    return !!imageCache.get('thumbnail', image.path);
  });
  const [imageError, setImageError] = useState(false);

  const { isImageFavorited, toggleImageFavorite } = useFavorites();
  const isFavorited = image ? isImageFavorited(image.path) : false;
  const actualDensity = density || 'standard';

  // image 变化时重置状态（组件复用场景）
  useEffect(() => {
    if (!image) {
      setImageUrl('');
      setLoading(false);
      setImageLoaded(false);
      setImageError(false);
      return;
    }

    ipcFallbackAttempted.current = false;

    // 内存缓存命中
    const cached = imageCache.get('thumbnail', image.path);
    if (cached) {
      setImageUrl(cached);
      setLoading(false);
      setImageLoaded(true);
      setImageError(false);
      return;
    }

    // 预算 URL（快速路径，零 IPC）
    const predicted = getThumbnailUrl(image.path);
    if (predicted && (!lazyLoad || isVisible)) {
      setImageUrl(predicted);
      setLoading(false);
      setImageLoaded(false);
      setImageError(false);
    } else if (lazyLoad && !isVisible) {
      // 懒加载且不在视口：清空等待可见
      setImageUrl('');
      setLoading(true);
      setImageLoaded(false);
      setImageError(false);
    }
    // 已有预算 URL 且不是 lazyLoad 的情况：useState 初始值已处理，无需重复 set
  }, [image?.path]);

  // 懒加载：进入视口时触发
  useEffect(() => {
    if (!lazyLoad || !isVisible || !image) return;
    if (imageUrl || imageError) return;

    const cached = imageCache.get('thumbnail', image.path);
    if (cached) {
      setImageUrl(cached);
      setLoading(false);
      setImageLoaded(true);
      return;
    }

    const predicted = getThumbnailUrl(image.path);
    if (predicted) {
      setImageUrl(predicted);
      setLoading(false);
    }
  }, [isVisible]);

  // 图片加载成功：存入内存缓存
  const handleImageLoaded = () => {
    if (image && imageUrl && !imageCache.get('thumbnail', image.path)) {
      imageCache.set('thumbnail', image.path, imageUrl);
    }
    setImageLoaded(true);
  };

  // 图片加载失败：第一次失败走 IPC 生成，第二次视为真正失败
  const handleImageError = async () => {
    if (!image) return;

    if (ipcFallbackAttempted.current) {
      setImageError(true);
      setLoading(false);
      return;
    }

    ipcFallbackAttempted.current = true;
    setLoading(true);
    setImageUrl('');

    if (!ipcRenderer) {
      setImageError(true);
      setLoading(false);
      return;
    }

    try {
      const filename = image.name.toLowerCase();
      const isPriority =
        filename.includes('cover') ||
        filename.includes('folder') ||
        filename.startsWith('0') ||
        filename.startsWith('1') ||
        filename.startsWith('a') ||
        filename.startsWith('front') ||
        filename.startsWith('main');

      const url = await ipcRenderer.invoke('get-image-thumbnail', image.path, isPriority ? 0 : 1);

      if (!url) {
        setImageError(true);
        return;
      }

      const thumbnailUrl = `thumbnail-protocol://${getBasename(url)}`;
      imageCache.set('thumbnail', image.path, thumbnailUrl);
      setImageUrl(thumbnailUrl);
      setImageLoaded(false);
    } catch (err) {
      console.error('缩略图生成失败:', err);
      setImageError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = (e) => onClick(e);

  const handleAlbumClick = (e) => {
    e.stopPropagation();
    if (onAlbumClick && image) onAlbumClick();
  };

  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    if (image) {
      const albumName = albumPath ? albumPath.split('/').pop() : image.albumName;
      toggleImageFavorite(image, albumPath || image.albumPath, albumName);
    }
  };

  return (
    <Paper
      ref={cardRef}
      sx={{
        width: '100%',
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
      onClick={handleClick}
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
            alt={image?.name}
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

      {/* 图片外部文字条 */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        px: actualDensity === 'compact' ? 0.75 : 1,
        height: actualDensity === 'compact' ? 28 : 32,
        bgcolor: 'background.paper',
        flexShrink: 0,
        minWidth: 0
      }}>
        <Box sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
          <Typography
            variant="caption"
            component="div"
            noWrap
            title={image?.name}
            sx={{
              fontWeight: 'medium',
              fontSize: actualDensity === 'compact' ? '0.7rem' : '0.78rem',
              color: 'text.primary',
              lineHeight: 1
            }}
          >
            {image?.name}
          </Typography>

          {showAlbumLink && image?.albumName && (
            <Typography
              variant="caption"
              noWrap
              title={`点击跳转到相册: ${image.albumName}`}
              sx={{
                display: 'block',
                fontSize: '0.62rem',
                color: 'text.secondary',
                cursor: 'pointer',
                lineHeight: 1,
                mt: 0.25,
                '&:hover': { color: 'text.primary' }
              }}
              onClick={handleAlbumClick}
            >
              {image.albumName}
            </Typography>
          )}
        </Box>

        <IconButton
          size="small"
          sx={{
            ml: 0.5,
            p: 0.25,
            flexShrink: 0,
            color: 'text.secondary',
            width: actualDensity === 'compact' ? 22 : 26,
            height: actualDensity === 'compact' ? 22 : 26,
            '&:hover': { color: '#ff6b6b' }
          }}
          onClick={handleFavoriteClick}
          aria-label={isFavoritesPage ? "取消收藏" : (isFavorited ? "取消收藏" : "添加收藏")}
        >
          {isFavoritesPage
            ? <DeleteIcon sx={{ fontSize: actualDensity === 'compact' ? '0.8rem' : '0.9rem' }} />
            : (isFavorited
                ? <FavoriteIcon sx={{ fontSize: actualDensity === 'compact' ? '0.8rem' : '0.9rem' }} />
                : <FavoriteBorderIcon sx={{ fontSize: actualDensity === 'compact' ? '0.8rem' : '0.9rem' }} />)
          }
        </IconButton>
      </Box>
    </Paper>
  );
}

export default React.memo(ImageCard);
