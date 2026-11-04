import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/ui/App';

const SOURCE = { sourceId: 'scroll-source', label: '滚动测试', rootPath: '/scroll-fixture' };
const folder = (relativePath = '') => ({ kind: 'folder', sourceId: SOURCE.sourceId, relativePath });
const sets = Array.from({ length: 180 }, (_, i) => ({ id: `set-${i}`, displayName: `套图${String(i).padStart(3, '0')}`, imageCount: 1 }));
let removed = new Set();
let pageCap = Infinity;
let photoTotal = 300;
let photoCap = Infinity;

function installMock(locations) {
  localStorage.setItem('pav.tabs.v1', JSON.stringify({ tabs: locations.map(location => ({ history: [location], historyIndex: 0 })), activeIndex: 0 }));
  const invoke = jest.fn(async (channel, payload, pageOptions) => {
    if (channel === 'load-source-roots-v1') return { ok: true, data: { sources: [SOURCE] } };
    if (channel === 'get-directory-level-v1') {
      const directMedia = Array.from({ length: 180 }, (_, i) => ({ name: `${String(i).padStart(3, '0')}.jpg`, relativePath: `${payload.ref.relativePath ? `${payload.ref.relativePath}/` : ''}${String(i).padStart(3, '0')}.jpg`, size: 30, mtimeMs: 1 })).filter((_, i) => !removed.has(i));
      return { ok: true, data: { locator: { ...payload, absolutePath: SOURCE.rootPath }, facts: { childDirectoryCount: 0, directMediaCount: directMedia.length }, children: [], directMedia, approximate: { coverSamples: [] } } };
    }
    if (channel === 'list-directory-files-v1') return { ok: true, data: { files: [] } };
    if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
    if (channel === 'cos-get-set') return { displayName: '照片套图', locations: [] };
    if (channel === 'cos-get-set-images') {
      const images = Array.from({ length: photoTotal }, (_, i) => ({ path: `/cos/${i}.jpg`, name: `${i}.jpg`, size: 20, lastModified: 1 }));
      return { images: images.slice(pageOptions.offset, pageOptions.offset + Math.min(pageOptions.limit, photoCap)), totalCount: photoTotal, hasMore: pageOptions.offset + Math.min(pageOptions.limit, photoCap) < photoTotal };
    }
    if (channel === 'cos-list-sets') return { items: sets.slice(payload.offset, payload.offset + Math.min(payload.limit, pageCap)), total: sets.length };
    return { ok: true, data: {} };
  });
  window.electronAPI = { invoke, platform: 'darwin' };
  return invoke;
}

function viewport() { return document.querySelector('main .folder-scroll'); }
async function ready(label = '文件网格') {
  return screen.findByLabelText(label);
}
function scroll(top) {
  fireEvent.scroll(viewport(), { target: { scrollTop: top } });
}
async function switchTab(index, label = '文件网格') {
  fireEvent.click(screen.getAllByRole('tab')[index]);
  await ready(label);
}

beforeEach(() => {
  localStorage.clear();
  removed = new Set();
  pageCap = Infinity;
  photoTotal = 300;
  photoCap = Infinity;
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
    return Number.parseFloat(this.querySelector('.folder-scroll-inner')?.style.height) || 500;
  });
});
afterEach(() => jest.restoreAllMocks());

