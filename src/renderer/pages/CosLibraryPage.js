import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import BadgeIcon from '@mui/icons-material/Badge';
import CollectionsIcon from '@mui/icons-material/Collections';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import HomeIcon from '@mui/icons-material/Home';
import ImageIcon from '@mui/icons-material/Image';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import SearchIcon from '@mui/icons-material/Search';
import TheatersIcon from '@mui/icons-material/Theaters';
import { Virtuoso } from 'react-virtuoso';
import CHANNELS from '../../common/ipc-channels';
import AlbumPage from './AlbumPage';
import PageLayout from '../components/PageLayout';
import { TunePopover } from '../components/GridPageToolbar';
import { ScrollPositionContext } from '../App';
import { DEFAULT_DENSITY, GRID_CONFIG, chunkIntoRows, computeGridColumns } from '../utils/virtualGrid';
import imageCache from '../utils/ImageCacheManager';

const ipcRenderer = window.electronAPI || null;
const PAGE_SIZE = 200;
const UNKNOWN_COSER_ID = 'coser:__unknown__';
const SINGLETON_COSERS_ID = 'coser:__singletons__';

const specialEntityNames = new Map([
  [UNKNOWN_COSER_ID, '未署名'],
  [SINGLETON_COSERS_ID, '其他'],
  ['look:__mixed__', '混合造型'],
  ['look:__unspecified__', '未细分']
]);

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function entityNameFromId(id, kind) {
  if (specialEntityNames.has(id)) return specialEntityNames.get(id);
  const prefix = `${kind}:`;
  return typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : id || '';
}

function readLocationView(location) {
  if (location.state?.cosView) return location.state.cosView;

  const params = new URLSearchParams(location.search);
  if (location.pathname === '/cos/characters') return { kind: 'characters', title: '角色' };
  if (location.pathname === '/cos/cosers') return { kind: 'cosers', title: '署名' };
  if (location.pathname === '/cos/looks') {
    const id = params.get('character') || '';
    const character = { id, name: entityNameFromId(id, 'character') };
    return { kind: 'looks', title: character.name || '角色', character };
  }
  if (location.pathname === '/cos/sets') {
    const context = params.get('context') || 'all';
    const characterId = params.get('character') || '';
    const lookId = params.get('look') || '';
    const coserId = params.get('coser') || '';
    const character = characterId
      ? { id: characterId, name: entityNameFromId(characterId, 'character') }
      : null;
    const look = lookId ? { id: lookId, name: entityNameFromId(lookId, 'look') } : null;
    const coser = coserId ? { id: coserId, name: entityNameFromId(coserId, 'coser') } : null;
    const title = coser
      ? (coser.id === SINGLETON_COSERS_ID ? '其他 · 单项署名' : coser.name)
      : character
        ? `${character.name} · ${look?.name || '全部收藏'}`
        : '全部收藏';
    return { kind: 'sets', title, character, look, coser, context };
  }
  if (location.pathname === '/cos/album') {
    const from = params.get('from');
    if (from?.startsWith('/cos') && !from.startsWith('/cos/album')) {
      const parentUrl = new URL(from, 'http://cos.local');
      return readLocationView({
        pathname: parentUrl.pathname,
        search: parentUrl.search,
        state: null
      });
    }
  }
  return { kind: 'landing', title: 'Cos 图库' };
}

function locationForView(view, query = '') {
  const params = new URLSearchParams();
  let pathname = '/cos';
  if (view.kind === 'characters') pathname = '/cos/characters';
  if (view.kind === 'cosers') pathname = '/cos/cosers';
  if (view.kind === 'looks') {
    pathname = '/cos/looks';
    if (view.character?.id) params.set('character', view.character.id);
  }
  if (view.kind === 'sets') {
    pathname = '/cos/sets';
    params.set('context', view.context || 'all');
    if (view.character?.id) params.set('character', view.character.id);
    if (view.look?.id) params.set('look', view.look.id);
    if (view.coser?.id) params.set('coser', view.coser.id);
  }
  if (query) params.set('q', query);
  const search = params.toString();
  return { pathname, search: search ? `?${search}` : '' };
}

