import React from 'react';
import {
  Box,
  Breadcrumbs,
  Link,
  Typography,
  Chip,
  useTheme,
  IconButton,
  Tooltip
} from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import HomeIcon from '@mui/icons-material/Home';
import FolderIcon from '@mui/icons-material/Folder';
import { getDisplayPath } from '../utils/pathUtils';

/**
 * 面包屑导航组件
 * 支持层级导航和快速返回
 */
function BreadcrumbNavigation({ 
  breadcrumbs = [], 
  currentPath = '', 
  onNavigate, 
  showStats = true,
  metadata = null,
  compact = false
}) {
  const theme = useTheme();

  // 处理面包屑点击
  const handleBreadcrumbClick = (breadcrumb, event) => {
    event.preventDefault();
    if (onNavigate && breadcrumb.path !== currentPath) {
      onNavigate(breadcrumb.path);
    }
  };

  // 处理返回上级
  const handleGoUp = () => {
    if (breadcrumbs.length > 1 && onNavigate) {
      const parentBreadcrumb = breadcrumbs[breadcrumbs.length - 2];
      onNavigate(parentBreadcrumb.path);
    }
  };

  // 渲染统计信息 - 紧凑版本
  const renderStats = () => {
    if (!showStats || !metadata) return null;

    const { folderCount, albumCount, totalImages } = metadata;

    // 如果没有任何统计数据，不显示
    if (folderCount === 0 && albumCount === 0 && totalImages === 0) return null;

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.5,
          bgcolor: 'action.hover',
          borderRadius: 1,
          minWidth: 0
        }}
      >
        {/* 文件夹统计 */}
        {folderCount > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <FolderIcon sx={{ fontSize: '0.875rem', color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              {folderCount}
            </Typography>
          </Box>
        )}

        {/* 相册统计 */}
        {albumCount > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              📷
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              {albumCount}
            </Typography>
          </Box>
        )}

        {/* 图片统计 */}
        {totalImages > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              🖼️
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              {totalImages}
            </Typography>
          </Box>
        )}
      </Box>
    );
  };

  if (compact) {
    // 紧凑模式：只显示当前路径和返回按钮
    return (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: '40px',
        px: 1,
        py: 0.5
      }}>
        {breadcrumbs.length > 1 && (
          <Tooltip title="返回上级">
            <IconButton
              size="small"
              onClick={handleGoUp}
              sx={{
                color: 'text.secondary',
                '&:hover': {
                  color: 'primary.main',
                  bgcolor: 'action.hover'
                }
              }}
            >
              <NavigateBeforeIcon />
            </IconButton>
          </Tooltip>
        )}
        
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          title={currentPath}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {getDisplayPath(currentPath, 40)}
        </Typography>

        {/* 紧凑模式下的统计信息 - 更简洁 */}
        {showStats && metadata && (metadata.folderCount > 0 || metadata.albumCount > 0 || metadata.totalImages > 0) && (
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 0.75,
            py: 0.25,
            bgcolor: 'action.hover',
            borderRadius: 0.75
          }}>
            {metadata.folderCount > 0 && (
              <Typography variant="caption" color="text.secondary">
                📁{metadata.folderCount}
              </Typography>
            )}
            {metadata.albumCount > 0 && (
              <Typography variant="caption" color="text.secondary">
                📷{metadata.albumCount}
              </Typography>
            )}
            {metadata.totalImages > 0 && (
              <Typography variant="caption" color="text.secondary">
                🖼️{metadata.totalImages}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    );
  }

  // 完整模式：显示完整面包屑
  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      p: 1.5,
      bgcolor: 'background.paper',
      borderBottom: 1,
      borderColor: 'divider'
    }}>
      {/* 整合导航和统计的单行布局 */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: '40px'
      }}>
        {breadcrumbs.length > 1 && (
          <Tooltip title="返回上级">
            <IconButton
              size="small"
              onClick={handleGoUp}
              sx={{
                color: 'text.secondary',
                '&:hover': {
                  color: 'primary.main',
                  bgcolor: 'action.hover'
                }
              }}
            >
              <NavigateBeforeIcon />
            </IconButton>
          </Tooltip>
        )}

        {/* 面包屑导航 - 主要内容 */}
        {breadcrumbs.length > 0 ? (
          <Breadcrumbs
            aria-label="路径导航"
            separator="›"
            sx={{ flex: 1, overflow: 'hidden', minWidth: 0 }}
            maxItems={4}
          >
            {breadcrumbs.map((breadcrumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              const isFirst = index === 0;

              if (isLast) {
                // 当前路径 - 不可点击
                return (
                  <Box key={breadcrumb.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    <FolderIcon sx={{ fontSize: '1rem', color: 'text.secondary', flexShrink: 0 }} />
                    <Typography
                      variant="body2"
                      color="text.primary"
                      fontWeight="medium"
                      noWrap
                      title={breadcrumb.name}
                      sx={{ minWidth: 0 }}
                    >
                      {breadcrumb.name}
                    </Typography>
                  </Box>
                );
              }

              return (
                <Link
                  key={breadcrumb.path}
                  component="button"
                  variant="body2"
                  color="text.secondary"
                  underline="hover"
                  onClick={(e) => handleBreadcrumbClick(breadcrumb, e)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    p: 0,
                    minWidth: 0,
                    '&:hover': {
                      color: 'primary.main'
                    }
                  }}
                  title={breadcrumb.path}
                >
                  {isFirst && <HomeIcon sx={{ fontSize: '1rem', flexShrink: 0 }} />}
                  {!isFirst && <FolderIcon sx={{ fontSize: '1rem', flexShrink: 0 }} />}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                    {breadcrumb.name}
                  </span>
                </Link>
              );
            })}
          </Breadcrumbs>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            请选择文件夹
          </Typography>
        )}

        {/* 统计信息 - 紧凑显示 */}
        {renderStats()}
      </Box>
    </Box>
  );
}

export default BreadcrumbNavigation;