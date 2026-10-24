import { shouldUseCollage } from '../../../src/renderer/utils/coverPolicy';

const samples = (n) => Array.from({ length: n }, (_, i) => `/img/${i}.jpg`);

describe('shouldUseCollage', () => {
  test('容器（含子文件夹）默认拼贴', () => {
    expect(shouldUseCollage({ samples: samples(4), childFolders: 3 }, 'auto')).toBe(true);
  });

  test('没有子文件夹的相册默认单图', () => {
    expect(shouldUseCollage({ samples: samples(4), childFolders: 0 }, 'auto')).toBe(false);
  });

  test('样本不足 3 张时退回单图', () => {
    expect(shouldUseCollage({ samples: samples(2), childFolders: 3 }, 'auto')).toBe(false);
    expect(shouldUseCollage({ samples: [], childFolders: 3 }, 'collage')).toBe(false);
  });

  test('设置可以强制覆盖自动判断', () => {
    expect(shouldUseCollage({ samples: samples(4), childFolders: 0 }, 'collage')).toBe(true);
    expect(shouldUseCollage({ samples: samples(4), childFolders: 3 }, 'single')).toBe(false);
  });
});
