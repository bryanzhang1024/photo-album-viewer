import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RootsPage from '../../src/ui/features/roots/RootsPage';
import { recordLocation, listRecentLocations } from '../../src/ui/data/recentLocations';

const DAY = 24 * 60 * 60 * 1000;

const SOURCE_A = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };
const SOURCE_B = { sourceId: 'src_b', label: 'B-库', rootPath: '/B' };
const SOURCE_NESTED = { sourceId: 'src_n', label: 'N-库', rootPath: '/A/n' };

function child(relativePath, { images = 3, mtimeMs = Date.now() - 1000, cover = '' } = {}) {
  return {
    name: relativePath.split('/').pop(),
    ref: { sourceId: 'src_a', relativePath },
    status: 'ok',
    facts: { directMediaCount: images, childDirectoryCount: 0 },
    mtimeMs,
    approximate: { coverSamples: cover ? [cover] : [] }
  };
}

function snapshot(relativePath, children = [], directMedia = []) {
  return {
    locator: { sourceId: 'src_a', relativePath, absolutePath: relativePath ? `/A/${relativePath}` : '/A' },
    facts: {
      childDirectoryCount: children.length,
      directMediaCount: directMedia.length
    },
    children,
    directMedia,
    approximate: { coverSamples: [] }
  };
}

/**
 * 按「来源 + 相对路径」返回不同快照；也可以传函数自定义（用来模拟读失败、延迟）。
 */
function installSnapshots(resolver) {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, payload) => {
      if (channel === 'get-thumbnail') return '';
      if (channel === 'get-directory-level-v1') {
        const sourceId = payload?.ref?.sourceId;
        const relativePath = payload?.ref?.relativePath || '';
        const data = resolver({ sourceId, relativePath });
        if (data instanceof Error) throw data;
        return { ok: true, data };
      }
      return { ok: true, data: {} };
    })
  };
}

