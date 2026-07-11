const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;
const WINDOWS_UNC_ROOT = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/;

function getRootPathFlavor(rootPath) {
  if (typeof rootPath !== 'string' || rootPath.length === 0 || rootPath.includes('\0')) {
    return null;
  }
  if (WINDOWS_DRIVE_ROOT.test(rootPath) || WINDOWS_UNC_ROOT.test(rootPath)) {
    return 'win32';
  }
  if (rootPath.startsWith('/')) {
    return 'posix';
  }
  return null;
}

function isPortableRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  if (value === '') return true;
  if (value.startsWith('/') || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    && !WINDOWS_DRIVE_PREFIX.test(segment));
}

function splitPortableRelativePath(value) {
  if (!isPortableRelativePath(value)) {
    const error = new Error('Invalid portable relative path');
    error.code = 'INVALID_RELATIVE_PATH';
    throw error;
  }
  return value === '' ? [] : value.split('/');
}

function joinPortableRelativePath(parent, childName) {
  if (!isPortableRelativePath(parent) || typeof childName !== 'string'
      || childName.length === 0 || childName.includes('/') || childName.includes('\\')
      || childName === '.' || childName === '..' || childName.includes('\0')
      || WINDOWS_DRIVE_PREFIX.test(childName)) {
    const error = new Error('Invalid portable path segment');
    error.code = 'INVALID_RELATIVE_PATH';
    throw error;
  }
  return parent ? `${parent}/${childName}` : childName;
}

module.exports = {
  getRootPathFlavor,
  isPortableRelativePath,
  joinPortableRelativePath,
  splitPortableRelativePath
};
