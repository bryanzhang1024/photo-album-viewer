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

  // 渲染统计信息
  const renderStats = () => {
    if (!showStats || !metadata) return null;

    const { folderCount, albumCount, totalImages } = metadata;
    const items = [];

    if (folderCount > 0) {
      items.push(`${folderCount}个文件夹`);
    }
    if (albumCount > 0) {
      items.push(`${albumCount}个相册`);
    }
    if (totalImages > 0) {
      items.push(`${totalImages}张图片`);
    }

    if (items.length === 0) return null;

    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        {items.map((item, index) => (
          <Chip
            key={index}
            label={item}
            size="small"
            variant="outlined"
            sx={{
              fontSize: '0.75rem',
              height: '24px',
              color: 'text.secondary',
              borderColor: 'divider'
            }}
          />
        ))}
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
          sx={{ flex: 1 }}
        >
          {getDisplayPath(currentPath, 40)}
        </Typography>

        {renderStats()}
      </Box>
    );
  }

  // 完整模式：显示完整面包屑
  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      p: 2,
      bgcolor: 'background.paper',
      borderBottom: 1,
      borderColor: 'divider'
    }}>
      {/* 主要导航行 */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 1,
        minHeight: '32px'
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

        {breadcrumbs.length > 0 ? (
          <Breadcrumbs
            aria-label="路径导航"
            separator="›"
            sx={{ flex: 1, overflow: 'hidden' }}
            maxItems={5}
          >
            {breadcrumbs.map((breadcrumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              const isFirst = index === 0;

              if (isLast) {
                // 当前路径 - 不可点击
                return (
                  <Box key={breadcrumb.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <FolderIcon sx={{ fontSize: '1rem', color: 'text.secondary' }} />
                    <Typography
                      variant="body2"
                      color="text.primary"
                      fontWeight="medium"
                      noWrap
                      title={breadcrumb.name}
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
                    '&:hover': {
                      color: 'primary.main'
                    }
                  }}
                  title={breadcrumb.path}
                >
                  {isFirst && <HomeIcon sx={{ fontSize: '1rem' }} />}
                  {!isFirst && <FolderIcon sx={{ fontSize: '1rem' }} />}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
      </Box>

      {/* 统计信息行 */}
      {renderStats()}
    </Box>
  );
}

export default BreadcrumbNavigation;