import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import { FitIcon, ChevronLeftIcon, ChevronRightIcon, HeartIcon, SettingsIcon, SearchIcon } from '../../icons';
import useFolderSnapshot from './useFolderSnapshot';
import useOtherFiles from './useOtherFiles';
import VirtualGrid from './VirtualGrid';
import FolderList from './FolderList';
import GridCard from './GridCard';
import ImageViewer from '../../components/ImageViewer';
import { albumImageAbsolutePath } from '../../data/album';
import {
  loadFavorites, isAlbumFavorited, toggleAlbumFavorite
} from '../../data/favorites';
import { invoke, CHANNELS } from '../../data/ipc';
import { openExternal } from '../../data/files';
import { getFolderSort, setFolderSort } from '../../data/prefs';
import './folder.css';

const SORT_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'imageCount', label: '图片' },
  { key: 'childCount', label: '子文件夹' },
  { key: 'mtimeMs', label: '修改日期' }
];

const DENSITIES = [
  { key: 'compact', minWidth: 148 },
  { key: 'standard', minWidth: 168 },
  { key: 'comfortable', minWidth: 196 }
];

const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘↑ 上一级　⌘F 搜索　⌘, 设置　⌘W 关闭标签';

function fitStorageKey(sourceId, relativePath) {
  return `pav.fit.v1:${sourceId}:${relativePath}`;
}

