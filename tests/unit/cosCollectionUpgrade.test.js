/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CosCatalogService } = require('../../src/main/services/CosCatalogService');
const { CosLibraryService } = require('../../src/main/services/CosLibraryService');
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-upgrade-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
function set(root, name, extra = {}, files = ['01.jpg']) {
  const p = path.join(root, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'cosset.json'), JSON.stringify({ schema: 'cosset/1', id: name, display_name: name, cosers: [], characters: [], looks: [], works: [], themes: [], type: '原创写真', ...extra }));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(p, f)), { recursive: true }); fs.writeFileSync(path.join(p, f), 'image'); }
  return p;
}
function service() { return new CosLibraryService({ configPath: path.join(dir, 'config.json'), cachePath: path.join(dir, 'cache.json') }); }
test('keeps a nested package intact, including same-name images and extended formats across a cache round trip', async () => {
 const root = path.join(dir, '300');
 const p = set(root, 'package', {}, ['Pic/01.jpg', 'Selfies/01.jpg', '02.tiff', '03.heic', '04.jfif', '.management/secret.jpg', 'movie.mp4']);
 fs.symlinkSync(path.join(p, 'Pic'), path.join(p, 'link'));
 const s = new CosCatalogService(); await s.buildIndex([{ id: 'r', path: root }]);
 expect(s.getSet('package').imageCount).toBe(5);
 const restored = new CosCatalogService(); restored.importSnapshot(s.exportSnapshot(), [{ id: 'r', path: root, status: 'online' }]);
 expect(restored.listSetMedia('package').items.map(i => restored.resolveMediaPath(i.id))).toEqual(s.listSetMedia('package').items.map(i => s.resolveMediaPath(i.id)));
 expect(new Set(restored.listSetMedia('package').items.map(i => i.id)).size).toBe(5);
});
test('searches original releases and filters source, theme and type without inventing a person', async () => {
 const root = path.join(dir, '400-Cos散图与合集');
 set(root, '公共浴室', { original_name: 'Sayo Momo NO.021 Public Bathing', themes: ['公共浴室'] });
 const s = new CosCatalogService(); await s.buildIndex([{ id: 'r', path: root }]);
 expect(s.listSets({ query: 'Public Bathing' }).total).toBe(1);
 expect(s.listSets({ kind: 'sets' }).total).toBe(0);
 expect(s.listSets({ kind: 'collections', theme: '公共浴室', type: '原创写真' }).total).toBe(1);
 expect(s.listSets({ theme: '海边' }).total).toBe(0);
 expect(s.listCosers().items[0].name).toBe('未署名');
});
test('reconnects a renamed package and media by set ID and refreshes old cache on startup', async () => {
 const root = path.join(dir, '300');const old = set(root, 'old', { id: 'stable' });
 const s = service();await s.initialize();await s.addRoot(root);
 const renamed = path.join(root, 'new');fs.renameSync(old, renamed);
 fs.renameSync(path.join(renamed,'01.jpg'), path.join(renamed,'new 01.jpg'));
 const m = JSON.parse(fs.readFileSync(path.join(renamed,'cosset.json')));m.display_name='new';fs.writeFileSync(path.join(renamed,'cosset.json'),JSON.stringify(m));
 expect(await s.resolveSetAlbumPath('stable')).toBe(renamed);
 const restored = service();await restored.initialize();
 expect(restored.getSet('stable').displayName).toBe('new');
 const page = await restored.getSetImagesPage('stable', { limit: 1 });
 expect(page).toMatchObject({ success: true, totalCount: 1, images: [{ path: path.join(renamed, 'new 01.jpg') }] });
});
test('refreshes online roots while preserving offline roots, and removes offline catalog membership', async () => {
 const a = path.join(dir,'a'), b = path.join(dir,'b');set(a,'A');set(b,'B');
 const s=service();await s.initialize();await s.addRoot(a);const added=await s.addRoot(b);
 fs.renameSync(b,b+'-offline');set(a,'C');
 await s.refresh();
 expect(s.listSets().items.map(r=>r.id).sort()).toEqual(['A','B','C']);
 expect(s.getSet('B').status).toBe('offline');
 const aId=added.roots.find(r=>r.label==='a').id;await s.removeRoot(aId);
 expect(s.listSets().items.map(r=>r.id)).toEqual(['B']);
 const restored=service();await restored.initialize();expect(restored.listSets().total).toBe(1);
});
test('serves nested media through the viewer page with sorting, searching and locate semantics', async () => {
 const root=path.join(dir,'300');const p=set(root,'package',{},['Pic/01.jpg','Selfies/01.jpg','Pic/02.jpg']);
 const s=service();await s.initialize();await s.addRoot(root);
 const page=await s.getSetImagesPage('package',{searchQuery:'Selfies',limit:1});
 expect(page).toMatchObject({success:true,totalCount:1,images:[{path:path.join(p,'Selfies/01.jpg')}]});
 const located=await s.getSetImagesPage('package',{locatePath:path.join(p,'Pic/02.jpg'),limit:1});
 expect(located.images[0].path).toBe(path.join(p,'Pic/02.jpg'));
});
test('retains the last usable online index if one metadata file becomes unreadable', async()=>{
 const root=path.join(dir,'300');const p=set(root,'package');
 const s=service();await s.initialize();await s.addRoot(root);
 fs.writeFileSync(path.join(p,'cosset.json'),'{broken');
 const status=await s.refresh();
 expect(status.ok).toBe(false);
 expect(s.getSet('package')).toMatchObject({imageCount:1,status:'online'});
});
