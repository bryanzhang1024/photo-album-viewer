import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import { FitIcon, ChevronLeftIcon, ChevronRightIcon, HeartIcon, SettingsIcon, SortAscIcon, SortDescIcon } from '../../icons';
import useFolderSnapshot from './useFolderSnapshot';
import useOtherFiles from './useOtherFiles';
import useBreakpoint, { isNarrowBreakpoint } from '../../hooks/useBreakpoint';
import useSettings from '../../hooks/useSettings';
import useWindowWidth from '../../hooks/useWindowWidth';
import VirtualGrid from './VirtualGrid';
import FolderList from './FolderList';
import GridCard from './GridCard';
import ImageViewer from '../../components/ImageViewer';
import Menu from '../../components/Menu';
import { albumImageAbsolutePath } from '../../data/album';
import {
  loadFavorites, isFolderFavorited, toggleFolderFavorite,
  isImageFavorited, toggleImageFavorite
} from '../../data/favorites';
import { invoke, CHANNELS } from '../../data/ipc';
import { openExternal } from '../../data/files';
import {
  getFolderSort, setFolderSort, defaultSortDirection, getFolderDensity, setFolderDensity
} from '../../data/prefs';
import './folder.css';

const SORT_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'imageCount', label: '图片' },
  { key: 'childCount', label: '子文件夹' },
  { key: 'mtimeMs', label: '修改日期' }
];

const SORT_FIELDS_PHOTO = [
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' },
  { key: 'mtimeMs', label: '修改日期' }
];

const DENSITIES = [
  { key: 'compact', minWidth: 148 },
  { key: 'standard', minWidth: 168 },
  { key: 'comfortable', minWidth: 196 }
];

import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('folder');

function fitStorageKey(sourceId, relativePath) {
  return `pav.fit.v1:${sourceId}:${relativePath}`;
}

