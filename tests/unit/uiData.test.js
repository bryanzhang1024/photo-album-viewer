import { describeSet } from '../../src/ui/data/cos';
import { fileKindLabel, formatFileSize } from '../../src/ui/data/files';
import { getFolderView, setFolderView, getFolderSort, setFolderSort } from '../../src/ui/data/prefs';

describe('新界面数据辅助函数', () => {
  test('套图卡主行去掉当前署名前缀与末尾作品括号', () => {
    const set = {
      displayName: '阿半今天很开心｜爱宕·兔女郎（碧蓝航线）',
      works: ['碧蓝航线'],
      type: 'photo',
      imageCount: 27
    };
    const text = describeSet(set, { coserName: '阿半今天很开心' });
    expect(text.name).toBe('爱宕·兔女郎');
    expect(text.meta).toBe('碧蓝航线 · 27 张');
  });

  test('查看全部作品时保留完整名字，只去末尾括号', () => {
    const set = {
      displayName: 'rioko凉凉子｜KANEKO_014（原创写真）',
      works: [],
      type: 'photo',
      imageCount: 110
    };
    const text = describeSet(set, {});
    expect(text.name).toBe('rioko凉凉子｜KANEKO_014');
    expect(text.meta).toBe('photo · 110 张');
  });

  test('非图片文件的大小与类型文案', () => {
    expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(fileKindLabel({ kind: 'video', ext: '.mp4' })).toBe('视频 · MP4');
    expect(fileKindLabel({ kind: 'archive', ext: '.zip' })).toBe('压缩包 · ZIP');
  });

  test('每个文件夹的视图与排序分别记忆', () => {
    setFolderView('src-a', '', 'list');
    setFolderView('src-a', 'album/one', 'grid');
    expect(getFolderView('src-a', '')).toBe('list');
    expect(getFolderView('src-a', 'album/one')).toBe('grid');

    setFolderSort('src-a', '', 'mtimeMs');
    expect(getFolderSort('src-a', '')).toEqual({ field: 'mtimeMs', direction: 'desc' });
    expect(getFolderSort('src-a', 'album/one')).toEqual({ field: 'name', direction: 'asc' });

    // 方向要跟着字段走，并且能单独记下来
    setFolderSort('src-a', '', { field: 'name', direction: 'desc' });
    expect(getFolderSort('src-a', '')).toEqual({ field: 'name', direction: 'desc' });
  });

  test('兼容只存字段名的旧排序值', () => {
    window.localStorage.setItem('pav.sort.v1:src-a:legacy', 'mtimeMs');
    expect(getFolderSort('src-a', 'legacy')).toEqual({ field: 'mtimeMs', direction: 'desc' });
  });
});
