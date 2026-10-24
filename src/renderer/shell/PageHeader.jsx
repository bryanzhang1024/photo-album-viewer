import React from 'react';
import { Box, Typography } from '@mui/material';
import BreadcrumbNavigation from '../components/BreadcrumbNavigation';

/**
 * 页面头部：一行内放「上级路径 + 当前标题 + 数量」和右侧控件。
 *
 * 面包屑只显示上级路径，当前目录名由标题承担，避免同一屏重复出现两次。
 * 控件过宽时整行换行，不会挤压标题。
 */
export default function PageHeader({
  breadcrumbs = [],
  onNavigate = null,
  title = '',
  count = null,
  controls = null,
  metadata = null,
  compact = false
}) {
  const ancestors = breadcrumbs.length > 1 ? breadcrumbs.slice(0, -1) : [];

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 1.5,
      minWidth: 0
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: '1 1 320px' }}>
        {ancestors.length > 0 ? (
          <BreadcrumbNavigation
            breadcrumbs={ancestors}
            currentPath={ancestors[ancestors.length - 1]?.path || ''}
            onNavigate={onNavigate}
            showStats={false}
            metadata={metadata}
            compact={compact}
            variant="minimal"
            sx={{ minWidth: 0, flexShrink: 1 }}
          />
        ) : null}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography
            component="h1"
            noWrap
            title={title}
            sx={{
              m: 0,
              fontSize: compact ? 15 : 17,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              minWidth: 0
            }}
          >
            {title}
          </Typography>
          {count ? (
            <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary', flexShrink: 0 }}>
              {count}
            </Typography>
          ) : null}
        </Box>
      </Box>
      {controls ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>{controls}</Box>
      ) : null}
    </Box>
  );
}