export default function FolderPage({ source, relativePath, viewMode, onViewModeChange, onOpenFolder, siblings = null }) {
  const { status, snapshot, items, error } = useFolderSnapshot(source, relativePath);
  const { files: otherFiles } = useOtherFiles(source, relativePath);
  const [sortKey, setSortKey] = useState(() => getFolderSort(source.sourceId, relativePath));
  const [density, setDensity] = useState(1);
  const [selectedKey, setSelectedKey] = useState('');
  const [viewerIndex, setViewerIndex] = useState(null);
  const [deletedKeys, setDeletedKeys] = useState(() => new Set());
  const [fitMode, setFitMode] = useState(() => (
    window.localStorage.getItem(fitStorageKey(source.sourceId, relativePath)) === '1'
  ));
  const [favorites, setFavorites] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef(null);

  const sorted = useMemo(() => {
    const compare = (left, right) => {
      const a = sortKey === 'name' ? left.name : (left[sortKey] ?? 0);
      const b = sortKey === 'name' ? right.name : (right[sortKey] ?? 0);
      if (typeof a === 'string') return a.localeCompare(b, 'zh-Hans-CN', { numeric: true });
      return a - b;
    };
    const folders = items.filter((item) => item.kind === 'folder').sort(compare);
    const images = items.filter((item) => item.kind === 'image').sort(compare);
    return [...folders, ...images];
  }, [items, sortKey]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((item) => String(item.name).toLowerCase().includes(query));
  }, [sorted, searchQuery]);

  const images = useMemo(
    () => sorted
      .filter((item) => item.kind === 'image' && !deletedKeys.has(item.key))
      .map((item) => ({
        ...item,
        path: albumImageAbsolutePath(source.rootPath, item.relativePath),
        lastModified: item.mtimeMs
      })),
    [sorted, deletedKeys, source.rootPath]
  );

  useEffect(() => {
    setSearchQuery('');
  }, [source.sourceId, relativePath]);

  const segments = relativePath.split('/').filter(Boolean);
  const title = segments.length > 0 ? segments[segments.length - 1] : (source?.label || '文件夹');
  const crumbs = segments.length > 0
    ? ['文件夹', source?.label, ...segments.slice(0, -1)].filter(Boolean)
    : ['文件夹'];
  const ready = status === 'ready';
  const formatCount = (value) => Number(value).toLocaleString('zh-CN');
  const folders = ready ? snapshot.facts.childDirectoryCount : 0;
  const totalImages = ready ? snapshot.facts.directMediaCount : 0;
  const otherCount = otherFiles.length;
  const searching = searchQuery.trim().length > 0;
  const countText = ready
    ? (searching
      ? `${formatCount(filtered.length)} 个结果 · 搜索范围：当前文件夹`
      : (folders > 0
        ? `${formatCount(folders)} 个文件夹${totalImages > 0 ? ` · ${formatCount(totalImages)} 张图片` : ''}${otherCount > 0 ? ` · ${otherCount} 个其他文件` : ''}`
        : `${formatCount(totalImages)} 张照片${otherCount > 0 ? ` · ${otherCount} 个其他文件` : ''}`))
    : status === 'error' ? '读取失败' : '读取中…';

  const toggleFit = () => {
    const next = !fitMode;
    setFitMode(next);
    window.localStorage.setItem(fitStorageKey(source.sourceId, relativePath), next ? '1' : '0');
  };

  const openImageByKey = (key) => {
    const index = images.findIndex((item) => item.key === key);
    if (index >= 0) setViewerIndex(index);
  };

  const folderSiblings = useMemo(
    () => sorted.filter((item) => item.kind === 'folder').map((item) => item.relativePath),
    [sorted]
  );

  const openFolder = (target) => {
    const keepSiblings = Array.isArray(siblings) && siblings.includes(target);
    onOpenFolder(target, { siblings: keepSiblings ? siblings : folderSiblings });
  };

  const handleOpen = (item) => {
    if (item.kind === 'folder') {
      openFolder(item.relativePath);
      return;
    }
    openImageByKey(item.key);
  };

  const handleGridClick = (item) => {
    if (item.kind === 'folder') {
      openFolder(item.relativePath);
      return;
    }
    openImageByKey(item.key);
  };

  const albumPath = albumImageAbsolutePath(source.rootPath, relativePath);
  const isAlbum = totalImages > 0 && folders === 0;
  const siblingIndex = siblings ? siblings.indexOf(relativePath) : -1;
  const canPrev = siblingIndex > 0;
  const canNext = siblingIndex >= 0 && siblingIndex < siblings.length - 1;

  useEffect(() => {
    if (!isAlbum) return undefined;
    let alive = true;
    loadFavorites()
      .then((data) => {
        if (alive) setFavorites(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAlbum, albumPath]);

  const favorited = isAlbumFavorited(favorites, albumPath);
  const toggleFavorite = async () => {
    try {
      await toggleAlbumFavorite({
        path: albumPath,
        name: title,
        imageCount: images.length,
        previewImages: images.slice(0, 4).map((image) => ({ path: image.path, name: image.name })),
        previewImagePath: images[0]?.path || ''
      });
      setFavorites(await loadFavorites());
    } catch (error) {
      console.warn('相簿收藏失败:', error.message);
    }
  };

  useEffect(() => {
    if (viewMode !== 'list') return undefined;
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.querySelector('input')?.focus();
        return;
      }
      if (event.key === 'Escape' && searchQuery) {
        setSearchQuery('');
        return;
      }
      if (event.key !== 'Enter' || !selectedKey || viewerIndex !== null) return;
      const item = sorted.find((entry) => entry.key === selectedKey);
      if (item) handleOpen(item);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, selectedKey, viewerIndex, sorted, searchQuery]);

  const controls = (
    <>
      {isAlbum ? (
        <div className="album-nav">
          <button className="icon-button" type="button" aria-label="上一套" disabled={!canPrev}
            onClick={() => canPrev && openFolder(siblings[siblingIndex - 1])}><ChevronLeftIcon /></button>
          <span className="album-pos">{siblingIndex >= 0 ? `${siblingIndex + 1} / ${siblings.length}` : ''}</span>
          <button className="icon-button" type="button" aria-label="下一套" disabled={!canNext}
            onClick={() => canNext && openFolder(siblings[siblingIndex + 1])}><ChevronRightIcon /></button>
        </div>
      ) : null}
      {isAlbum ? (
        <button className={`icon-button${favorited ? ' favorited' : ''}`} type="button" aria-label="收藏这个相簿"
          aria-pressed={favorited} onClick={toggleFavorite}><HeartIcon /></button>
      ) : null}
      <button className="icon-button" type="button" aria-label="设置"
        onClick={() => invoke(CHANNELS.OPEN_SETTINGS_WINDOW)}><SettingsIcon /></button>
      <label className="cos-search" ref={searchRef}>
        <SearchIcon />
        <input
          type="search"
          value={searchQuery}
          placeholder="搜索这个文件夹"
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </label>
      {totalImages > 0 ? (
        <button
          className={`icon-button${fitMode ? ' active' : ''}`}
          type="button"
          aria-label="完整显示"
          aria-pressed={fitMode}
          onClick={toggleFit}
        >
          <FitIcon />
        </button>
      ) : null}
      <select
        className="ctrl-select"
        aria-label="排序"
        value={sortKey}
        onChange={(event) => {
          setSortKey(event.target.value);
          setFolderSort(source.sourceId, relativePath, event.target.value);
        }}
      >
        {SORT_FIELDS.map((field) => (
          <option key={field.key} value={field.key}>{field.label}</option>
        ))}
      </select>
      <input
        className="ctrl-range"
        type="range"
        min="0"
        max="2"
        step="1"
        value={density}
        aria-label="缩略图大小"
        onChange={(event) => setDensity(Number(event.target.value))}
      />
    </>
  );

  return (
    <>
      <PageHeader
        variant={viewMode === 'list' ? 'compact' : 'inline'}
        crumbs={crumbs}
        title={title}
        count={countText}
        controls={controls}
      />
      <div className="folder-body">
        {status === 'loading' ? <div className="folder-state">正在读取目录…</div> : null}
        {status === 'error' ? <div className="folder-state error">{error}</div> : null}
        {ready && filtered.length === 0 && !searching && otherCount === 0 ? <div className="folder-state">这个文件夹是空的</div> : null}
        {ready && filtered.length === 0 && searching ? (
          <div className="folder-state">
            <div>没有找到「{searchQuery.trim()}」。</div>
            <button className="btn-primary" type="button" onClick={() => setSearchQuery('')}>清除搜索</button>
          </div>
        ) : null}
        {ready && filtered.length === 0 && !searching && otherCount > 0 && viewMode === 'grid' ? (
          <div className="folder-state">
            <div>这个文件夹里没有图片，有 {otherCount} 个其他文件。</div>
            <button className="btn-primary" type="button" onClick={() => onViewModeChange('list')}>用列表查看</button>
          </div>
        ) : null}
        {ready && filtered.length > 0 && viewMode === 'grid' ? (
          <VirtualGrid
            items={filtered}
            minItemWidth={DENSITIES[density].minWidth}
            renderItem={(item, width, coverHeight) => (
              <GridCard
                key={item.key}
                item={item}
                rootPath={source.rootPath}
                width={width}
                coverHeight={coverHeight}
                selected={selectedKey === item.key}
                contain={fitMode}
                onClick={handleGridClick}
              />
            )}
          />
        ) : null}
        {ready && filtered.length > 0 && viewMode === 'list' ? (
          <FolderList
            items={filtered}
            otherFiles={otherFiles}
            rootPath={source.rootPath}
            selectedKey={selectedKey}
            onSelect={(item) => setSelectedKey(item.key)}
            onOpen={handleOpen}
            onOpenFile={(file) => {
              openExternal(albumImageAbsolutePath(source.rootPath, file.name))
                .catch((reason) => window.alert(reason?.message || '打开文件失败'));
            }}
          />
        ) : null}
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
      {viewerIndex !== null && images[viewerIndex] ? (
        <ImageViewer
          images={images}
          initialIndex={viewerIndex}
          title={title}
          albumPath={snapshot?.locator?.absolutePath || ''}
          albumName={title}
          onClose={() => setViewerIndex(null)}
          onDeleted={(image) => {
            setDeletedKeys((prev) => new Set(prev).add(image.key));
          }}
        />
      ) : null}
    </>
  );
}