export default function FolderPage({
  source,
  relativePath,
  viewMode,
  onViewModeChange,
  onOpenFolder,
  onOpenRoots,
  siblings = null,
  searchQuery = '',
  onSearchChange,
  onOpenInNewTab,
  onOpenInNewWindow
}) {
  const { status, snapshot, items, error, reload } = useFolderSnapshot(source, relativePath);
  const breakpoint = useBreakpoint();
  const windowWidth = useWindowWidth();
  const settings = useSettings();
  const compactHeader = viewMode === 'list' || isNarrowBreakpoint(breakpoint);
  const { files: otherFiles } = useOtherFiles(source, relativePath);
  const [sortState, setSortState] = useState(() => getFolderSort(source.sourceId, relativePath));
  const [density, setDensity] = useState(() => getFolderDensity(source.sourceId, relativePath));
  const [selectedKey, setSelectedKey] = useState('');
  const [viewerIndex, setViewerIndex] = useState(null);
  const [deletedKeys, setDeletedKeys] = useState(() => new Set());
  const [fitMode, setFitMode] = useState(() => (
    window.localStorage.getItem(fitStorageKey(source.sourceId, relativePath)) === '1'
  ));
  const [favorites, setFavorites] = useState(null);
  const [menu, setMenu] = useState(null);

  // 排序：文件夹层与照片层各用自己可用的字段；文件夹始终置顶；缺失值排最后。
  const sorted = useMemo(() => {
    const { field, direction } = sortState;
    const sign = direction === 'desc' ? -1 : 1;
    const folderField = ['name', 'imageCount', 'childCount', 'mtimeMs'].includes(field) ? field : 'name';
    const imageField = ['name', 'size', 'mtimeMs'].includes(field) ? field : 'name';

    const compareWith = (key) => (left, right) => {
      const a = left[key];
      const b = right[key];
      if (key === 'name') {
        return sign * String(a ?? '').localeCompare(String(b ?? ''), 'zh-Hans-CN', { numeric: true });
      }
      const missingA = a === undefined || a === null || Number.isNaN(a);
      const missingB = b === undefined || b === null || Number.isNaN(b);
      if (missingA && missingB) return 0;
      if (missingA) return 1;
      if (missingB) return -1;
      return sign * (a - b);
    };

    // 「混合」分组：只有名称/日期这类两层都有的字段才允许文件夹与图片混排；
    // 按张数/大小排序时仍保持文件夹在前，否则拿两种单位互相比较没有意义。
    if (settings.homeSortGrouping === 'mixed' && (field === 'name' || field === 'mtimeMs')) {
      return [...items].sort(compareWith(field));
    }
    const folders = items.filter((item) => item.kind === 'folder').sort(compareWith(folderField));
    const images = items.filter((item) => item.kind === 'image').sort(compareWith(imageField));
    return [...folders, ...images];
  }, [items, sortState, settings.homeSortGrouping]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((item) => String(item.name).toLowerCase().includes(query));
  }, [sorted, searchQuery]);

  // 搜索也覆盖非图片文件（列表「其他文件」段），与规格 D06/S09 一致。
  const filteredOtherFiles = useMemo(() => {
    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) return otherFiles;
    return otherFiles.filter((file) => String(file.name).toLowerCase().includes(query));
  }, [otherFiles, searchQuery]);

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
  // 面包屑每一级都可点：文件夹 → 照片来源根 → 中间各层；当前层只用标题展示。
  const crumbs = [
    { label: '文件夹', clickable: true },
    ...(segments.length > 0 ? [{ label: source?.label || '来源', clickable: true }] : []),
    ...segments.slice(0, -1).map((segment, index) => ({
      label: segment,
      clickable: true,
      relativePath: segments.slice(0, index + 1).join('/')
    }))
  ].filter((crumb) => crumb.label);

  const handleCrumbClick = (index) => {
    const crumb = crumbs[index];
    if (!crumb) return;
    if (index === 0) {
      onOpenRoots?.();
      return;
    }
    if (index === 1) {
      onOpenFolder('', { siblings: null });
      return;
    }
    if (typeof crumb.relativePath === 'string') {
      onOpenFolder(crumb.relativePath, { siblings: folderSiblings });
    }
  };
  const ready = status === 'ready';
  const formatCount = (value) => Number(value).toLocaleString('zh-CN');
  const folders = ready ? snapshot.facts.childDirectoryCount : 0;
  const totalImages = ready ? snapshot.facts.directMediaCount : 0;
  const otherCount = filteredOtherFiles.length;
  const searching = String(searchQuery || '').trim().length > 0;
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
    let alive = true;
    loadFavorites()
      .then((data) => {
        if (alive) setFavorites(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const itemAbsolutePath = (item) => albumImageAbsolutePath(source.rootPath, item.relativePath);
  const folderEntry = {
    path: albumPath,
    name: title,
    kind: isAlbum ? 'photoSet' : 'folder',
    imageCount: images.length,
    previewImages: images.slice(0, 4).map((image) => ({ path: image.path, name: image.name })),
    previewImagePath: images[0]?.path || ''
  };
  const favorited = isFolderFavorited(favorites, albumPath);
  const isItemFavorited = (item) => (
    item.kind === 'image'
      ? isImageFavorited(favorites, itemAbsolutePath(item))
      : isFolderFavorited(favorites, itemAbsolutePath(item))
  );
  const toggleFavorite = async () => {
    try {
      await toggleFolderFavorite(folderEntry);
      setFavorites(await loadFavorites());
    } catch (error) {
      console.warn('收藏失败:', error.message);
    }
  };
  const toggleItemFavorite = async (item) => {
    try {
      if (item.kind === 'image') {
        await toggleImageFavorite(
          { path: itemAbsolutePath(item), name: item.name, size: item.size, lastModified: item.mtimeMs },
          albumPath,
          title
        );
      } else {
        await toggleFolderFavorite({
          path: itemAbsolutePath(item),
          name: item.name,
          kind: item.childCount > 0 ? 'folder' : 'photoSet',
          imageCount: item.imageCount || 0,
          previewImages: (item.coverSamples || []).map((sample) => ({ path: sample, name: sample })),
          previewImagePath: item.coverSamples?.[0] || ''
        });
      }
      setFavorites(await loadFavorites());
    } catch (error) {
      console.warn('收藏失败:', error.message);
    }
  };

  useEffect(() => {
    const onRefresh = () => reload();
    window.addEventListener('pav:refresh', onRefresh);
    return () => window.removeEventListener('pav:refresh', onRefresh);
  }, [reload]);

  // 键盘导航：列表/网格方向键移动选中、Enter 打开、Esc 清选中；
  // 列表视图额外支持单键（C 收藏、O 在 Finder 显示、Delete 移到废纸篓）。
  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };
    const rowKeys = () => [
      ...filtered.map((item) => item.key),
      ...(viewMode === 'list' ? filteredOtherFiles.map((file) => `file:${file.name}`) : [])
    ];
    const openByKey = (key) => {
      const item = filtered.find((entry) => entry.key === key);
      if (item) {
        handleOpen(item);
        return;
      }
      const file = filteredOtherFiles.find((entry) => `file:${entry.name}` === key);
      if (file) {
        openExternal(albumImageAbsolutePath(source.rootPath, file.name))
          .catch((reason) => window.alert(reason?.message || '打开文件失败'));
      }
    };
    const moveSelection = (step) => {
      const keys = rowKeys();
      if (keys.length === 0) return;
      const current = keys.indexOf(selectedKey);
      let next;
      if (current < 0) next = step > 0 ? 0 : keys.length - 1;
      else next = Math.min(keys.length - 1, Math.max(0, current + step));
      setSelectedKey(keys[next]);
    };
    const jumpSelection = (toEnd) => {
      const keys = rowKeys();
      if (keys.length === 0) return;
      setSelectedKey(toEnd ? keys[keys.length - 1] : keys[0]);
    };
    const onKey = (event) => {
      // 查看器与输入框自己处理按键
      if (viewerIndex !== null) return;
      if (isEditableTarget(event.target)) return;

      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (event.key === 'Escape') {
        if (selectedKey) {
          setSelectedKey('');
          return;
        }
        if (searchQuery) {
          onSearchChange?.('');
          return;
        }
        const parent = segments.slice(0, -1).join('/');
        if (parent) onOpenFolder(parent, { siblings: null });
        else onOpenRoots?.();
        return;
      }
      if (!plain) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        // 列表里左右与上下等价；网格里左右是一行内的移动
        moveSelection(-1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        jumpSelection(false);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        jumpSelection(true);
        return;
      }
      if (event.key === 'Enter') {
        if (selectedKey) openByKey(selectedKey);
        return;
      }
      // R：随机打开当前文件夹里的一张图（网格/列表都可用）
      if (event.key.toLowerCase() === 'r') {
        if (images.length > 0) {
          event.preventDefault();
          setViewerIndex(Math.floor(Math.random() * images.length));
        }
        return;
      }
      if (viewMode !== 'list') return;

      const item = filtered.find((entry) => entry.key === selectedKey);
      const file = filteredOtherFiles.find((entry) => `file:${entry.name}` === selectedKey);
      if (!item && !file) return;
      const lower = event.key.toLowerCase();
      const absolutePath = item
        ? itemAbsolutePath(item)
        : albumImageAbsolutePath(source.rootPath, file.name);

      if (lower === 'c' && item) {
        event.preventDefault();
        toggleItemFavorite(item);
        return;
      }
      if (lower === 'o') {
        event.preventDefault();
        invoke(CHANNELS.SHOW_IN_FOLDER, absolutePath).catch(() => {});
        return;
      }
      if (event.key === 'Delete' && item?.kind === 'image') {
        event.preventDefault();
        if (!window.confirm('把这张图片移到废纸篓？')) return;
        invoke(CHANNELS.TRASH_IMAGE, absolutePath)
          .then((result) => {
            if (!result?.success) throw new Error(result?.error || '移到废纸篓失败');
            setDeletedKeys((prev) => new Set(prev).add(item.key));
          })
          .catch((error) => window.alert(error?.message || '移到废纸篓失败'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedKey, viewerIndex, sorted, filtered, filteredOtherFiles, viewMode, images,
    searchQuery, segments, onOpenFolder, onOpenRoots, onSearchChange,
    source.rootPath, toggleItemFavorite
  ]);

  // 选中项滚动到可视区
  useEffect(() => {
    if (!selectedKey) return;
    const selector = `[data-key="${String(selectedKey).replace(/["\\]/g, '\\$&')}"]`;
    document.querySelector(selector)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedKey]);


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
      <button className={`icon-button${favorited ? ' favorited' : ''}`} type="button"
        aria-label={isAlbum ? '收藏这个相簿' : '收藏这个文件夹'}
        aria-pressed={favorited} onClick={toggleFavorite}><HeartIcon /></button>
      <button className="icon-button" type="button" aria-label="设置"
        onClick={() => invoke(CHANNELS.OPEN_SETTINGS_WINDOW)}><SettingsIcon /></button>
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
        value={sortState.field}
        onChange={(event) => {
          const field = event.target.value;
          const next = { field, direction: defaultSortDirection(field) };
          setSortState(next);
          setFolderSort(source.sourceId, relativePath, next);
        }}
      >
        {(isAlbum ? SORT_FIELDS_PHOTO : SORT_FIELDS).map((field) => (
          <option key={field.key} value={field.key}>{field.label}</option>
        ))}
      </select>
      <button
        className="icon-button"
        type="button"
        aria-label={sortState.direction === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'}
        aria-pressed={sortState.direction === 'desc'}
        onClick={() => {
          const next = { ...sortState, direction: sortState.direction === 'asc' ? 'desc' : 'asc' };
          setSortState(next);
          setFolderSort(source.sourceId, relativePath, next);
        }}
      >
        {sortState.direction === 'asc' ? <SortAscIcon /> : <SortDescIcon />}
      </button>
      <input
        className="ctrl-range"
        type="range"
        min="0"
        max="2"
        step="1"
        value={density}
        aria-label="缩略图大小"
        onChange={(event) => {
          const next = Number(event.target.value);
          setDensity(next);
          setFolderDensity(source.sourceId, relativePath, next);
        }}
      />
    </>
  );

  const buildMenuItems = (item) => {
    if (!item) return [];
    const absolutePath = itemAbsolutePath(item);
    const favoritedNow = isItemFavorited(item);
    const items = [
      { key: 'open', label: '打开', onSelect: () => handleOpen(item) }
    ];
    if (item.kind === 'folder') {
      items.push(
        {
          key: 'new-tab',
          label: '在新标签页打开',
          onSelect: () => onOpenInNewTab?.({
            kind: 'folder',
            sourceId: source.sourceId,
            relativePath: item.relativePath
          })
        },
        {
          key: 'new-window',
          label: '在新窗口中打开',
          onSelect: () => onOpenInNewWindow?.({
            kind: 'folder',
            sourceId: source.sourceId,
            relativePath: item.relativePath
          })
        }
      );
    }
    items.push(
      {
        key: 'favorite',
        label: favoritedNow ? '取消收藏' : '添加到收藏',
        onSelect: () => toggleItemFavorite(item)
      },
      {
        key: 'reveal',
        label: '在 Finder 中显示',
        onSelect: () => {
          invoke(CHANNELS.SHOW_IN_FOLDER, absolutePath).catch(() => {});
        }
      }
    );
    return items;
  };

  return (
    <>
      <PageHeader
        variant={compactHeader ? 'compact' : 'inline'}
        crumbs={crumbs}
        title={title}
        count={countText}
        controls={controls}
        onCrumbClick={handleCrumbClick}
      />
      <div className="folder-body">
        {status === 'loading' ? <div className="folder-state">正在读取目录…</div> : null}
        {status === 'error' ? (
          <div className="folder-state error">
            <div>{error || '这个文件夹读取失败'}</div>
            <div className="fav-hint">可能是外接盘没接上、目录被删除，或没有访问权限。</div>
            <button className="btn-primary" type="button" onClick={reload}>重试</button>
          </div>
        ) : null}
        {ready && filtered.length === 0 && !searching && otherCount === 0 ? <div className="folder-state">这个文件夹是空的</div> : null}
        {ready && filtered.length === 0 && filteredOtherFiles.length === 0 && searching ? (
          <div className="folder-state">
            <div>没有找到「{String(searchQuery || '').trim()}」。</div>
            <button className="btn-primary" type="button" onClick={() => onSearchChange?.('')}>清除搜索</button>
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
            minItemWidth={windowWidth < 760
              ? Math.max(200, DENSITIES[density].minWidth)
              : DENSITIES[density].minWidth}
            renderItem={(item, width, coverHeight) => (
              <GridCard
                key={item.key}
                item={item}
                rootPath={source.rootPath}
                width={width}
                coverHeight={coverHeight}
                selected={selectedKey === item.key}
                contain={fitMode}
                showFilename={settings.showFilename}
                coverMode={settings.folderCoverMode}
                favorited={isItemFavorited(item)}
                onClick={handleGridClick}
                onToggleFavorite={toggleItemFavorite}
                onContextMenu={(event, target) => setMenu({
                  point: { x: event.clientX, y: event.clientY },
                  item: target
                })}
              />
            )}
          />
        ) : null}
        {ready && (filtered.length > 0 || filteredOtherFiles.length > 0) && viewMode === 'list' ? (
          <FolderList
            items={filtered}
            otherFiles={filteredOtherFiles}
            rootPath={source.rootPath}
            selectedKey={selectedKey}
            isPhotoLayer={isAlbum}
            sort={sortState}
            onSort={(field) => {
              const direction = sortState.field === field
                ? (sortState.direction === 'asc' ? 'desc' : 'asc')
                : defaultSortDirection(field);
              const next = { field, direction };
              setSortState(next);
              setFolderSort(source.sourceId, relativePath, next);
            }}
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
      <Menu
        open={Boolean(menu)}
        point={menu?.point}
        label="卡片菜单"
        onClose={() => setMenu(null)}
        items={menu ? buildMenuItems(menu.item) : []}
      />
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
