import React, { useRef } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CollectionsIcon from '@mui/icons-material/Collections';

// Existing palette and tab vocabulary; a quiet, permanent mode switch.
// Each mode resumes its semantic URL rather than restarting at its homepage.
export default function BrowseModeTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastLocations = useRef({ browser: { pathname: '/', search: '' }, cos: { pathname: '/cos', search: '' } });
  const mode = /^\/cos(?:\/|$)/.test(location.pathname) ? 'cos' : 'browser';
  if (mode === 'cos' || ['/', '/favorites'].includes(location.pathname) || location.pathname.startsWith('/browse')) {
    lastLocations.current[mode] = { pathname: location.pathname, search: location.search, state: location.state };
  }
  return <Box component="nav" aria-label="浏览方式" sx={{ bgcolor: 'background.paper', flexShrink: 0 }}>
    <Tabs value={mode} onChange={(_event, next) => {
      // Existing folder/album pages save their scroll before route refs detach.
      window.dispatchEvent(new Event('browse-mode-leave'));
      const target = lastLocations.current[next];
      navigate({ pathname: target.pathname, search: target.search }, { state: target.state });
    }} sx={{ minHeight: 36, '& .MuiTabs-indicator': { transition: 'none' }, '& .MuiTab-root': { minHeight: 36, py: 0.5, textTransform: 'none',
      fontSize: '0.8rem', '&:active': { bgcolor: 'action.selected' } } }}>
      <Tab value="browser" label="文件夹浏览" icon={<FolderOpenIcon sx={{ fontSize: 17 }} />} iconPosition="start" />
      <Tab value="cos" label="Cos 图库" icon={<CollectionsIcon sx={{ fontSize: 17 }} />} iconPosition="start" />
    </Tabs>
  </Box>;
}