function renderPage(props = {}) {
  return render(
    <RootsPage
      sources={[SOURCE_A, SOURCE_B]}
      onOpenLocation={jest.fn()}
      onOpenFolder={jest.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.innerWidth = 1440;
});

describe('「文件夹」页 · 接着看', () => {
  test('没有记录时给空提示，不画卡', async () => {
    installSnapshots(() => snapshot(''));
    renderPage();

    expect(await screen.findByText('还没有打开过文件夹')).toBeInTheDocument();
    expect(document.querySelectorAll('.resume-card')).toHaveLength(0);
  });

  test('有记录时最多画两张，点一下带着来源与相对路径回调', async () => {
    recordLocation('src_a', '套图甲', Date.now() - 60 * 1000);
    recordLocation('src_b', '', Date.now() - 2 * 60 * 1000);
    installSnapshots(({ relativePath }) => (
      relativePath === '套图甲'
        ? snapshot('套图甲', [], [
          { name: '001.jpg', relativePath: '套图甲/001.jpg', size: 100, mtimeMs: Date.now() }
        ])
        : snapshot('')
    ));

    const onOpenLocation = jest.fn();
    renderPage({ onOpenLocation });

    const cards = await waitFor(() => {
      const found = document.querySelectorAll('.resume-card');
      expect(found).toHaveLength(2);
      return found;
    });

    // 最近打开的在前面
    expect(cards[0].textContent).toContain('套图甲');
    expect(cards[0].textContent).toContain('A-库');
    expect(cards[1].textContent).toContain('B-库');

    await userEvent.click(cards[0]);
    expect(onOpenLocation).toHaveBeenCalledWith('src_a', '套图甲');
  });

  test('记录对应的文件夹读不到时，卡片撤掉并清掉记录', async () => {
    recordLocation('src_a', '已经删掉的套图', Date.now() - 1000);
    installSnapshots(({ relativePath }) => {
      if (relativePath === '已经删掉的套图') return new Error('目录不存在');
      return snapshot('');
    });

    renderPage();

    await waitFor(() => expect(document.querySelectorAll('.resume-card')).toHaveLength(0));
    expect(listRecentLocations()).toEqual([]);
    expect(await screen.findByText('还没有打开过文件夹')).toBeInTheDocument();
  });

  test('来源已被移除时不再画它的卡', async () => {
    recordLocation('src_removed', 'x', Date.now() - 1000);
    recordLocation('src_a', '套图甲', Date.now() - 2000);
    installSnapshots(() => snapshot(''));

    renderPage();

    await waitFor(() => expect(document.querySelectorAll('.resume-card')).toHaveLength(1));
    expect(document.querySelector('.resume-card').textContent).toContain('套图甲');
  });
});

describe('「文件夹」页 · 最近有变化', () => {
  test('跨来源按修改时间合并，条数与来源都标出来', async () => {
    const now = Date.now();
    installSnapshots(({ sourceId }) => (
      sourceId === 'src_a'
        ? snapshot('', [
          child('A-新套图', { images: 29, mtimeMs: now - 60 * 1000 }),
          child('A-旧套图', { images: 5, mtimeMs: now - 8 * DAY })
        ])
        : snapshot('', [child('B-新套图', { images: 132, mtimeMs: now - 10 * 60 * 1000 })])
    ));

    renderPage();

    const rows = await waitFor(() => {
      const found = document.querySelectorAll('.feed-row:not(.feed-skeleton)');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('A-新套图');
    expect(rows[0].textContent).toContain('29 张');
    expect(rows[0].textContent).toContain('A-库');
    expect(rows[1].textContent).toContain('B-新套图');
    // 超过 7 天的不进列表
    expect(screen.queryByText('A-旧套图')).not.toBeInTheDocument();
  });

  test('点一行进入对应文件夹', async () => {
    installSnapshots(({ sourceId }) => (
      sourceId === 'src_a'
        ? snapshot('', [child('A-新套图', { images: 12, mtimeMs: Date.now() - 1000 })])
        : snapshot('')
    ));

    const onOpenLocation = jest.fn();
    renderPage({ onOpenLocation });

    const row = await screen.findByRole('button', { name: /A-新套图/ });
    await userEvent.click(row);
    expect(onOpenLocation).toHaveBeenCalledWith('src_a', 'A-新套图');
  });

  test('子目录本身是另一个来源时跳过', async () => {
    installSnapshots(({ sourceId }) => (
      sourceId === 'src_a'
        ? snapshot('', [
          child('n', { images: 3, mtimeMs: Date.now() - 1000 }),
          child('自留套图', { images: 3, mtimeMs: Date.now() - 2000 })
        ])
        : snapshot('')
    ));

    render(<RootsPage
      sources={[SOURCE_A, SOURCE_B, SOURCE_NESTED]}
      onOpenLocation={jest.fn()}
      onOpenFolder={jest.fn()}
    />);

    await waitFor(() => expect(document.querySelectorAll('.feed-row:not(.feed-skeleton)').length).toBe(1));
    const rows = document.querySelectorAll('.feed-row:not(.feed-skeleton)');
    expect(rows[0].textContent).toContain('自留套图');
  });

  test('读取中先给骨架，读不到的位置只在页脚提示', async () => {
    let pending = 0;
    installSnapshots(({ sourceId }) => {
      if (sourceId === 'src_b') {
        pending += 1;
        return new Error('外接盘未挂载');
      }
      return snapshot('');
    });

    renderPage();

    expect(await screen.findByText('1 个位置读不到')).toBeInTheDocument();
    expect(pending).toBeGreaterThan(0);
    // 两个来源都读完了，骨架应已消失
    await waitFor(() => expect(document.querySelectorAll('.feed-skeleton')).toHaveLength(0));
    expect(screen.getByText('最近 7 天没有新内容')).toBeInTheDocument();
  });

  test('页头显示今天有几个位置有改动', async () => {
    const now = Date.now();
    installSnapshots(({ sourceId }) => (
      sourceId === 'src_a'
        ? snapshot('', [child('今天的套图', { images: 3, mtimeMs: now - 60 * 1000 })])
        : snapshot('')
    ));

    renderPage();

    expect(await screen.findByText('2 个位置 · 今天 1 个有改动', { selector: '.page-header-count' }))
      .toBeInTheDocument();
  });

  test('0 个来源时仍是原来的空状态', async () => {
    installSnapshots(() => snapshot(''));
    render(<RootsPage sources={[]} onOpenLocation={jest.fn()} onOpenFolder={jest.fn()} />);

    expect((await screen.findAllByText(/还没有照片来源/)).length).toBeGreaterThan(0);
    expect(document.querySelector('.roots-body')).toBeTruthy();
  });
});

describe('「文件夹」页 · 接着看的封面规则', () => {
  test('容器目录（还有子文件夹）用 2×2 拼贴', async () => {
    recordLocation('src_a', '容器', Date.now() - 1000);
    installSnapshots(({ relativePath }) => (
      relativePath === '容器'
        ? {
          ...snapshot('容器'),
          facts: { childDirectoryCount: 2, directMediaCount: 0 },
          approximate: { coverSamples: ['容器/a.jpg', '容器/b.jpg', '容器/c.jpg', '容器/d.jpg'] }
        }
        : snapshot('')
    ));

    render(<RootsPage sources={[SOURCE_A]} onOpenLocation={jest.fn()} onOpenFolder={jest.fn()} />);

    await waitFor(() => expect(document.querySelector('.resume-card .roots-collage')).toBeTruthy());
    expect(document.querySelectorAll('.roots-collage .thumb')).toHaveLength(4);
  });

  test('单层套图用一张封面，不拼贴', async () => {
    recordLocation('src_a', '套图甲', Date.now() - 1000);
    installSnapshots(({ relativePath }) => (
      relativePath === '套图甲'
        ? {
          ...snapshot('套图甲', [], [
            { name: '001.jpg', relativePath: '套图甲/001.jpg', size: 100, mtimeMs: Date.now() }
          ]),
          facts: { childDirectoryCount: 0, directMediaCount: 1 },
          approximate: { coverSamples: ['套图甲/001.jpg', '套图甲/002.jpg', '套图甲/003.jpg'] }
        }
        : snapshot('')
    ));

    render(<RootsPage sources={[SOURCE_A]} onOpenLocation={jest.fn()} onOpenFolder={jest.fn()} />);

    await waitFor(() => expect(document.querySelector('.resume-card .thumb')).toBeTruthy());
    expect(document.querySelector('.resume-card .roots-collage')).toBeNull();
  });
});