function fallbackParentView(view) {
  if (view.kind === 'characters' || view.kind === 'cosers' || view.kind === 'sets' && view.context === 'all') {
    return { kind: 'landing', title: 'Cos 图库' };
  }
  if (view.kind === 'looks') return { kind: 'characters', title: '角色' };
  if (view.kind === 'sets' && view.coser) return { kind: 'cosers', title: '署名' };
  if (view.kind === 'sets' && view.character) {
    return { kind: 'looks', title: view.character.name, character: view.character };
  }
  return { kind: 'landing', title: 'Cos 图库' };
}

function isEditableTarget(target) {
  if (!target) return false;
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable;
}

function CoverImage({ mediaId, alt }) {
  const [source, setSource] = useState(() => imageCache.get('thumbnail', mediaId) || null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  const handleError = () => {
    imageCache.deleteEntry('thumbnail', mediaId);
    setSource(null);
    if (attempt === 0) setAttempt(1);
    else setFailed(true);
  };

  useEffect(() => {
    let active = true;
    let timer;
    const cached = imageCache.get('thumbnail', mediaId);
    setSource(cached || null);
    setFailed(false);
    if (cached) return undefined;
    if (!mediaId || !ipcRenderer) return undefined;
    const load = async () => {
      try {
        const url = await ipcRenderer.invoke(CHANNELS.COS_GET_MEDIA_THUMBNAIL, mediaId);
        if (!active) return;
        if (url) setSource(url);
        else if (attempt === 0) setAttempt(1);
        else setFailed(true);
      } catch {
        if (!active) return;
        if (attempt === 0) setAttempt(1);
        else setFailed(true);
      }
    };
    if (attempt) timer = setTimeout(load, 300);
    else load();
    return () => { active = false; clearTimeout(timer); };
  }, [mediaId, attempt]);

  return (
    <Box
      sx={{
        width: '100%',
        aspectRatio: '3/4',
        bgcolor: 'action.hover',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden'
      }}
    >
      {source ? (
        <Box
          component="img"
          src={source}
          alt={alt}
          onLoad={() => imageCache.set('thumbnail', mediaId, source)}
          onError={handleError}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : failed ? (
        <Typography variant="caption" color="text.secondary">封面加载失败</Typography>
      ) : mediaId ? (
        <CircularProgress size={24} aria-label="加载封面" />
      ) : (
        <ImageIcon color="disabled" sx={{ fontSize: 42 }} />
      )}
    </Box>
  );
}

function MetadataChips({ values }) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  const visible = uniqueValues.slice(0, 2);
  const remaining = uniqueValues.length - visible.length;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, minHeight: 24, overflow: 'hidden' }}>
      {visible.map((value) => (
        <Chip key={value} label={value} size="small" sx={{ maxWidth: 112 }} />
      ))}
      {remaining > 0 ? <Chip label={`+${remaining}`} size="small" variant="outlined" /> : null}
    </Box>
  );
}

function EntityCard({ item, onClick }) {
  const countLabel = item.coserCount
    ? `${formatCount(item.coserCount)} 个署名 · ${formatCount(item.setCount)} 项`
    : `${formatCount(item.setCount)} 项`;
  return (
    <Paper
      component={ButtonBase}
      onClick={onClick}
      sx={{ width: '100%', display: 'block', textAlign: 'left', overflow: 'hidden', borderRadius: 2 }}
    >
      <CoverImage key={item.coverMediaId} mediaId={item.coverMediaId} alt={item.name} />
      <Box sx={{ p: 1.25 }}>
        <Typography noWrap fontWeight={650}>{item.name}</Typography>
        <Typography variant="caption" color="text.secondary">{countLabel}</Typography>
      </Box>
    </Paper>
  );
}

