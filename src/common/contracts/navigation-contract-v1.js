const {
  getRootPathFlavor,
  isPortableRelativePath
} = require('../path-codec');

const NAVIGATION_CONTRACT_VERSION = 1;
const SOURCE_ROOT_SCHEMA_VERSION = 1;
const NAVIGATION_VIEW_MODES = Object.freeze(['browse', 'photoSet']);
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SOURCE_LABEL_LENGTH = 200;

const SOURCE_ROOT_FIELDS = new Set([
  'schemaVersion', 'sourceId', 'label', 'rootPath', 'sourceGeneration'
]);
const NAVIGATION_TARGET_FIELDS = new Set([
  'sourceId', 'relativePath', 'viewMode', 'initialMediaRelativePath'
]);
const LOAD_REQUEST_FIELDS = new Set(['contractVersion']);
const SAVE_REQUEST_FIELDS = new Set(['contractVersion', 'sourceId', 'rootPath', 'label']);
const ENVELOPE_FIELDS = new Set(['contractVersion', 'ok', 'data', 'error']);
const LIST_DATA_FIELDS = new Set(['sources']);
const SAVE_DATA_FIELDS = new Set(['source', 'created']);
const ERROR_FIELDS = new Set(['code', 'message', 'retryable', 'details']);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeSourceIdV1(sourceId) {
  if (typeof sourceId !== 'string' || !SOURCE_ID_PATTERN.test(sourceId)) return null;
  return sourceId.toLowerCase();
}

function sourceIdsEqualV1(left, right) {
  const normalizedLeft = normalizeSourceIdV1(left);
  return normalizedLeft !== null && normalizedLeft === normalizeSourceIdV1(right);
}

function addIssue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function createValidationResult(value, issues) {
  return issues.length === 0
    ? { valid: true, issues, value }
    : { valid: false, issues };
}

function readPlainRecord(value, path, issues, allowedFields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    addIssue(issues, path, 'type', 'Expected a plain record');
    return null;
  }

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (_error) {
    addIssue(issues, path, 'type', 'Record metadata could not be inspected safely');
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    addIssue(issues, path, 'type', 'Expected a plain record');
    return null;
  }

  const record = Object.create(null);
  for (const key of keys) {
    const fieldPath = typeof key === 'symbol' ? `${path}[${String(key)}]` : `${path}.${key}`;
    if (typeof key === 'symbol') {
      addIssue(issues, fieldPath, 'invariant', 'Plain records cannot own symbol fields');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
      addIssue(issues, fieldPath, 'invariant', 'Fields must be enumerable own data properties');
      continue;
    }
    if (!allowedFields.has(key)) {
      addIssue(issues, fieldPath, 'invariant', 'Unexpected canonical field');
      continue;
    }
    record[key] = descriptor.value;
  }
  return record;
}

function readDenseArray(value, path, issues) {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'type', 'Expected an array');
    return null;
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  const entries = [];
  for (const key of keys) {
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)
        || Number(key) >= value.length) {
      addIssue(issues, `${path}.${String(key)}`, 'invariant', 'Arrays cannot own extra fields');
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
      addIssue(issues, `${path}[${key}]`, 'invariant', 'Array entries must be data properties');
      continue;
    }
    entries.push({ index: Number(key), value: descriptor.value });
  }
  if (entries.length !== value.length) {
    addIssue(issues, path, 'required', 'Array entries must be dense');
  }
  entries.sort((left, right) => left.index - right.index);
  return entries;
}

function validateRequiredVersion(record, key, version, path, issues) {
  if (!hasOwn(record, key)) {
    addIssue(issues, `${path}.${key}`, 'required', `${key} is required`);
  } else if (record[key] !== version) {
    addIssue(issues, `${path}.${key}`, 'enum', `Unsupported ${key}`);
  }
}

function validateSourceId(value, path, issues, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string') {
    addIssue(issues, path, 'type', 'Source id must be a string');
  } else if (normalizeSourceIdV1(value) === null) {
    addIssue(issues, path, 'format', 'Source id must use src_<uuid-v4>');
  }
}

function validateLabel(value, path, issues, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string') {
    addIssue(issues, path, 'type', 'Label must be a string');
  } else if (value.trim().length === 0 || value.length > MAX_SOURCE_LABEL_LENGTH) {
    addIssue(issues, path, 'format', 'Label must contain 1 to 200 characters');
  }
}

function validateAbsolutePath(value, path, issues) {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'type', 'Root path must be a string');
  } else if (getRootPathFlavor(value) === null) {
    addIssue(issues, path, 'format', 'Root path must be an absolute POSIX, drive, or UNC path');
  }
}

function validatePortablePath(value, path, issues, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string') {
    addIssue(issues, path, 'type', 'Relative path must be a string');
  } else if (!isPortableRelativePath(value)) {
    addIssue(issues, path, 'format', 'Relative path must be portable');
  }
}

