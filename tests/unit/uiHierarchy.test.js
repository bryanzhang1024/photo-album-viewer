import parentLocation from '../../src/ui/data/hierarchy';

describe('页面层级 · 上一层', () => {
  test('文件夹：非根退上一级目录，根退照片来源', () => {
    expect(parentLocation({ kind: 'folder', sourceId: 'src_a', relativePath: 'a/b' }))
      .toEqual({ kind: 'folder', sourceId: 'src_a', relativePath: 'a', siblings: null });
    expect(parentLocation({ kind: 'folder', sourceId: 'src_a', relativePath: '' }))
      .toEqual({ kind: 'roots' });
  });

  test('顶层页没有上一层', () => {
    expect(parentLocation({ kind: 'roots' })).toBeNull();
    expect(parentLocation({ kind: 'favorites' })).toBeNull();
    expect(parentLocation({ kind: 'cos-home' })).toBeNull();
    expect(parentLocation(null)).toBeNull();
  });

  test('Cos 套图照片页按打开入口回对应套图列表', () => {
    expect(parentLocation({
      kind: 'cos-set',
      origin: { viewKind: 'cosers', entityId: 'e1', entityName: '半半子' }
    })).toEqual({ kind: 'cos-sets', viewKind: 'cosers', entity: { id: 'e1', name: '半半子' } });

    expect(parentLocation({ kind: 'cos-set', origin: { viewKind: 'all' } }))
      .toEqual({ kind: 'cos-sets', viewKind: 'all', entity: null });

    expect(parentLocation({ kind: 'cos-set' }))
      .toEqual({ kind: 'cos-sets', viewKind: 'all', entity: null });
  });

  test('入口信息缺署名时退回入口页，避免拼出「全部作品」错位列表', () => {
    expect(parentLocation({ kind: 'cos-set', origin: { viewKind: 'characters' } }))
      .toEqual({ kind: 'cos-characters' });
  });

  test('Cos 列表、入口页与总览的上一层', () => {
    expect(parentLocation({ kind: 'cos-sets', viewKind: 'all' })).toEqual({ kind: 'cos-home' });
    expect(parentLocation({ kind: 'cos-sets', viewKind: 'characters', entity: { id: 'c1' } }))
      .toEqual({ kind: 'cos-characters' });
    expect(parentLocation({ kind: 'cos-sets', viewKind: 'cosers', entity: { id: 'e1' } }))
      .toEqual({ kind: 'cos-cosers' });
    expect(parentLocation({ kind: 'cos-characters' })).toEqual({ kind: 'cos-home' });
    expect(parentLocation({ kind: 'cos-cosers' })).toEqual({ kind: 'cos-home' });
  });
});