function SetCard({ item, context, onClick }) {
  const metadata = context === 'character'
    ? item.cosers
    : context === 'coser'
      ? [...item.characters, ...item.looks, ...(item.themes || []), item.type]
      : context === 'coser-group'
        ? [...item.cosers, ...item.characters, ...item.looks]
        : [...item.cosers, ...item.characters];
  return (
    <Paper
      component={ButtonBase}
      onClick={onClick}
      disabled={item.status === 'offline'}
      sx={{
        width: '100%',
        display: 'block',
        textAlign: 'left',
        overflow: 'hidden',
        borderRadius: 2,
        opacity: item.status === 'offline' ? 0.62 : 1
      }}
    >
      <CoverImage key={item.coverMediaId} mediaId={item.coverMediaId} alt={item.displayName} />
      <Box sx={{ p: 1.25, display: 'grid', gap: 0.75 }}>
        <Typography
          fontWeight={650}
          sx={{
            lineHeight: 1.35,
            minHeight: '2.7em',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden'
          }}
        >
          {item.displayName}
        </Typography>
        <MetadataChips values={metadata || []} />
        <Typography variant="caption" color="text.secondary">{formatCount(item.imageCount)} 张</Typography>
      </Box>
    </Paper>
  );
}

function LandingCard({ icon, title, count, unit = '项', subtitle, onClick }) {
  return (
    <Paper component={ButtonBase} onClick={onClick} sx={{ p: 2.5, textAlign: 'left', justifyContent: 'flex-start', borderRadius: 2 }}>
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <Box sx={{ color: 'primary.main' }}>{icon}</Box>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        <Typography variant="h5">{formatCount(count)} {unit}</Typography>
        <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
      </Box>
    </Paper>
  );
}

