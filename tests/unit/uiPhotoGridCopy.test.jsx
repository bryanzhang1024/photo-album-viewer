import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import FolderPage from '../../src/ui/features/folder/FolderPage';
import CosSetAlbumPage from '../../src/ui/features/cos/CosSetAlbumPage';
import App from '../../src/ui/App';

const source = { sourceId: 'src_a', label: '照片', rootPath: '/photos' };
const names = ['1.png', '2.png', '3.png'];
function mock() {
  const listeners = new Map();
  window.electronAPI = {
    platform: 'darwin',
    getThumbnailUrl: () => null,
    on: jest.fn((channel, fn) => { listeners.set(channel, fn); return () => listeners.delete(channel); }),
    invoke: jest.fn(async (channel, ...args) => {
      if (channel === 'load-source-roots-v1') return { ok: true, data: { sources: [source] } };
      if (channel === 'get-directory-level-v1') return { ok: true, data: {
        locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/photos' },
        facts: { childDirectoryCount: 0, directMediaCount: 3 }, children: [], approximate: { coverSamples: [] },
        directMedia: names.map((name, i) => ({ relativePath: name, name, size: 100, mtimeMs: i }))
      } };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      if (channel === 'list-directory-files-v1') return { success: true, files: [] };
      if (channel === 'cos-get-set') return { id: 's1', displayName: '套图' };
      if (channel === 'cos-list-set-ids') return { ids: ['s1'] };
      if (channel === 'cos-get-set-images') return { images: names.map(name => ({ name, path: `/photos/${name}`, size: 100 })), totalCount: 3, hasMore: false };
      if (channel === 'copy-images-to-clipboard') return { success: true, count: args[0].length };
      return { ok: true, data: {} };
    })
  };
  return listeners;
}
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

test.each(['folder', 'cos'])('%s：⌘点选三张不打开查看器，复制顺序正确，普通单击仍可开大图', async kind => {
  mock();
  const page = render(kind === 'folder'
    ? <FolderPage source={source} relativePath="" viewMode="grid" onOpenFolder={jest.fn()} />
    : <CosSetAlbumPage setId="s1" setName="套图" />);
  await screen.findByText('1.png');
  for (const name of ['3.png', '1.png', '2.png']) fireEvent.click(screen.getByText(name).closest('.grid-card'), { metaKey: true });
  expect(page.container.querySelector('[role="dialog"]')).toBeNull();
  expect(page.container.querySelectorAll('.grid-card.selected')).toHaveLength(3);
  act(() => window.dispatchEvent(new CustomEvent('pav:copy-selection', { cancelable: true })));
  await waitFor(() => expect(window.electronAPI.invoke).toHaveBeenCalledWith('copy-images-to-clipboard', ['/photos/1.png', '/photos/2.png', '/photos/3.png']));
  expect(await screen.findByText('已复制 3 张原图')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  expect(page.container.querySelectorAll('.grid-card.selected')).toHaveLength(1);
  await act(async () => fireEvent.click(screen.getByText('2.png').closest('.grid-card')));
  expect(page.container.querySelector('[role="dialog"]')).toBeTruthy();
});

test('原生菜单复制命令在网格有选择时进入批量复制；输入框里仍复制文本', async () => {
  const listeners = mock();
  window.localStorage.setItem('pav.tabs.v1', JSON.stringify({ tabs: [{ history: [{ kind: 'folder', sourceId: 'src_a', relativePath: '' }], historyIndex: 0 }], activeIndex: 0 }));
  render(<App />);
  await screen.findByText('1.png');
  fireEvent.click(screen.getByText('1.png').closest('.grid-card'), { metaKey: true });
  const fallback = jest.fn();
  document.execCommand = fallback;
  act(() => listeners.get('menu-command')({ command: 'copy' }));
  await waitFor(() => expect(window.electronAPI.invoke).toHaveBeenCalledWith('copy-images-to-clipboard', ['/photos/1.png']));
  expect(fallback).not.toHaveBeenCalled();
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();
  act(() => listeners.get('menu-command')({ command: 'copy' }));
  expect(fallback).toHaveBeenCalledWith('copy');
  input.remove();
  delete document.execCommand;
});
