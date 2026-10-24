import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import BrowseModeTabs from './BrowseModeTabs';
import { MAC_TITLEBAR_HEIGHT, MAC_WINDOW_CONTROLS_WIDTH } from '../../common/window-chrome';

/**
 * 窗口标题栏。macOS 下与原生三色按钮共用一条可拖拽区域；
 * 非 macOS 保留原有的模式切换标签。
 */
export default function AppTitleBar({ onToggleSidebar = null, sidebarCollapsed = false }) {
  if (window.electronAPI?.platform !== 'darwin') return <BrowseModeTabs />;

  return (
    <Box component="header" aria-label="窗口标题栏" sx={{
      height: MAC_TITLEBAR_HEIGHT, flexShrink: 0, position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      pl: `${MAC_WINDOW_CONTROLS_WIDTH}px`, pr: 1.5,
      bgcolor: theme => theme.palette.chrome,
      WebkitAppRegion: 'drag', userSelect: 'none'
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, WebkitAppRegion: 'no-drag' }}>
        {onToggleSidebar ? (
          <Tooltip title={sidebarCollapsed ? '显示侧栏' : '隐藏侧栏'}>
            <IconButton
              size="small"
              onClick={onToggleSidebar}
              aria-label={sidebarCollapsed ? '显示侧栏' : '隐藏侧栏'}
              aria-pressed={!sidebarCollapsed}
              sx={{ width: 26, height: 22, borderRadius: 1, color: 'text.secondary' }}
            >
              <ViewSidebarOutlinedIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
      <Typography component="span" sx={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        maxWidth: 'calc(100% - 420px)', fontSize: 12, color: 'text.secondary',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        pointerEvents: 'none'
      }}>照片相簿浏览器</Typography>
      <Box sx={{ WebkitAppRegion: 'no-drag' }}>
        <BrowseModeTabs compact />
      </Box>
    </Box>
  );
}
