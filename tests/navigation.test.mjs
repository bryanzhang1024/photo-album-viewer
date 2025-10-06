import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(String(key), String(value));
  }

  removeItem(key) {
    this.store.delete(String(key));
  }

  clear() {
    this.store.clear();
  }
}

// Provide a predictable localStorage implementation for the module under test
global.localStorage = new MemoryStorage();

const navigation = await import('../src/renderer/utils/navigation.js');
const {
  normalizeTargetPath,
  buildBrowseUrl,
  withLastPathTracking,
  getLastPath,
  setLastPath,
  clearLastPath
} = navigation;

// normalizeTargetPath
assert.equal(normalizeTargetPath('foo/bar'), '/foo/bar');
assert.equal(normalizeTargetPath('/foo/bar'), '/foo/bar');
assert.equal(normalizeTargetPath('C:/Users/test'), 'C:/Users/test');
assert.equal(normalizeTargetPath(''), '');

// buildBrowseUrl
assert.equal(buildBrowseUrl('', 'folder'), '/browse');
assert.equal(buildBrowseUrl('/photos', 'folder'), '/browse/%2Fphotos');
assert.equal(
  buildBrowseUrl('/photos', 'album', 'cover.jpg'),
  '/browse/%2Fphotos?view=album&image=cover.jpg'
);

// lastPath tracking helpers
clearLastPath();
assert.equal(getLastPath(), '');
setLastPath('foo');
assert.equal(getLastPath(), '/foo');
setLastPath('/bar/baz');
assert.equal(getLastPath(), '/bar/baz');
setLastPath('');
assert.equal(getLastPath(), '');

// withLastPathTracking wrapper
const calls = [];
const trackedNavigate = withLastPathTracking((targetPath, options) => {
  calls.push({ targetPath, options });
});

trackedNavigate('gallery/2024', { viewMode: 'folder' });
assert.equal(getLastPath(), '/gallery/2024');
assert.deepEqual(calls[0], {
  targetPath: 'gallery/2024',
  options: { viewMode: 'folder' }
});

trackedNavigate('/gallery/2025', { viewMode: 'album', initialImage: '001.jpg' });
assert.equal(getLastPath(), '/gallery/2025');
assert.deepEqual(calls[1], {
  targetPath: '/gallery/2025',
  options: { viewMode: 'album', initialImage: '001.jpg' }
});

console.log('navigation helper tests passed');
