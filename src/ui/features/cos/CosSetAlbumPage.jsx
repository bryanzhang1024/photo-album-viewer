import React, { useEffect, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import Thumb from '../../components/Thumb';
import ImageViewer from '../../components/ImageViewer';
import { getSet, getSetImages } from '../../data/cos';
import './cos.css';

const PAGE_SIZE = 120;
const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘↑ 上一级　⌘F 搜索　⌘, 设置　⌘W 关闭标签';

/** 套内照片：网格 + 查看器（图片来自 COS_GET_SET_IMAGES，带绝对路径）。 */
export default function CosSetAlbumPage({ setId, setName }) {
  const [set, setSet] = useState(null);
  const [images, setImages] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);

  const fetchPage = (offset) => getSetImages(setId, { offset, limit: PAGE_SIZE, sortBy: 'name' });

  useEffect(() => {
    let alive = true;
    setImages([]);
    setTotal(0);
    setViewerIndex(null);
    Promise.all([
      getSet(setId).catch(() => null),
      fetchPage(0).catch(() => null)
    ]).then(([record, page]) => {
      if (!alive) return;
      setSet(record);
      setImages(page?.images || []);
      setTotal(page?.totalCount || 0);
      setHasMore(Boolean(page?.hasMore));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  const loadMore = () => {
    if (loading || !hasMore) return;
    setLoading(true);
    fetchPage(images.length)
      .then((page) => {
        setImages((prev) => [...prev, ...(page?.images || [])]);
        setTotal(page?.totalCount || 0);
        setHasMore(Boolean(page?.hasMore));
      })
      .finally(() => setLoading(false));
  };

  const title = set?.displayName || setName || '套图';
  const countText = total > 0 ? `${Number(total).toLocaleString('zh-CN')} 张照片` : '读取中…';
  const viewerImages = images.map((image) => ({
    path: image.path,
    name: image.name,
    size: image.size,
    lastModified: image.lastModified
  }));

  return (
    <>
      <PageHeader title={title} count={countText} />
      <div className="folder-body">
        <div className="cos-scroll" onScroll={(event) => {
          const el = event.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadMore();
        }}>
          <div className="cos-grid photos">
            {images.map((image, index) => (
              <button className="cos-card" type="button" key={image.path} onClick={() => setViewerIndex(index)}>
                <div className="cos-cover"><Thumb absolutePath={image.path} /></div>
                <div className="cos-name">{image.name}</div>
              </button>
            ))}
          </div>
          {loading ? <div className="cos-more">加载中…</div> : null}
        </div>
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
      {viewerIndex !== null && viewerImages[viewerIndex] ? (
        <ImageViewer
          images={viewerImages}
          initialIndex={viewerIndex}
          title={title}
          albumPath={set?.locations?.[0]?.relativePath || ''}
          albumName={title}
          onClose={() => setViewerIndex(null)}
          onDeleted={() => {}}
        />
      ) : null}
    </>
  );
}
