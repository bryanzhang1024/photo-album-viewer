import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Sidebar from '../../src/ui/shell/Sidebar';

const SOURCES = [
  { sourceId: 'src_300', label: '300-Cosplayer', rootPath: '/Volumes/Collection/300-Cosplayer' },
  { sourceId: 'src_collection', label: 'Collection', rootPath: '/Volumes/Collection' },
  { sourceId: 'src_collection_1tb', label: 'Collection', rootPath: '/Volumes/1TB/Collection' }
];

describe('侧栏 · 照片来源', () => {
  test('同名来源用上级目录区分，避免两条一模一样的名字', () => {
    render(<Sidebar sources={SOURCES} />);

    expect(screen.getByText('Collection · 根')).toBeInTheDocument();
    expect(screen.getByText('Collection · 1TB')).toBeInTheDocument();
    expect(screen.getByText('300-Cosplayer')).toBeInTheDocument();
  });

  test('每条来源都有移除入口，点击时把来源与锚点交给外层', async () => {
    const onRequestRemoveSource = jest.fn();
    render(<Sidebar sources={SOURCES} onRequestRemoveSource={onRequestRemoveSource} />);

    await userEvent.click(screen.getByRole('button', { name: '移除来源 300-Cosplayer' }));

    expect(onRequestRemoveSource).toHaveBeenCalledTimes(1);
    const [source, anchor] = onRequestRemoveSource.mock.calls[0];
    expect(source).toMatchObject({ sourceId: 'src_300' });
    expect(anchor).toBeInstanceOf(HTMLElement);
  });

  test('打开文件夹把触发按钮作为锚点交出去（用于三选一菜单定位）', async () => {
    const onNavigate = jest.fn();
    render(<Sidebar sources={SOURCES} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole('button', { name: '打开文件夹' }));

    const [key, anchor] = onNavigate.mock.calls[0];
    expect(key).toBe('open-folder');
    expect(anchor).toBeInstanceOf(HTMLElement);
    expect(anchor).toHaveTextContent('打开文件夹');
  });

  test('没有来源时给出可执行的提示，而不是只剩一片空白', () => {
    render(<Sidebar sources={[]} />);
    expect(screen.getByText('还没有照片来源')).toBeInTheDocument();
  });

  test('来源加载失败时把错误显示在侧栏', () => {
    render(<Sidebar sources={[]} sourceError="加载照片来源失败" />);
    expect(screen.getByText('加载照片来源失败')).toBeInTheDocument();
  });

  test('拖动来源可以调整顺序，回调拿到新的完整 id 顺序', async () => {
    const onReorderSource = jest.fn();
    render(<Sidebar sources={SOURCES} onReorderSource={onReorderSource} />);

    const rowOf = (label) => screen.getByText(label).closest('.sidebar-item-row');
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: jest.fn(),
      getData: jest.fn(() => 'src_collection_1tb')
    };

    fireEvent.dragStart(rowOf('Collection · 1TB'), { dataTransfer });
    await waitFor(() => expect(rowOf('Collection · 1TB').className).toContain('dragging'));
    fireEvent.dragOver(rowOf('300-Cosplayer'), { dataTransfer, clientY: 0 });
    fireEvent.drop(rowOf('300-Cosplayer'), { dataTransfer, clientY: 0 });

    expect(onReorderSource).toHaveBeenCalledTimes(1);
    expect(onReorderSource.mock.calls[0][0]).toEqual([
      'src_collection_1tb',
      'src_300',
      'src_collection'
    ]);
  });

  test('没有传入排序回调时来源不可拖动', () => {
    render(<Sidebar sources={SOURCES} />);
    const row = screen.getByText('300-Cosplayer').closest('.sidebar-item-row');
    expect(row.getAttribute('draggable')).toBe('false');
  });
});
