import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import useBreakpoint from '../../hooks/useBreakpoint';
import StatusBar from '../../shell/StatusBar';
import Thumb from '../../components/Thumb';
import ImageViewer from '../../components/ImageViewer';
import { HeartIcon, GridIcon, ListIcon, FolderIcon } from '../../icons';
import { loadFavorites, saveFavorites } from '../../data/favorites';
import './favorites.css';

const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘, 设置　⌘W 关闭标签';

function coverSamples(item) {
  if (Array.isArray(item.previewSamples) && item.previewSamples.length > 0) return item.previewSamples;
  if (Array.isArray(item.previewImages) && item.previewImages.length > 0) {
    return item.previewImages.map((preview) => preview.path).filter(Boolean);
  }
  return [];
}

function Collage({ samples }) {
  const taken = samples.slice(0, 4);
  if (taken.length === 0) {
    return <div className="fav-noCover"><FolderIcon /></div>;
  }
  return (
    <div className={`fav-collage${taken.length === 1 ? ' single' : ''}`}>
      {taken.map((sample) => (
        <div key={sample} className="fav-tile"><Thumb absolutePath={sample} /></div>
      ))}
    </div>
  );
}

export default function FavoritesPage({ onOpenFolder, onOpenImage }) {
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('folders');
  const [viewMode, setViewMode] = useState('grid');
  const [sortKey, setSortKey] = useState(() => window.localStorage.getItem('pav.favsort.field') || 'addedAt');
  const [sortDir, setSortDir] = useState(() => window.localStorage.getItem('pav.favsort.dir') || 'desc');

  useEffect(() => {
    window.localStorage.setItem('pav.favsort.field', sortKey);
    window.localStorage.setItem('pav.favsort.dir', sortDir);
  }, [sortKey, sortDir]);
  const [error, setError] = useState('');
  const [viewerIndex, setViewerIndex] = useState(null);

  const load = () => {
    loadFavorites()
      .then((value) => setData(value))
      .catch((reason) => setError(reason?.message || '读取收藏失败'));
  };

  useEffect(() => {
    load();
  }, []);

  const compare = (left, right) => {
    const sign = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'name') {
      return sign * String(left.name ?? '').localeCompare(String(right.name ?? ''), 'zh-Hans-CN', { numeric: true });
    }
    if (sortKey === 'imageCount') {
      return sign * ((Number(left.imageCount) || 0) - (Number(right.imageCount) || 0));
    }
    return sign * ((Number(left.addedAt) || 0) - (Number(right.addedAt) || 0));
  };

  const folders = useMemo(() => {
    // loadFavorites 已按路径合并 folders/albums，这里不再分类，kind 只用于展示
    const items = [...(data?.folders || []), ...(data?.albums || [])];
    return items.sort(compare);
  }, [data, sortKey, sortDir]);

  const images = useMemo(
    () => (data?.images || []).slice().sort(compare),
    [data, sortKey, sortDir]
  );

  // 收藏记录可能落在 folders 或 albums（kind 只影响分组），取消时按 id/路径在三组里都删。
  const removeItem = async (item) => {
    if (!data) return;
    const matches = (entry) => entry.id === item.id || entry.path === item.path;
    const next = {
      ...data,
      folders: (data.folders || []).filter((entry) => !matches(entry)),
      albums: (data.albums || []).filter((entry) => !matches(entry)),
      images: (data.images || []).filter((entry) => !matches(entry))
    };
    const saved = await saveFavorites(next, data.version).catch(() => false);
    if (saved) load();
  };

  const countText = data
    ? (tab === 'folders' ? `${folders.length} 个收藏` : `${images.length} 张图片`)
    : '读取中…';

  const openFolder = (item) => {
    if (!item.sourceId || typeof item.relativePath !== 'string') return;
    onOpenFolder?.(item);
  };

  return (
    <>
      <PageHeader
        variant={compactHeader ? 'compact' : 'inline'}
        title={tab === 'folders' ? '文件夹收藏' : '图片收藏'}
        count={countText}
        controls={(
          <>
            <select className="ctrl-select" aria-label="排序" value={sortKey}
              onChange={(event) => setSortKey(event.target.value)}>
              <option value="addedAt">收藏时间</option>
              <option value="name">名称</option>
              <option value="imageCount">张数</option>
            </select>
            <button
              className="icon-button"
              type="button"
              aria-label={sortDir === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'}
              aria-pressed={sortDir === 'desc'}
              onClick={() => setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'))}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
            <div className="view-toggle">
              <button type="button" aria-label="网格视图" className={viewMode === 'grid' ? 'on' : ''}
                onClick={() => setViewMode('grid')}><GridIcon /></button>
              <button type="button" aria-label="列表视图" className={viewMode === 'list' ? 'on' : ''}
                onClick={() => setViewMode('list')}><ListIcon /></button>
            </div>
          </>
        )}
      />
      <div className="folder-body">
        <div className="fav-tabs">
          <button type="button" className={tab === 'folders' ? 'on' : ''} onClick={() => setTab('folders')}>
            文件夹 {data ? folders.length : ''}
          </button>
          <button type="button" className={tab === 'images' ? 'on' : ''} onClick={() => setTab('images')}>
            图片 {data ? images.length : ''}
          </button>
        </div>

        {error ? <div className="folder-state error">{error}</div> : null}

        {tab === 'folders' ? (
          folders.length === 0 ? (
            <div className="folder-state">
              <div>还没有收藏文件夹。</div>
              <div className="fav-hint">在文件夹页点头心形按钮，或在卡片上点心形，就会出现在这里。</div>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="fav-scroll">
              <div className="fav-grid">
                {folders.map((item) => {
                  const broken = !item.sourceId || typeof item.relativePath !== 'string';
                  return (
                    <div className="fav-card" key={item.id}>
                      <button className={`fav-cover${broken ? ' broken' : ''}`} type="button"
                        onClick={() => openFolder(item)}>
                        <Collage
                          samples={item.kind === 'photoSet' || item.kind === 'album'
                            ? coverSamples(item).slice(0, 1)
                            : coverSamples(item)}
                        />
                        {broken ? <span className="fav-broken">位置不可用</span> : null}
                      </button>
                      <div className="fav-name">{item.name}</div>
                      <div className="fav-meta">
                        文件夹
                        {Number.isFinite(item.imageCount) ? ` · ${item.imageCount} 张` : ''}
                        <button className="fav-heart" type="button" aria-label="取消收藏"
                          onClick={() => removeItem(item)}>
                          <HeartIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="fav-scroll">
              <div className="fav-list">
                <div className="fav-list-head">
                  <div>名称</div><div>类型</div><div>张数</div><div>收藏时间</div><div />
                </div>
                {folders.map((item) => (
                  <div className="fav-row" key={item.id} onDoubleClick={() => openFolder(item)}>
                    <div className="fav-row-name">
                      <FolderIcon />
                      <span>{item.name}</span>
                    </div>
                    <div>文件夹</div>
                    <div>{Number.isFinite(item.imageCount) ? item.imageCount : '—'}</div>
                    <div>{item.addedAt ? new Date(item.addedAt).toLocaleDateString('zh-CN') : '—'}</div>
                    <button className="fav-heart" type="button" aria-label="取消收藏"
                      onClick={() => removeItem(item)}>
                      <HeartIcon />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          images.length === 0 ? (
            <div className="folder-state">
              <div>还没有收藏图片。</div>
              <div className="fav-hint">在图片卡片或查看器里点心形按钮，就会出现在这里。</div>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="fav-scroll">
              <div className="fav-grid photos">
                {images.map((image, index) => (
                  <div className="fav-card" key={image.id || image.path}>
                    <button className="fav-cover photo" type="button" onClick={() => setViewerIndex(index)}>
                      {image.path ? <Thumb absolutePath={image.path} /> : <div className="fav-noCover"><FolderIcon /></div>}
                    </button>
                    <div className="fav-name">{image.name}</div>
                    <div className="fav-meta">
                      {image.albumName || '图片'}
                      <button className="fav-heart" type="button" aria-label="取消收藏"
                        onClick={() => removeItem(image)}>
                        <HeartIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="fav-scroll">
              <div className="fav-list">
                <div className="fav-list-head">
                  <div>名称</div><div>类型</div><div>大小</div><div>收藏时间</div><div />
                </div>
                {images.map((image, index) => (
                  <div className="fav-row" key={image.id || image.path}
                    onDoubleClick={() => setViewerIndex(index)}>
                    <div className="fav-row-name">
                      {image.path ? <Thumb absolutePath={image.path} className="fav-row-thumb" /> : <FolderIcon />}
                      <span>{image.name}</span>
                    </div>
                    <div>{image.albumName || '图片'}</div>
                    <div>{Number.isFinite(image.size) && image.size > 0 ? `${Math.round(image.size / 1024)} KB` : '—'}</div>
                    <div>{image.addedAt ? new Date(image.addedAt).toLocaleDateString('zh-CN') : '—'}</div>
                    <button className="fav-heart" type="button" aria-label="取消收藏"
                      onClick={() => removeItem(image)}>
                      <HeartIcon />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
      {viewerIndex !== null && images[viewerIndex] ? (
        <ImageViewer
          images={images.map((image) => ({
            path: image.path,
            name: image.name,
            size: image.size,
            lastModified: image.lastModified
          }))}
          initialIndex={viewerIndex}
          title="图片收藏"
          albumPath=""
          albumName="图片收藏"
          onClose={() => setViewerIndex(null)}
          onDeleted={() => {}}
        />
      ) : null}
    </>
  );
}