function validateRequiredField(record, key, path, issues, validator) {
  if (!hasOwn(record, key)) {
    addIssue(issues, `${path}.${key}`, 'required', `${key} is required`);
    return;
  }
  validator(record[key], `${path}.${key}`, issues);
}

function validateInitialMediaWithinTarget(record, path, issues) {
  if (!hasOwn(record, 'relativePath') || !hasOwn(record, 'initialMediaRelativePath')) return;

  const relativePath = record.relativePath;
  const mediaPath = record.initialMediaRelativePath;
  if (!isPortableRelativePath(relativePath) || mediaPath === null
      || !isPortableRelativePath(mediaPath)) {
    return;
  }

  if (mediaPath.length === 0) {
    addIssue(
      issues,
      `${path}.initialMediaRelativePath`,
      'invariant',
      'Initial media path must not be empty'
    );
    return;
  }

  if (relativePath && !mediaPath.startsWith(`${relativePath}/`)) {
    addIssue(
      issues,
      `${path}.initialMediaRelativePath`,
      'invariant',
      'Initial media path must be inside the target directory'
    );
  }
}

function validateSourceRootAt(value, path, issues) {
  const record = readPlainRecord(value, path, issues, SOURCE_ROOT_FIELDS);
  if (!record) return null;
  validateRequiredVersion(record, 'schemaVersion', SOURCE_ROOT_SCHEMA_VERSION, path, issues);
  validateRequiredField(record, 'sourceId', path, issues, validateSourceId);
  validateRequiredField(record, 'label', path, issues, validateLabel);
  validateRequiredField(record, 'rootPath', path, issues, validateAbsolutePath);
  validateRequiredField(record, 'sourceGeneration', path, issues, (generation, fieldPath, list) => {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      addIssue(list, fieldPath, 'format', 'Source generation must be a positive safe integer');
    }
  });
  return record;
}

function validateSourceRootV1(value) {
  const issues = [];
  validateSourceRootAt(value, '$', issues);
  return createValidationResult(value, issues);
}

function validateNavigationTargetV1(value) {
  const issues = [];
  const record = readPlainRecord(value, '$', issues, NAVIGATION_TARGET_FIELDS);
  if (!record) return createValidationResult(value, issues);
  validateRequiredField(record, 'sourceId', '$', issues, validateSourceId);
  validateRequiredField(record, 'relativePath', '$', issues, validatePortablePath);
  validateRequiredField(record, 'viewMode', '$', issues, (viewMode, path, list) => {
    if (!NAVIGATION_VIEW_MODES.includes(viewMode)) {
      addIssue(list, path, 'enum', 'Unsupported navigation view mode');
    }
  });
  validateRequiredField(
    record,
    'initialMediaRelativePath',
    '$',
    issues,
    (mediaPath, path, list) => validatePortablePath(mediaPath, path, list, { nullable: true })
  );
  validateInitialMediaWithinTarget(record, '$', issues);
  return createValidationResult(value, issues);
}

function validateLoadSourceRootsRequestV1(value) {
  const issues = [];
  const record = readPlainRecord(value, '$', issues, LOAD_REQUEST_FIELDS);
  if (record) {
    validateRequiredVersion(record, 'contractVersion', NAVIGATION_CONTRACT_VERSION, '$', issues);
  }
  return createValidationResult(value, issues);
}

function validateSaveSourceRootRequestV1(value) {
  const issues = [];
  const record = readPlainRecord(value, '$', issues, SAVE_REQUEST_FIELDS);
  if (!record) return createValidationResult(value, issues);
  validateRequiredVersion(record, 'contractVersion', NAVIGATION_CONTRACT_VERSION, '$', issues);
  validateRequiredField(record, 'sourceId', '$', issues, (sourceId, path, list) => (
    validateSourceId(sourceId, path, list, { nullable: true })
  ));
  validateRequiredField(record, 'rootPath', '$', issues, validateAbsolutePath);
  validateRequiredField(record, 'label', '$', issues, (label, path, list) => (
    validateLabel(label, path, list, { nullable: true })
  ));
  return createValidationResult(value, issues);
}

function validateSourcesArray(value, path, issues) {
  const entries = readDenseArray(value, path, issues);
  if (!entries) return;
  const sourceIds = new Set();
  for (const entry of entries) {
    const source = validateSourceRootAt(entry.value, `${path}[${entry.index}]`, issues);
    if (source && typeof source.sourceId === 'string') {
      const normalizedSourceId = normalizeSourceIdV1(source.sourceId);
      if (sourceIds.has(normalizedSourceId)) {
        addIssue(issues, `${path}[${entry.index}].sourceId`, 'invariant', 'Duplicate source id');
      }
      sourceIds.add(normalizedSourceId);
    }
  }
}

