import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import CollectionsOutlinedIcon from '@mui/icons-material/CollectionsOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { useLocation, useNavigate } from 'react-router-dom';
import CHANNELS from '../../common/ipc-channels';
import { spacing, typography } from '../theme/tokens';

const ipcRenderer = typeof window !== 'undefined' ? (window.electronAPI || null) : null;

const SECTIONS = [
  {
    label: '浏览',
    items: [
      { key: 'folder', label: '文件夹', icon: FolderOutlinedIcon, to: '/' },
      { key: 'favorites', label: '我的收藏', icon: FavoriteBorderIcon, to: '/favorites' }
    ]
  },
  {
    label: 'Cos 图库',
    items: [
      { key: 'cos-home', label: 'Cos 图库', icon: CollectionsOutlinedIcon, to: '/cos' },
      { key: 'cos-all', label: '全部作品', icon: GridViewOutlinedIcon, to: '/cos/sets?context=all' },
      { key: 'cos-characters', label: '按角色', icon: PersonOutlineIcon, to: '/cos/characters' },
      { key: 'cos-cosers', label: '按署名', icon: PersonOutlineIcon, to: '/cos/cosers' }
    ]
  }
];

function resolveActiveKey(pathname, search) {
  if (pathname === '/' || pathname === '' || pathname === '/browse') {
    const params = new URLSearchParams(search);
    const sourceId = params.get('sourceId');
    if (sourceId) return `source:${sourceId}`;
    return 'folder';
  }
  if (pathname === '/favorites') return 'favorites';
  if (pathname === '/cos' || pathname === '/cos/') return 'cos-home';
  if (pathname === '/cos/characters') return 'cos-characters';
  if (pathname === '/cos/cosers') return 'cos-cosers';
  if (pathname.startsWith('/cos')) return 'cos-all';
  return '';
}

/**
 * 侧栏：浏览、Cos 图库入口与照片来源。
 * 收起时宽度为 0，展开/收起由外部状态控制。
 */
export default function Sidebar({ collapsed = false, onNavigate = null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sources, setSources] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!ipcRenderer) return undefined;
    ipcRenderer
      .invoke(CHANNELS.LOAD_SOURCE_ROOTS_V1, { contractVersion: 1 })
      .then((response) => {
        if (cancelled) return;
        if (response?.ok && Array.isArray(response.data?.sources)) {
          setSources(response.data.sources);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const activeKey = useMemo(
    () => resolveActiveKey(location.pathname, location.search),
    [location.pathname, location.search]
  );

  const go = (to) => {
    if (onNavigate) {
      onNavigate(to);
      return;
    }
    navigate(to);
  };

  const goToSource = (source) => {
    const params = new URLSearchParams({
      sourceId: source.sourceId || '',
      relativePath: ''
    });
    go(`/browse?${params.toString()}`);
  };

  const renderItem = (item) => {
    const Icon = item.icon;
    const active = activeKey === item.key;
    return (
      <Box
        key={item.key}
        component="button"
        type="button"
        onClick={() => go(item.to)}
        aria-current={active ? 'page' : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          width: '100%',
          height: 28,
          px: 1,
          border: 0,
          borderRadius: 1.5,
          bgcolor: active ? 'selection' : 'transparent',
          color: active ? 'text.primary' : 'text.primary',
          textAlign: 'left',
          font: 'inherit',
          fontSize: typography.body,
          cursor: 'pointer',
          '&:hover': { bgcolor: active ? 'selection' : 'hover' }
        }}
      >
        <Icon sx={{ fontSize: 15, color: 'primary.main', flexShrink: 0 }} />
        <Typography noWrap sx={{ fontSize: typography.body, minWidth: 0 }}>
          {item.label}
        </Typography>
      </Box>
    );
  };

  return (
    <Box
      component="nav"
      aria-label="侧栏"
      sx={{
        width: collapsed ? 0 : spacing.sidebarWidth,
        flexShrink: 0,
        overflow: 'hidden',
        bgcolor: 'sidebar',
        borderRight: collapsed ? 0 : 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.16s ease'
      }}
    >
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 1, px: 1 }}>
        {SECTIONS.map((section) => (
          <Box key={section.label} sx={{ mb: 1 }}>
            <Typography
              component="div"
              sx={{
                px: 1,
                pt: 1.25,
                pb: 0.5,
                fontSize: typography.caption,
                fontWeight: 600,
                color: 'dimmer'
              }}
            >
              {section.label}
            </Typography>
            {section.items.map(renderItem)}
          </Box>
        ))}
        <Box>
          <Typography
            component="div"
            sx={{ px: 1, pt: 1.25, pb: 0.5, fontSize: typography.caption, fontWeight: 600, color: 'dimmer' }}
          >
            照片来源
          </Typography>
          {sources.map((source) => {
            const key = `source:${source.sourceId}`;
            const active = activeKey === key;
            return (
              <Box
                key={key}
                component="button"
                type="button"
                onClick={() => goToSource(source)}
                aria-current={active ? 'page' : undefined}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  width: '100%',
                  height: 28,
                  px: 1,
                  border: 0,
                  borderRadius: 1.5,
                  bgcolor: active ? 'selection' : 'transparent',
                  font: 'inherit',
                  fontSize: typography.body,
                  color: 'text.primary',
                  textAlign: 'left',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: active ? 'selection' : 'hover' }
                }}
              >
                <FolderOutlinedIcon sx={{ fontSize: 15, color: 'primary.main', flexShrink: 0 }} />
                <Typography noWrap sx={{ fontSize: typography.body, minWidth: 0 }}>
                  {source.label || source.rootPath}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
