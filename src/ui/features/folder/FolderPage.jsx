import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import { FitIcon } from '../../icons';
import useFolderSnapshot from './useFolderSnapshot';
import VirtualGrid from './VirtualGrid';
import FolderList from './FolderList';
import GridCard from './GridCard';
import ImageViewer from '../../components/ImageViewer';
import { albumImageAbsolutePath } from '../../data/album';
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

export default function FolderPage({ source, relativePath, viewMode, onViewModeChange, onOpenFolder }) {
  const { status, snapshot, items, error } = useFolderSnapshot(source, relativePath);
  const [sortKey, setSortKey] = useState('name');
  const [density, setDensity] = useState(1);
  const [selectedKey, setSelectedKey] = useState('');
  const [viewerIndex, setViewerIndex] = useState(null);
  const [deletedKeys, setDeletedKeys] = useState(() => new Set());
  const [fitMode, setFitMode] = useState(() => (
    window.localStorage.getItem(fitStorageKey(source.sourceId, relativePath)) === '1'
  ));

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

  const segments = relativePath.split('/').filter(Boolean);
  const title = segments.length > 0 ? segments[segments.length - 1] : (source?.label || '文件夹');
  const crumbs = ['文件夹', source?.label, ...segments.slice(0, -1)].filter(Boolean);
  const ready = status === 'ready';
  const formatCount = (value) => Number(value).toLocaleString('zh-CN');
  const folders = ready ? snapshot.facts.childDirectoryCount : 0;
  const totalImages = ready ? snapshot.facts.directMediaCount : 0;
  const countText = ready
    ? (folders > 0
      ? `${formatCount(folders)} 个文件夹${totalImages > 0 ? ` · ${formatCount(totalImages)} 张图片` : ''}`
      : `${formatCount(totalImages)} 张照片`)
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

  const handleOpen = (item) => {
    if (item.kind === 'folder') {
      onOpenFolder(item.relativePath);
      return;
    }
    openImageByKey(item.key);
  };

  const handleGridClick = (item) => {
    if (item.kind === 'folder') {
      onOpenFolder(item.relativePath);
      return;
    }
    openImageByKey(item.key);
  };

  useEffect(() => {
    if (viewMode !== 'list') return undefined;
    const onKey = (event) => {
      if (event.key !== 'Enter' || !selectedKey || viewerIndex !== null) return;
      const item = sorted.find((entry) => entry.key === selectedKey);
      if (item) handleOpen(item);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, selectedKey, viewerIndex, sorted]);

  const controls = (
    <>
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
        onChange={(event) => setSortKey(event.target.value)}
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
        {ready && sorted.length === 0 ? <div className="folder-state">这个文件夹是空的</div> : null}
        {ready && sorted.length > 0 && viewMode === 'grid' ? (
          <VirtualGrid
            items={sorted}
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
        {ready && sorted.length > 0 && viewMode === 'list' ? (
          <FolderList
            items={sorted}
            rootPath={source.rootPath}
            selectedKey={selectedKey}
            onSelect={(item) => setSelectedKey(item.key)}
            onOpen={handleOpen}
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
