import React, { useState, useEffect, useRef } from 'react';
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
  compact = false,
  variant = 'default' // 新增 variant prop
}) {
  const theme = useTheme();
  const containerRef = useRef(null);
  const [dynamicMaxItems, setDynamicMaxItems] = useState(4);

  useEffect(() => {
    const calculateMaxItems = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        // 估算每个面包屑项目的平均宽度（包括图标和间距）
        const averageItemWidth = 150; // px
        const calculatedMaxItems = Math.floor(containerWidth / averageItemWidth);
        // 确保至少显示3个项目（例如：Home > ... > Last），并且不超过一个合理的最大值
        setDynamicMaxItems(Math.max(3, calculatedMaxItems));
      }
    };

    // 初始计算
    calculateMaxItems();

    // 监听窗口大小变化
    window.addEventListener('resize', calculateMaxItems);
    return () => window.removeEventListener('resize', calculateMaxItems);
  }, [breadcrumbs]); // 当面包屑内容变化时也重新计算

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
      if (parentBreadcrumb && parentBreadcrumb.path) {
        onNavigate(parentBreadcrumb.path);
      }
    }
  };

  // 渲染统计信息 - 紧凑版本
  const renderStats = () => {
    if (!showStats || !metadata) return null;

    const { folderCount, albumCount } = metadata;

    // 如果没有任何统计数据，不显示
    if (folderCount === 0 && albumCount === 0) return null;

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
     </Box>
   );
  };

  // 核心面包屑渲染逻辑
  const renderContent = () => (
    <Box 
      ref={containerRef}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: '40px',
        flexGrow: 1, // 占据可用空间
        minWidth: 0, // 防止内容溢出
    }}>
      {breadcrumbs.length > 1 && (
        <Tooltip title="返回上级">
          <IconButton
            size="small"
            onClick={handleGoUp}
            sx={{
              color: 'inherit', // 继承父组件颜色
              '&:hover': {
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
          sx={{ flex: 1, overflow: 'hidden', minWidth: 0, color: 'inherit' }}
          maxItems={compact ? 2 : dynamicMaxItems}
        >
          {breadcrumbs.map((breadcrumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            const isFirst = index === 0;

            if (isLast) {
              // 当前路径 - 不可点击
              return (
                <Box key={breadcrumb.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                  <FolderIcon sx={{ fontSize: '1rem', color: 'inherit', opacity: 0.8, flexShrink: 0 }} />
                  <Typography
                    variant="body2"
                    color="inherit" // 继承颜色
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
                color="inherit" // 继承颜色
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
                  opacity: 0.8,
                  '&:hover': {
                    opacity: 1
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
        <Typography variant="body2" color="inherit" sx={{ flex: 1 }}>
          请选择文件夹
        </Typography>
      )}
    </Box>
  );

  // 根据 variant 选择渲染模式
  if (variant === 'minimal') {
    return renderContent();
  }

  // 默认模式（旧的完整模式）
  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      p: compact ? 1 : 1.5,
      bgcolor: 'background.paper',
      borderBottom: 1,
      borderColor: 'divider'
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {renderContent()}
        {showStats && renderStats()}
      </Box>
    </Box>
  );
}

export default BreadcrumbNavigation;
