import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useShellActions } from './ShellActions';
import { MAC_TITLEBAR_HEIGHT, MAC_WINDOW_CONTROLS_WIDTH } from '../../common/window-chrome';

/**
 * 窗口工具栏：侧栏开关、后退、前进、窗口标题。
 * macOS 下与原生三色按钮共用同一条可拖拽区域，按钮自身不参与拖拽。
 */
export default function Toolbar({ onToggleSidebar = null, sidebarCollapsed = false }) {
  const { actions } = useShellActions();
  const isMac = window.electronAPI?.platform === 'darwin';

  return (
    <Box component="header" aria-label="窗口工具栏" sx={{
      height: MAC_TITLEBAR_HEIGHT,
      flexShrink: 0,
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      pl: isMac ? `${MAC_WINDOW_CONTROLS_WIDTH}px` : 1,
      pr: 1,
      bgcolor: 'chrome',
      borderBottom: 1,
      borderColor: 'divider',
      WebkitAppRegion: 'drag',
      userSelect: 'none'
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, WebkitAppRegion: 'no-drag' }}>
        {onToggleSidebar ? (
          <Tooltip title={sidebarCollapsed ? '显示侧栏' : '隐藏侧栏'}>
            <IconButton
              size="small"
              onClick={onToggleSidebar}
              aria-label={sidebarCollapsed ? '显示侧栏' : '隐藏侧栏'}
              aria-pressed={!sidebarCollapsed}
              sx={{ width: 26, height: 22, borderRadius: 1 }}
            >
              <ViewSidebarOutlinedIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        ) : null}
        <Box sx={{ width: 1, height: 14, bgcolor: 'divider', mx: 0.5 }} />
        <Tooltip title="后退 (⌘[)">
          <span>
            <IconButton
              size="small"
              aria-label="后退"
              onClick={actions.goBack || undefined}
              disabled={!actions.canGoBack}
              sx={{ width: 26, height: 22, borderRadius: 1 }}
            >
              <ChevronLeftIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="前进 (⌘])">
          <span>
            <IconButton
              size="small"
              aria-label="前进"
              onClick={actions.goForward || undefined}
              disabled={!actions.canGoForward}
              sx={{ width: 26, height: 22, borderRadius: 1 }}
            >
              <ChevronRightIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Typography component="span" sx={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 'calc(100% - 420px)',
        fontSize: 12,
        color: 'text.secondary',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        pointerEvents: 'none'
      }}>{actions.title}</Typography>
    </Box>
  );
}