function CosLibraryPage({ colorMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const scrollContext = useContext(ScrollPositionContext);
  const scrollContainerRef = useRef(null);
  const virtualScrollerRef = useRef(null);
  const view = useMemo(
    () => readLocationView(location),
    [location.pathname, location.search, location.state]
  );
  const query = useMemo(
    () => new URLSearchParams(location.search).get('q') || '',
    [location.search]
  );
  const filters = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return { kind: p.get('kind') || '', type: p.get('type') || '', theme: p.get('theme') || '' };
  }, [location.search]);
  const isAlbumRoute = location.pathname === '/cos/album';
  const scrollPositionKey = `${location.pathname}${location.search}`;
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [album, setAlbum] = useState(null);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [userDensity, setUserDensityState] = useState(() => {
    const savedDensity = localStorage.getItem('userDensity');
    return savedDensity && GRID_CONFIG[savedDensity] ? savedDensity : DEFAULT_DENSITY;
  });

  const densityConfig = GRID_CONFIG[userDensity] || GRID_CONFIG[DEFAULT_DENSITY];
  const columns = useMemo(
    () => computeGridColumns(windowWidth, userDensity, { isSmallScreen }),
    [isSmallScreen, userDensity, windowWidth]
  );

  const saveScrollPosition = useCallback(() => {
    const scrollElement = virtualScrollerRef.current || scrollContainerRef.current;
    if (scrollElement) {
      scrollContext.savePosition(scrollPositionKey, scrollElement.scrollTop);
    }
  }, [scrollContext, scrollPositionKey]);

  const bindVirtualScroller = useCallback((node) => {
    virtualScrollerRef.current = node;
    if (node) {
      node.scrollTop = scrollContext.getPosition(scrollPositionKey);
    }
  }, [scrollContext, scrollPositionKey]);

  const setUserDensity = useCallback((density) => {
    if (!GRID_CONFIG[density]) return;
    setUserDensityState(density);
    localStorage.setItem('userDensity', density);
  }, []);

  const pushView = useCallback((nextView) => {
    saveScrollPosition();
    setItems([]);
    setTotal(0);
    navigate(locationForView(nextView), {
      state: {
        cosView: nextView,
        returnLocation: {
          pathname: location.pathname,
          search: location.search,
          state: location.state
        }
      }
    });
  }, [location.pathname, location.search, location.state, navigate, saveScrollPosition]);

  const goBack = useCallback(() => {
    saveScrollPosition();
    const savedDensity = localStorage.getItem('userDensity');
    if (savedDensity && GRID_CONFIG[savedDensity]) setUserDensityState(savedDensity);

    if (location.state?.returnLocation) {
      const previous = location.state.returnLocation;
      navigate({ pathname: previous.pathname, search: previous.search || '' }, { state: previous.state });
      return;
    }

    if (isAlbumRoute) {
      const from = new URLSearchParams(location.search).get('from');
      navigate(from || '/cos');
      return;
    }

    if (view.kind === 'landing') {
      navigate('/');
      return;
    }

    const previousView = fallbackParentView(view);
    navigate(locationForView(previousView), { state: { cosView: previousView } });
  }, [isAlbumRoute, location.search, location.state, navigate, saveScrollPosition, view]);

  const updateFilter = useCallback((key, value) => {
    const params = new URLSearchParams(location.search);
    if (value) params.set(key, value); else params.delete(key);
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true, state: location.state });
  }, [location, navigate]);
  const updateQuery = (value) => updateFilter('q', value);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isAlbumRoute) return;
    const savedDensity = localStorage.getItem('userDensity');
    if (savedDensity && GRID_CONFIG[savedDensity]) setUserDensityState(savedDensity);
  }, [isAlbumRoute, location.pathname]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const scrollElement = virtualScrollerRef.current || scrollContainerRef.current;
      if (scrollElement) {
        scrollElement.scrollTop = scrollContext.getPosition(scrollPositionKey);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [scrollContext, scrollPositionKey]);

  useEffect(() => {
    if (isAlbumRoute) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Backspace' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      goBack();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goBack, isAlbumRoute]);

  useEffect(() => {
    setItems([]);
    setTotal(0);
  }, [location.pathname, location.search]);

  useEffect(() => {
    let active = true;
    if (!ipcRenderer) {
      setError('Electron 接口不可用');
      setLoading(false);
      return undefined;
    }
    ipcRenderer.invoke(CHANNELS.COS_GET_STATUS)
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((reason) => {
        if (active) setError(reason?.message || '无法载入 Cos 图库');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ipcRenderer?.on) return undefined;
    const listener = (_event, payload) => setProgress(payload?.done ? null : payload);
    ipcRenderer.on(CHANNELS.COS_INDEX_PROGRESS, listener);
    return () => ipcRenderer.removeListener?.(CHANNELS.COS_INDEX_PROGRESS, listener);
  }, []);

  const requestForView = useCallback((offset = 0) => {
    if (isAlbumRoute) return null;
    const common = { query, offset, limit: PAGE_SIZE };
    if (view.kind === 'characters') return [CHANNELS.COS_LIST_CHARACTERS, common];
    if (view.kind === 'cosers') return [CHANNELS.COS_LIST_COSERS, { ...common, groupSingletons: true }];
    if (view.kind === 'looks') {
      return [CHANNELS.COS_LIST_LOOKS, { ...common, characterId: view.character.id }];
    }
    if (view.kind === 'sets') {
      return [CHANNELS.COS_LIST_SETS, {
        ...common,
        ...filters,
        characterId: view.character?.id,
        lookId: view.look?.id,
        coserId: view.coser?.id
      }];
    }
    return null;
  }, [isAlbumRoute, query, view, filters]);

  useEffect(() => {
    const request = requestForView(0);
    if (!request || !ipcRenderer || status?.state === 'empty') return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      ipcRenderer.invoke(...request)
        .then((result) => {
          if (!active) return;
          setItems(result?.items || []);
          setTotal(result?.total || 0);
        })
        .catch((reason) => {
          if (active) setError(reason?.message || '载入分类失败');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [requestForView, status?.state]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || items.length >= total) return;
    const request = requestForView(items.length);
    if (!request) return;
    setLoadingMore(true);
    ipcRenderer.invoke(...request)
      .then((result) => {
        setItems((current) => [...current, ...(result?.items || [])]);
        setTotal(result?.total || 0);
      })
      .catch((reason) => setError(reason?.message || '载入更多失败'))
      .finally(() => setLoadingMore(false));
  }, [items.length, loading, loadingMore, requestForView, total]);

  const handleSelectRoot = async () => {
    try {
      setLoading(true);
      const nextStatus = await ipcRenderer.invoke(CHANNELS.COS_SELECT_ROOT);
      setStatus(nextStatus);
    } catch (reason) {
      setError(reason?.message || '添加图库根目录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const nextStatus = await ipcRenderer.invoke(CHANNELS.COS_REFRESH);
      setStatus(nextStatus);
      if (nextStatus?.ok === false) setError('在线图库已更新；离线或读取失败的图库保留上次索引。');
    } catch (reason) {
      setError(reason?.message || '刷新索引失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveRoot = async (rootId) => {
    try {
      setStatus(await ipcRenderer.invoke(CHANNELS.COS_REMOVE_ROOT, rootId));
    } catch (reason) {
      setError(reason?.message || '移除图库根目录失败');
    }
  };

  const openSet = async (setItem) => {
    try {
      const albumPath = await ipcRenderer.invoke(CHANNELS.COS_GET_SET_ALBUM_PATH, setItem.id);
      if (!albumPath) {
        setError('套图所在磁盘当前不可用');
        return;
      }
      saveScrollPosition();
      const params = new URLSearchParams({
        set: setItem.id,
        from: `${location.pathname}${location.search}`
      });
      navigate({ pathname: '/cos/album', search: `?${params.toString()}` }, {
        state: {
          cosView: view,
          cosAlbum: setItem,
          cosAlbumPath: albumPath,
          returnLocation: {
            pathname: location.pathname,
            search: location.search,
            state: location.state
          }
        }
      });
    } catch (reason) {
      setError(reason?.message || '打开套图失败');
    }
  };

  const runSetAction = async (channel) => {
    const result = await ipcRenderer.invoke(channel, album.set.id);
    if (!result?.success) setError(result?.error || '操作失败');
  };

  useEffect(() => {
    if (!isAlbumRoute) {
      setAlbum(null);
      return undefined;
    }

    const params = new URLSearchParams(location.search);
    const setId = params.get('set');
    if (!setId) {
      setError('套图地址缺少 ID');
      return undefined;
    }

    let active = true;
    setLoading(true);
    Promise.all([
      ipcRenderer.invoke(CHANNELS.COS_GET_SET, setId),
      ipcRenderer.invoke(CHANNELS.COS_GET_SET_ALBUM_PATH, setId)
    ])
      .then(([setItem, albumPath]) => {
        if (!active) return;
        if (!albumPath) {
          setError('套图所在磁盘当前不可用');
          return;
        }
        setAlbum({ set: setItem || { id: setId, displayName: setId }, albumPath });
      })
      .catch((reason) => {
        if (active) setError(reason?.message || '打开套图失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isAlbumRoute, location.search, location.state]);

  const rows = useMemo(() => chunkIntoRows(items, columns), [columns, items]);
  const summary = status?.summary || {};
  const allSetsCard = view.kind === 'looks' && !query ? {
    id: '__all__',
    name: '全部收藏',
    setCount: view.character.setCount || 0,
    coverMediaId: view.character.coverMediaId
  } : null;

  if (isAlbumRoute && album) {
    return (
      <AlbumPage
        colorMode={colorMode}
        albumPath={album.albumPath}
        readOnly={true}
        collectionSetId={album.set.id}
        urlMode={true}
        onGoBack={goBack}
        embeddedMode={true}
        headerLeadingContent={(
          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <Tooltip title="返回上一级">
              <IconButton onClick={goBack} aria-label="返回上一级"><ArrowBackIcon /></IconButton>
            </Tooltip>
            <Typography noWrap fontWeight={700} sx={{ ml: 1 }}>
              Cos 图库 / {view.title} / {album.set.displayName}
            </Typography>
          </Box>
        )}
        headerExtraActions={(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" startIcon={<TheatersIcon />} onClick={() => runSetAction(CHANNELS.COS_OPEN_IN_PICTUREVIEW)}>
              用 PictureView 打开
            </Button>
            <Button size="small" startIcon={<FolderOpenIcon />} onClick={() => runSetAction(CHANNELS.COS_SHOW_SET_IN_FOLDER)}>
              在 Finder 中显示
            </Button>
          </Box>
        )}
      />
    );
  }

  const renderLanding = () => {
    if (status?.state === 'empty') {
      return (
        <Paper sx={{ p: 4, textAlign: 'center', maxWidth: 680, mx: 'auto', mt: 5 }}>
          <CollectionsIcon color="primary" sx={{ fontSize: 58 }} />
          <Typography variant="h5" sx={{ mt: 1 }}>建立只读 Cos 图库</Typography>
          <Typography color="text.secondary" sx={{ my: 2 }}>
            添加一个或多个包含套图文件夹与 cosset.json 的根目录。索引和缩略图只写入应用缓存。
          </Typography>
          <Button variant="contained" startIcon={<AddPhotoAlternateIcon />} onClick={handleSelectRoot}>
            添加图库根目录
          </Button>
        </Paper>
      );
    }

    return (
      <Box sx={{ display: 'grid', gap: 2.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={750}>Cos 图库</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {formatCount(summary.setCount)} 项 · {formatCount(summary.imageCount)} 张图片
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
          <LandingCard
            icon={<BadgeIcon fontSize="large" />}
            title="按角色"
            count={summary.characterCount}
            unit="个角色"
            subtitle="角色 → 服装/造型 → 套图"
            onClick={() => pushView({ kind: 'characters', title: '角色' })}
          />
          <LandingCard
            icon={<PersonSearchIcon fontSize="large" />}
            title="按署名"
            count={summary.coserCount}
            unit="个署名"
            subtitle="人物、组织与发行来源"
            onClick={() => pushView({ kind: 'cosers', title: '署名' })}
          />
          <LandingCard
            icon={<CollectionsIcon fontSize="large" />}
            title="全部收藏"
            count={summary.setCount}
            subtitle="名称、原名、署名、角色与主题搜索"
            onClick={() => pushView({ kind: 'sets', title: '全部收藏', context: 'all' })}
          />
        </Box>
        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {status?.roots?.map((root) => (
            <Chip
              key={root.id}
              label={root.label}
              color={root.status === 'online' ? 'success' : 'default'}
              variant="outlined"
              onDelete={() => handleRemoveRoot(root.id)}
            />
          ))}
          <Button size="small" startIcon={<AddPhotoAlternateIcon />} onClick={handleSelectRoot}>添加根目录</Button>
        </Paper>
      </Box>
    );
  };

  const renderGrid = () => {
    const visibleRows = allSetsCard ? [[allSetsCard], ...rows] : rows;
    if (!loading && items.length === 0 && !allSetsCard) {
      return <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 8 }}>没有匹配的项目</Typography>;
    }
    return (
      <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {formatCount(total + (allSetsCard ? 1 : 0))} 项
        </Typography>
        <Virtuoso
          style={{ flex: 1, minHeight: 0 }}
          data={visibleRows}
          scrollerRef={bindVirtualScroller}
          endReached={loadMore}
          overscan={800}
          itemContent={(_rowIndex, row) => (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${densityConfig.gap}px`,
                mb: `${densityConfig.gap}px`
              }}
            >
              {row.map((item) => {
                if (item.id === '__all__') {
                  return <EntityCard key={item.id} item={item} onClick={() => pushView({ kind: 'sets', title: `${view.character.name} · 全部收藏`, character: view.character, context: 'character' })} />;
                }
                if (view.kind === 'sets') {
                  return <SetCard key={item.id} item={item} context={view.context} onClick={() => openSet(item)} />;
                }
                return (
                  <EntityCard
                    key={item.id}
                    item={item}
                    onClick={() => {
                      if (view.kind === 'characters') pushView({ kind: 'looks', title: item.name, character: item });
                      else if (view.kind === 'cosers') {
                        const isSingletonGroup = Boolean(item.coserCount);
                        pushView({
                          kind: 'sets',
                          title: isSingletonGroup ? '其他 · 单项署名' : item.name,
                          coser: item,
                          context: isSingletonGroup ? 'coser-group' : 'coser'
                        });
                      }
                      else if (view.kind === 'looks') pushView({ kind: 'sets', title: `${view.character.name} · ${item.name}`, character: view.character, look: item, context: 'character' });
                    }}
                  />
                );
              })}
            </Box>
          )}
        />
        {loadingMore ? <CircularProgress size={22} sx={{ display: 'block', mx: 'auto', my: 2 }} /> : null}
      </Box>
    );
  };

  const header = (
    <>
      <Tooltip title={view.kind === 'landing' ? '返回照片图库' : '返回上一级'}>
        <IconButton onClick={goBack} aria-label={view.kind === 'landing' ? '返回照片图库' : '返回上一级'}>
          {view.kind === 'landing' ? <HomeIcon /> : <ArrowBackIcon />}
        </IconButton>
      </Tooltip>
      <Typography fontWeight={700} sx={{ ml: 1, whiteSpace: 'nowrap' }}>{view.title}</Typography>
      {view.kind === 'sets' ? (
        <Box sx={{ display: 'flex', gap: 1, ml: 2, flexWrap: 'wrap' }}>
          {[
            ['kind', '收藏类别', [['sets', '套图与写真'], ['collections', '散图与合集']]],
            ['type', '类型', (status?.facets?.types || []).map(v => [v,v])],
            ['theme', '主题', (status?.facets?.themes || []).map(v => [v,v])]
          ].map(([key,label,values]) => (
            <TextField key={key} select label={label} size="small" value={filters[key]}
              SelectProps={{ native: true }} InputLabelProps={{ shrink: true }}
              inputProps={{ 'aria-label': label }} sx={{ minWidth: 115, maxWidth: 200 }}
              onChange={event => updateFilter(key, event.target.value)}>
              <option value="">全部</option>
              {values.map(([value,text]) => <option key={value} value={value}>{text}</option>)}
            </TextField>
          ))}
        </Box>
      ) : null}
      <Box sx={{ flexGrow: 1 }} />
      {view.kind !== 'landing' ? (
        <TextField
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          size="small"
          placeholder="搜索当前分类"
          sx={{ width: { xs: 150, sm: 260 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
      ) : null}
      {view.kind !== 'landing' ? (
        <TunePopover
          userDensity={userDensity}
          onDensityChange={setUserDensity}
          showRandom={false}
        />
      ) : null}
      <Tooltip title="刷新 Cos 索引">
        <span><IconButton onClick={handleRefresh} disabled={!status?.roots?.length || loading}><AutorenewIcon /></IconButton></span>
      </Tooltip>
    </>
  );

  return (
    <PageLayout loading={loading} error="" headerContent={header} scrollContainerRef={scrollContainerRef}>
      {progress?.total ? (
        <Box sx={{ mb: 2 }}>
          <LinearProgress variant="determinate" value={(progress.processed / progress.total) * 100} />
          <Typography variant="caption" color="text.secondary">正在索引 {progress.processed} / {progress.total}</Typography>
        </Box>
      ) : null}
      {isAlbumRoute ? (
        <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
          <CircularProgress />
        </Box>
      ) : view.kind === 'landing' ? renderLanding() : renderGrid()}
      <Snackbar open={Boolean(error)} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </PageLayout>
  );
}

export default CosLibraryPage;
