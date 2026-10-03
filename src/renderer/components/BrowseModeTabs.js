import React, { useRef } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CollectionsIcon from '@mui/icons-material/Collections';

// Existing palette and tab vocabulary; a quiet, permanent mode switch.
// Each mode resumes its semantic URL rather than restarting at its homepage.
export default function BrowseModeTabs({ compact = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const lastLocations = useRef({ browser: { pathname: '/', search: '' }, cos: { pathname: '/cos', search: '' } });
  const mode = /^\/cos(?:\/|$)/.test(location.pathname) ? 'cos' : 'browser';
  if (mode === 'cos' || ['/', '/favorites'].includes(location.pathname) || location.pathname.startsWith('/browse')) {
    lastLocations.current[mode] = { pathname: location.pathname, search: location.search, state: location.state };
  }
  return <Box component="nav" aria-label="浏览方式" sx={{ flexShrink: 0, WebkitAppRegion: 'no-drag',
    bgcolor: compact ? 'action.hover' : 'background.paper', borderRadius: compact ? 1 : 0, p: compact ? '2px' : 0 }}>
    <Tabs value={mode} onChange={(_event, next) => {
      // Existing folder/album pages save their scroll before route refs detach.
      window.dispatchEvent(new Event('browse-mode-leave'));
      const target = lastLocations.current[next];
      navigate({ pathname: target.pathname, search: target.search }, { state: target.state });
    }} sx={{ minHeight: compact ? 24 : 36,
      '& .MuiTabs-indicator': { transition: 'none', ...(compact ? { display: 'none' } : {}) },
      '& .MuiTabs-flexContainer': { gap: compact ? '2px' : 0 },
      '& .MuiTab-root': { minHeight: compact ? 24 : 36, minWidth: compact ? 0 : undefined,
        px: compact ? 1.25 : undefined, py: compact ? 0 : 0.5, textTransform: 'none',
        fontSize: compact ? 12 : '0.8rem', borderRadius: compact ? 0.75 : 0,
        '&.Mui-selected': compact ? { bgcolor: 'action.selected' } : {},
        '&:active': { bgcolor: 'action.selected' } }
    }}>
      <Tab value="browser" label={compact ? '文件夹' : '文件夹浏览'} aria-label="文件夹浏览"
        icon={compact ? undefined : <FolderOpenIcon sx={{ fontSize: 17 }} />} iconPosition="start" />
      <Tab value="cos" label="Cos 图库" icon={compact ? undefined : <CollectionsIcon sx={{ fontSize: 17 }} />} iconPosition="start" />
    </Tabs>
  </Box>;
}