function validatePureData(value, path, issues, ancestors = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || depth > 32) {
    addIssue(issues, path, 'type', 'Expected structured-cloneable pure data');
    return;
  }
  if (ancestors.has(value)) {
    addIssue(issues, path, 'invariant', 'Pure data cannot contain cycles');
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const entries = readDenseArray(value, path, issues);
    entries?.forEach((entry) => validatePureData(
      entry.value,
      `${path}[${entry.index}]`,
      issues,
      ancestors,
      depth + 1
    ));
  } else {
    const keys = Reflect.ownKeys(value);
    const allowed = new Set(keys.filter((key) => typeof key === 'string'));
    const record = readPlainRecord(value, path, issues, allowed);
    if (record) {
      for (const key of Object.keys(record)) {
        validatePureData(record[key], `${path}.${key}`, issues, ancestors, depth + 1);
      }
    }
  }
  ancestors.delete(value);
}

function validateSuccessData(value, path, issues) {
  if (value && typeof value === 'object' && hasOwn(value, 'sources')) {
    const record = readPlainRecord(value, path, issues, LIST_DATA_FIELDS);
    if (!record) return;
    validateRequiredField(record, 'sources', path, issues, validateSourcesArray);
    return;
  }
  const record = readPlainRecord(value, path, issues, SAVE_DATA_FIELDS);
  if (!record) return;
  validateRequiredField(record, 'source', path, issues, validateSourceRootAt);
  validateRequiredField(record, 'created', path, issues, (created, fieldPath, list) => {
    if (typeof created !== 'boolean') {
      addIssue(list, fieldPath, 'type', 'created must be a boolean');
    }
  });
}

function validateError(value, path, issues) {
  const record = readPlainRecord(value, path, issues, ERROR_FIELDS);
  if (!record) return;
  for (const key of ['code', 'message']) {
    validateRequiredField(record, key, path, issues, (text, fieldPath, list) => {
      if (typeof text !== 'string' || text.length === 0) {
        addIssue(list, fieldPath, 'format', `${key} must be a non-empty string`);
      }
    });
  }
  validateRequiredField(record, 'retryable', path, issues, (retryable, fieldPath, list) => {
    if (typeof retryable !== 'boolean') {
      addIssue(list, fieldPath, 'type', 'retryable must be a boolean');
    }
  });
  if (hasOwn(record, 'details')) {
    validatePureData(record.details, `${path}.details`, issues);
  }
}

function validateSourceRootsEnvelopeV1(value) {
  const issues = [];
  const record = readPlainRecord(value, '$', issues, ENVELOPE_FIELDS);
  if (!record) return createValidationResult(value, issues);
  validateRequiredVersion(record, 'contractVersion', NAVIGATION_CONTRACT_VERSION, '$', issues);
  if (!hasOwn(record, 'ok')) {
    addIssue(issues, '$.ok', 'required', 'ok is required');
  } else if (typeof record.ok !== 'boolean') {
    addIssue(issues, '$.ok', 'type', 'ok must be a boolean');
  } else if (record.ok) {
    validateRequiredField(record, 'data', '$', issues, validateSuccessData);
    if (hasOwn(record, 'error')) {
      addIssue(issues, '$.error', 'invariant', 'Successful envelope cannot own error');
    }
  } else {
    validateRequiredField(record, 'error', '$', issues, validateError);
    if (hasOwn(record, 'data')) {
      addIssue(issues, '$.data', 'invariant', 'Failure envelope cannot own data');
    }
  }
  return createValidationResult(value, issues);
}

function createNavigationSuccessEnvelopeV1(data) {
  return { contractVersion: NAVIGATION_CONTRACT_VERSION, ok: true, data };
}

function createNavigationErrorEnvelopeV1(code, message, options = {}) {
  const error = { code, message, retryable: options.retryable ?? false };
  if (hasOwn(options, 'details')) error.details = options.details;
  return { contractVersion: NAVIGATION_CONTRACT_VERSION, ok: false, error };
}

function toCanonicalViewMode(value) {
  if (value === 'folder') return 'browse';
  if (value === 'album') return 'photoSet';
  return NAVIGATION_VIEW_MODES.includes(value) ? value : null;
}

function toLegacyViewMode(value) {
  if (value === 'browse') return 'folder';
  if (value === 'photoSet') return 'album';
  return null;
}

module.exports = {
  NAVIGATION_CONTRACT_VERSION,
  NAVIGATION_VIEW_MODES,
  SOURCE_ROOT_SCHEMA_VERSION,
  createNavigationErrorEnvelopeV1,
  createNavigationSuccessEnvelopeV1,
  normalizeSourceIdV1,
  sourceIdsEqualV1,
  toCanonicalViewMode,
  toLegacyViewMode,
  validateLoadSourceRootsRequestV1,
  validateNavigationTargetV1,
  validateSaveSourceRootRequestV1,
  validateSourceRootV1,
  validateSourceRootsEnvelopeV1
};
