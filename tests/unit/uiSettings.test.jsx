import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import GridCard from '../../src/ui/features/folder/GridCard';
import ImageViewer from '../../src/ui/components/ImageViewer';

function setSettings(next) {
  window.localStorage.setItem('photoViewerSettings', JSON.stringify(next));
}

const CARD = { kind: 'folder', key: 'f1', name: '套图一', relativePath: '套图一', childCount: 0, imageCount: 3, coverSamples: [] };

describe('设置真的生效', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel) => {
        if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
        return { success: true };
      })
    };
  });

  test('关掉「显示文件名」后卡片不再显示名字', () => {
    setSettings({ showFilename: false });
    render(<GridCard item={CARD} rootPath="/A" width={160} coverHeight={200} showFilename={false} />);
    expect(screen.queryByText('套图一')).not.toBeInTheDocument();
  });

  test('默认双页：查看器一打开就是双页', () => {
    setSettings({ defaultDualPageViewer: true });
    render(
      <ImageViewer
        images={[
          { path: '/A/1.jpg', name: '1.jpg' },
          { path: '/A/2.jpg', name: '2.jpg' },
          { path: '/A/3.jpg', name: '3.jpg' }
        ]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText(/1–2 \/ 3/)).toBeInTheDocument();
  });

  test('旋转方向设为逆时针时，旋转按钮转 -90 度', async () => {
    setSettings({ rotationDirection: 'left' });
    const { container } = render(
      <ImageViewer
        images={[{ path: '/A/1.jpg', name: '1.jpg' }]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '旋转' }));
    const image = container.querySelector('.viewer-image');
    expect(image.style.transform).toContain('rotate(-90deg)');
  });

  test('封面策略为「总是拼贴」时，单图文件夹也用拼贴容器', () => {
    const item = { ...CARD, childCount: 0, coverSamples: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'] };
    const { container } = render(
      <GridCard item={item} rootPath="/A" width={160} coverHeight={200} coverMode="collage" />
    );
    expect(container.querySelector('.collage')).toBeTruthy();
  });
});
