import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const ipcRenderer = window.electronAPI || null;
const PAGE_SIZE = 200;

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function CoverImage({ mediaId, alt }) {
  const [source, setSource] = useState(null);

  useEffect(() => {
    let active = true;
    setSource(null);
    if (!mediaId || !ipcRenderer) return undefined;
    ipcRenderer.invoke(CHANNELS.COS_GET_MEDIA_THUMBNAIL, mediaId)
      .then((url) => {
        if (active) setSource(url || null);
      })
      .catch(() => {
        if (active) setSource(null);
      });
    return () => { active = false; };
  }, [mediaId]);

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
        <Box component="img" src={source} alt={alt} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
    ? `${formatCount(item.coserCount)} 位 · ${formatCount(item.setCount)} 套`
    : `${formatCount(item.setCount)} 套`;
  return (
    <Paper
      component={ButtonBase}
      onClick={onClick}
      sx={{ width: '100%', display: 'block', textAlign: 'left', overflow: 'hidden', borderRadius: 2 }}
    >
      <CoverImage mediaId={item.coverMediaId} alt={item.name} />
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
      ? [...item.characters, ...item.looks]
      : context === 'coser-group'
        ? [...item.cosers, ...item.characters, ...item.looks]
        : [...item.cosers, ...item.characters];
  const tooltip = [
    item.displayName,
    item.cosers?.length ? `Coser：${item.cosers.join('、')}` : '',
    item.characters?.length ? `角色：${item.characters.join('、')}` : '',
    item.looks?.length ? `造型：${item.looks.join('、')}` : '',
    item.works?.length ? `作品：${item.works.join('、')}` : ''
  ].filter(Boolean).join('\n');

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>} enterDelay={550}>
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
        <CoverImage mediaId={item.coverMediaId} alt={item.displayName} />
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
    </Tooltip>
  );
}

function LandingCard({ icon, title, count, unit = '套', subtitle, onClick }) {
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
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const isMd = useMediaQuery(theme.breakpoints.down('lg'));
  const columns = isXs ? 2 : isMd ? 4 : 6;
  const scrollContainerRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [view, setView] = useState({ kind: 'landing', title: 'Cos 图库' });
  const [history, setHistory] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [album, setAlbum] = useState(null);

  const pushView = useCallback((nextView) => {
    setHistory((current) => [...current, view]);
    setView(nextView);
    setQuery('');
    setItems([]);
    setTotal(0);
  }, [view]);

  const goBack = useCallback(() => {
    if (album) {
      setAlbum(null);
      return;
    }
    setHistory((current) => {
      const next = [...current];
      const previous = next.pop() || { kind: 'landing', title: 'Cos 图库' };
      setView(previous);
      setQuery('');
      setItems([]);
      setTotal(0);
      return next;
    });
  }, [album]);

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
    const common = { query, offset, limit: PAGE_SIZE };
    if (view.kind === 'characters') return [CHANNELS.COS_LIST_CHARACTERS, common];
    if (view.kind === 'cosers') return [CHANNELS.COS_LIST_COSERS, { ...common, groupSingletons: true }];
    if (view.kind === 'looks') {
      return [CHANNELS.COS_LIST_LOOKS, { ...common, characterId: view.character.id }];
    }
    if (view.kind === 'sets') {
      return [CHANNELS.COS_LIST_SETS, {
        ...common,
        characterId: view.character?.id,
        lookId: view.look?.id,
        coserId: view.coser?.id
      }];
    }
    return null;
  }, [query, view]);

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
      if (nextStatus?.ok === false) setError('有图库根目录离线，已保留现有索引；磁盘恢复后再刷新。');
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
      setAlbum({ set: setItem, albumPath });
    } catch (reason) {
      setError(reason?.message || '打开套图失败');
    }
  };

  const runSetAction = async (channel) => {
    const result = await ipcRenderer.invoke(channel, album.set.id);
    if (!result?.success) setError(result?.error || '操作失败');
  };

  const rows = useMemo(() => chunk(items, columns), [columns, items]);
  const summary = status?.summary || {};
  const allSetsCard = view.kind === 'looks' ? {
    id: '__all__',
    name: '全部套图',
    setCount: view.character.setCount,
    coverMediaId: view.character.coverMediaId
  } : null;

  if (album) {
    return (
      <AlbumPage
        colorMode={colorMode}
        albumPath={album.albumPath}
        readOnly={true}
        urlMode={true}
        onGoBack={goBack}
        tabsHeaderContent={(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5 }}>
            <Button size="small" startIcon={<ArrowBackIcon />} onClick={goBack}>返回 Cos 套图</Button>
            <Box sx={{ flexGrow: 1 }} />
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
            {formatCount(summary.setCount)} 套 · {formatCount(summary.imageCount)} 张图片
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
            title="按 Coser"
            count={summary.coserCount}
            unit="位 Coser"
            subtitle="Coser → ta 的全部作品"
            onClick={() => pushView({ kind: 'cosers', title: 'Coser' })}
          />
          <LandingCard
            icon={<CollectionsIcon fontSize="large" />}
            title="全部套图"
            count={summary.setCount}
            subtitle="跨名称、Coser、角色、造型与作品搜索"
            onClick={() => pushView({ kind: 'sets', title: '全部套图', context: 'all' })}
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
      <>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {formatCount(total || view.character?.setCount)} 项
        </Typography>
        <Virtuoso
          data={visibleRows}
          customScrollParent={scrollContainerRef.current || undefined}
          endReached={loadMore}
          overscan={800}
          itemContent={(_rowIndex, row) => (
            <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 1.5, mb: 1.5 }}>
              {row.map((item) => {
                if (item.id === '__all__') {
                  return <EntityCard key={item.id} item={item} onClick={() => pushView({ kind: 'sets', title: `${view.character.name} · 全部套图`, character: view.character, context: 'character' })} />;
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
                          title: isSingletonGroup ? '其他 · 单套 Coser' : item.name,
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
      </>
    );
  };

  const header = (
    <>
      <Tooltip title={history.length ? '返回上一级' : '返回照片图库'}>
        <IconButton onClick={history.length ? goBack : () => navigate('/')}>
          {history.length ? <ArrowBackIcon /> : <HomeIcon />}
        </IconButton>
      </Tooltip>
      <Typography fontWeight={700} sx={{ ml: 1, whiteSpace: 'nowrap' }}>{view.title}</Typography>
      <Box sx={{ flexGrow: 1 }} />
      {view.kind !== 'landing' ? (
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          size="small"
          placeholder="搜索当前分类"
          sx={{ width: { xs: 150, sm: 260 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
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
      {view.kind === 'landing' ? renderLanding() : renderGrid()}
      <Snackbar open={Boolean(error)} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </PageLayout>
  );
}

export default CosLibraryPage;
