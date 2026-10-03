import React from 'react';
import { Box, Typography } from '@mui/material';
import BrowseModeTabs from './BrowseModeTabs';
import { MAC_TITLEBAR_HEIGHT, MAC_WINDOW_CONTROLS_WIDTH } from '../../common/window-chrome';

export default function AppTitleBar() {
  if (window.electronAPI?.platform !== 'darwin') return <BrowseModeTabs />;

  return <Box component="header" aria-label="窗口标题栏" sx={{
    height: MAC_TITLEBAR_HEIGHT, flexShrink: 0, position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    pl: `${MAC_WINDOW_CONTROLS_WIDTH}px`, pr: 1.5,
    bgcolor: theme => theme.palette.mode === 'dark' ? '#303030' : '#e7e7e7',
    WebkitAppRegion: 'drag', userSelect: 'none'
  }}>
    <Typography component="span" sx={{
      display: { xs: 'none', sm: 'block' }, position: 'absolute',
      left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100% - 420px)',
      fontSize: 12, color: 'text.secondary', overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none'
    }}>照片相簿浏览器</Typography>
    <BrowseModeTabs compact />
  </Box>;
}