test('同一目录的两个标签分别保留位置；鼠标和 ⇧⌘] 切换均可', async () => {
  installMock([folder(), folder()]);
  render(<App />);
  await ready();
  scroll(1600);
  await switchTab(1);
  expect(viewport().scrollTop).toBe(0);
  scroll(2800);
  await switchTab(0);
  expect(viewport().scrollTop).toBe(1600);
  fireEvent.keyDown(window, { key: ']', code: 'BracketRight', metaKey: true, shiftKey: true });
  await waitFor(() => expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true'));
  await waitFor(() => expect(viewport().scrollTop).toBe(2800));
});

test('不同目录切走再回来，列表位置与对应可见行一起恢复', async () => {
  localStorage.setItem('photoViewerSettings', JSON.stringify({ defaultViewMode: 'list' }));
  installMock([folder('A'), folder('B')]);
  render(<App />);
  await ready('文件列表');
  scroll(1800);
  await switchTab(1, '文件列表');
  scroll(3400);
  await switchTab(0, '文件列表');
  expect(viewport().scrollTop).toBe(1800);
  expect(viewport().querySelector('[data-key="image:A/052.jpg"]')).toBeTruthy();
  await switchTab(1, '文件列表');
  expect(viewport().scrollTop).toBe(3400);
});

test.each([Infinity, 60])('COS 多页恢复，服务端每次最多 %s 条', async (cap) => {
  pageCap = cap;
  const invoke = installMock([{ kind: 'cos-sets', viewKind: 'all' }, folder()]);
  render(<App />);
  await ready();
  scroll(viewport().scrollHeight - 500);
  await waitFor(() => expect(invoke.mock.calls.some(([channel, arg]) => channel === 'cos-list-sets' && arg.offset === 60)).toBe(true));
  await act(async () => {});
  scroll(6200);
  await switchTab(1);
  scroll(800);
  await switchTab(0);
  await waitFor(() => expect(viewport().scrollTop).toBe(6200));
  expect(viewport().querySelector('[data-key="set-100"]')).toBeTruthy();
});

test('标签里的搜索结果位置能恢复，不因切换而清空搜索、套用到其他内容', async () => {
  installMock([folder(), folder('B')]);
  render(<App />);
  await ready();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '.jpg' } });
  await ready();
  scroll(1500);
  await switchTab(1);
  expect(screen.getByRole('searchbox')).toHaveValue('');
  await switchTab(0);
  expect(screen.getByRole('searchbox')).toHaveValue('.jpg');
  expect(viewport().scrollTop).toBe(1500);
});

test('原锚点已删除时，恢复到附近有效位置，不空白、不越界', async () => {
  installMock([folder(), folder('B')]);
  render(<App />);
  await ready();
  scroll(1600);
  await switchTab(1);
  removed = new Set([25, 26, 27, 28, 29]);
  await switchTab(0);
  expect(viewport().scrollTop).toBeGreaterThan(1000);
  expect(viewport().scrollTop).toBeLessThan(viewport().scrollHeight);
  expect(viewport().querySelectorAll('.grid-card').length).toBeGreaterThan(0);
});


test('COS 套内照片的独立分页同样恢复到第一批 120 张之后', async () => {
  installMock([{ kind: 'cos-set', setId: 'photo-set', name: '照片套图' }, folder()]);
  render(<App />);
  await ready();
  const height = viewport().scrollHeight;
  scroll(height - 500);
  await waitFor(() => expect(viewport().scrollHeight).toBeGreaterThan(height));
  scroll(10500);
  await switchTab(1);
  await switchTab(0);
  await waitFor(() => expect(viewport().scrollTop).toBe(10500));
  expect(viewport().querySelector('[data-key="/cos/180.jpg"]')).toBeTruthy();
});


test('套内超过 1000 张时，分批补足 IPC 上限之外的数据再恢复', async () => {
  photoTotal = 1500;
  photoCap = 1000;
  installMock([{ kind: 'cos-set', setId: 'large-set', name: '大套图' }, folder()]);
  render(<App />);
  await ready();
  for (let i = 0; i < 9; i++) {
    const height = viewport().scrollHeight;
    scroll(height - 500);
    await waitFor(() => expect(viewport().scrollHeight).toBeGreaterThan(height));
  }
  scroll(61000);
  await switchTab(1);
  await switchTab(0);
  await waitFor(() => expect(viewport().scrollTop).toBe(61000));
  expect(viewport().querySelector('[data-key="/cos/1040.jpg"]')).toBeTruthy();
});
