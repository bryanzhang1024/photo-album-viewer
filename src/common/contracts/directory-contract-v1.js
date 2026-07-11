const {
  getRootPathFlavor,
  isPortableRelativePath,
  splitPortableRelativePath
} = require('../path-codec');

const DIRECTORY_CONTRACT_VERSION = 1;
const DIRECTORY_STATUSES = Object.freeze(['ready', 'unreadable', 'missing', 'sourceOffline']);
const COMPLETENESS_STATUSES = Object.freeze(['complete', 'partial']);
const DESCENDANT_MEDIA_STATUSES = Object.freeze(['yes', 'no', 'unknown']);
const UNAVAILABLE_DIRECTORY_STATUSES = new Set(['unreadable', 'missing', 'sourceOffline']);
const MAX_PURE_DATA_DEPTH = 64;
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUEST_FIELDS = new Set(['contractVersion', 'runtimeSource', 'ref']);
const RUNTIME_SOURCE_FIELDS = new Set(['sourceId', 'rootPath']);
const DIRECTORY_REF_FIELDS = new Set(['sourceId', 'relativePath']);
const SNAPSHOT_FIELDS = new Set([
  'contractVersion', 'ref', 'locator', 'name', 'status', 'observedAt', 'revision',
  'completeness', 'facts', 'directMedia', 'children', 'approximate'
]);
const LOCATOR_FIELDS = new Set(['absolutePath']);
const ROOT_COMPLETENESS_FIELDS = new Set(['entries', 'directMedia', 'children']);
const CHILD_COMPLETENESS_FIELDS = new Set(['directMedia', 'children']);
const FACT_FIELDS = new Set(['directMediaCount', 'childDirectoryCount']);
const MEDIA_FIELDS = new Set(['relativePath', 'name', 'size', 'mtimeMs']);
const CHILD_FIELDS = new Set([
  'ref', 'name', 'status', 'completeness', 'facts', 'approximate'
]);
const APPROXIMATE_FIELDS = new Set([
  'coverSamples', 'hasDescendantMedia', 'observedAt', 'truncated'
]);
const ENVELOPE_FIELDS = new Set(['contractVersion', 'ok', 'data', 'error']);
const ERROR_FIELDS = new Set(['code', 'message', 'retryable', 'details']);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function addIssue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function createValidationResult(value, issues) {
  if (issues.length > 0) {
    return { valid: false, issues };
  }
  return { valid: true, issues, value };
}

function readPlainDataRecord(value, path, issues, allowedFields = null) {
  if (value === null || typeof value !== 'object') {
    addIssue(issues, path, 'type', 'Expected a plain record');
    return null;
  }

  let isArray;
  let prototype;
  let keys;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (_error) {
    addIssue(issues, path, 'type', 'Record metadata could not be inspected safely');
    return null;
  }
  if (isArray || (prototype !== Object.prototype && prototype !== null)) {
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

    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      addIssue(issues, fieldPath, 'invariant', 'Field descriptor could not be inspected safely');
      continue;
    }
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
      addIssue(issues, fieldPath, 'invariant', 'Fields must be enumerable own data properties');
      continue;
    }
    if (allowedFields && !allowedFields.has(key)) {
      addIssue(issues, fieldPath, 'invariant', 'Unexpected canonical field');
      continue;
    }
    record[key] = descriptor.value;
  }
  return record;
}

function isCanonicalArrayIndex(key, length) {
  if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function readDenseArray(value, path, issues) {
  let isArray;
  let keys;
  let lengthDescriptor;
  try {
    isArray = Array.isArray(value);
    keys = isArray ? Reflect.ownKeys(value) : [];
    lengthDescriptor = isArray ? Object.getOwnPropertyDescriptor(value, 'length') : null;
  } catch (_error) {
    addIssue(issues, path, 'type', 'Array metadata could not be inspected safely');
    return null;
  }
  if (!isArray || !lengthDescriptor || !hasOwn(lengthDescriptor, 'value')) {
    addIssue(issues, path, 'type', 'Expected an array');
    return null;
  }

  const length = lengthDescriptor.value;
  const entries = [];
  let indexCount = 0;
  for (const key of keys) {
    if (key === 'length') continue;
    if (!isCanonicalArrayIndex(key, length)) {
      const fieldPath = typeof key === 'symbol' ? `${path}[${String(key)}]` : `${path}.${key}`;
      addIssue(issues, fieldPath, 'invariant', 'Arrays cannot own extra fields');
      continue;
    }
    indexCount += 1;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      addIssue(issues, `${path}[${key}]`, 'invariant', 'Array entry could not be inspected safely');
      continue;
    }
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
      addIssue(issues, `${path}[${key}]`, 'invariant', 'Array entries must be enumerable data');
      continue;
    }
    entries.push({ index: Number(key), value: descriptor.value });
  }
  if (indexCount !== length) {
    addIssue(issues, path, 'required', 'Array entries must be dense');
  }
  entries.sort((left, right) => left.index - right.index);
  return { entries, length };
}

function validatePureDataAt(value, path, issues, ancestors = new WeakSet(), depth = 0) {
  if (depth > MAX_PURE_DATA_DEPTH) {
    addIssue(issues, path, 'format', `Pure-data depth cannot exceed ${MAX_PURE_DATA_DEPTH}`);
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      addIssue(issues, path, 'format', 'Pure-data numbers must be finite');
    }
    return;
  }
  if (typeof value !== 'object') {
    addIssue(issues, path, 'type', 'Expected structured-cloneable pure data');
    return;
  }
  if (ancestors.has(value)) {
    addIssue(issues, path, 'invariant', 'Pure-data details cannot contain cycles');
    return;
  }

  let isArray;
  try {
    isArray = Array.isArray(value);
  } catch (_error) {
    addIssue(issues, path, 'type', 'Pure-data value could not be inspected safely');
    return;
  }
  const array = isArray ? readDenseArray(value, path, issues) : null;
  const record = isArray ? null : readPlainDataRecord(value, path, issues);
  if ((isArray && !array) || (!isArray && !record)) return;

  ancestors.add(value);
  if (array) {
    for (const entry of array.entries) {
      validatePureDataAt(entry.value, `${path}[${entry.index}]`, issues, ancestors, depth + 1);
    }
  } else {
    for (const key of Object.keys(record)) {
      validatePureDataAt(record[key], `${path}.${key}`, issues, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function validateContractVersion(value, path, issues) {
  if (!hasOwn(value, 'contractVersion')) {
    addIssue(issues, `${path}.contractVersion`, 'required', 'Contract version is required');
    return;
  }
  if (typeof value.contractVersion !== 'number') {
    addIssue(issues, `${path}.contractVersion`, 'type', 'Contract version must be a number');
    return;
  }
  if (value.contractVersion !== DIRECTORY_CONTRACT_VERSION) {
    addIssue(issues, `${path}.contractVersion`, 'enum', 'Unsupported contract version');
  }
}

function validateSourceIdField(value, path, issues) {
  if (!hasOwn(value, 'sourceId')) {
    addIssue(issues, `${path}.sourceId`, 'required', 'Source id is required');
    return;
  }
  if (typeof value.sourceId !== 'string') {
    addIssue(issues, `${path}.sourceId`, 'type', 'Source id must be a string');
    return;
  }
  if (!SOURCE_ID_PATTERN.test(value.sourceId)) {
    addIssue(issues, `${path}.sourceId`, 'format', 'Source id must use src_<uuid-v4>');
  }
}

function validateRuntimeSourceAt(value, path, issues) {
  const record = readPlainDataRecord(value, path, issues, RUNTIME_SOURCE_FIELDS);
  if (!record) return null;
  validateSourceIdField(record, path, issues);

  if (!hasOwn(record, 'rootPath')) {
    addIssue(issues, `${path}.rootPath`, 'required', 'Root path is required');
  } else if (typeof record.rootPath !== 'string') {
    addIssue(issues, `${path}.rootPath`, 'type', 'Root path must be a string');
  } else if (getRootPathFlavor(record.rootPath) === null) {
    addIssue(issues, `${path}.rootPath`, 'format', 'Root path must be an absolute POSIX or Windows path');
  }
  return record;
}

function validateDirectoryRefAt(value, path, issues) {
  const record = readPlainDataRecord(value, path, issues, DIRECTORY_REF_FIELDS);
  if (!record) return null;
  validateSourceIdField(record, path, issues);

  if (!hasOwn(record, 'relativePath')) {
    addIssue(issues, `${path}.relativePath`, 'required', 'Relative path is required');
  } else if (typeof record.relativePath !== 'string') {
    addIssue(issues, `${path}.relativePath`, 'type', 'Relative path must be a string');
  } else if (!isPortableRelativePath(record.relativePath)) {
    addIssue(issues, `${path}.relativePath`, 'format', 'Relative path must be portable');
  }
  return record;
}

function validateRequiredObjectField(value, key, path, issues, validator) {
  const fieldPath = `${path}.${key}`;
  if (!hasOwn(value, key)) {
    addIssue(issues, fieldPath, 'required', `${key} is required`);
    return null;
  }
  return validator(value[key], fieldPath, issues);
}

function validateRequiredNonEmptyString(value, key, path, issues) {
  const fieldPath = `${path}.${key}`;
  if (!hasOwn(value, key)) {
    addIssue(issues, fieldPath, 'required', `${key} is required`);
  } else if (typeof value[key] !== 'string') {
    addIssue(issues, fieldPath, 'type', `${key} must be a string`);
  } else if (value[key].length === 0) {
    addIssue(issues, fieldPath, 'format', `${key} must not be empty`);
  }
}

function validateRequiredNonNegativeNumber(value, key, path, issues) {
  const fieldPath = `${path}.${key}`;
  if (!hasOwn(value, key)) {
    addIssue(issues, fieldPath, 'required', `${key} is required`);
  } else if (typeof value[key] !== 'number') {
    addIssue(issues, fieldPath, 'type', `${key} must be a number`);
  } else if (!Number.isFinite(value[key]) || value[key] < 0) {
    addIssue(issues, fieldPath, 'format', `${key} must be a non-negative finite number`);
  }
}

function validateRequiredFiniteNumber(value, key, path, issues) {
  const fieldPath = `${path}.${key}`;
  if (!hasOwn(value, key)) {
    addIssue(issues, fieldPath, 'required', `${key} is required`);
  } else if (typeof value[key] !== 'number') {
    addIssue(issues, fieldPath, 'type', `${key} must be a number`);
  } else if (!Number.isFinite(value[key])) {
    addIssue(issues, fieldPath, 'format', `${key} must be a finite number`);
  }
}

function validateRequiredNonNegativeInteger(value, key, path, issues) {
  const fieldPath = `${path}.${key}`;
  if (!hasOwn(value, key)) {
    addIssue(issues, fieldPath, 'required', `${key} is required`);
  } else if (typeof value[key] !== 'number') {
    addIssue(issues, fieldPath, 'type', `${key} must be a number`);
  } else if (!Number.isInteger(value[key]) || value[key] < 0) {
    addIssue(issues, fieldPath, 'format', `${key} must be a non-negative integer`);
  }
}

function validateRequiredEnum(value, key, path, allowedValues, issues) {
  const fieldPath = `${path}.${key}`;
  if (!hasOwn(value, key)) {
    addIssue(issues, fieldPath, 'required', `${key} is required`);
  } else if (!allowedValues.includes(value[key])) {
    addIssue(issues, fieldPath, 'enum', `${key} has an unsupported value`);
  }
}

function validateCompletenessAt(value, path, allowedFields, issues) {
  const record = readPlainDataRecord(value, path, issues, allowedFields);
  if (!record) return null;
  for (const field of allowedFields) {
    validateRequiredEnum(record, field, path, COMPLETENESS_STATUSES, issues);
  }
  return record;
}

function validateFactsAt(value, path, issues) {
  const record = readPlainDataRecord(value, path, issues, FACT_FIELDS);
  if (!record) return null;
  validateRequiredNonNegativeInteger(record, 'directMediaCount', path, issues);
  validateRequiredNonNegativeInteger(record, 'childDirectoryCount', path, issues);
  return record;
}

function validateDirectorySemantics(value, path, completenessFields, issues) {
  if (!value.completeness || !value.facts || !value.approximate) return;

  const completenessValues = [...completenessFields].map((field) => value.completeness[field]);
  const hasPartialObservation = completenessValues.includes('partial');
  const allObservationsComplete = completenessValues.every((entry) => entry === 'complete');
  const unavailable = UNAVAILABLE_DIRECTORY_STATUSES.has(value.status);

  if (unavailable) {
    for (const field of completenessFields) {
      if (value.completeness[field] !== 'partial') {
        addIssue(
          issues,
          `${path}.completeness.${field}`,
          'invariant',
          'Unavailable directories must have partial completeness'
        );
      }
    }
    if (value.facts.directMediaCount !== 0) {
      addIssue(
        issues,
        `${path}.facts.directMediaCount`,
        'invariant',
        'Unavailable directories cannot own observed direct-media facts'
      );
    }
    if (value.facts.childDirectoryCount !== 0) {
      addIssue(
        issues,
        `${path}.facts.childDirectoryCount`,
        'invariant',
        'Unavailable directories cannot own observed child facts'
      );
    }
    if (value.coverSampleCount !== 0) {
      addIssue(
        issues,
        `${path}.approximate.coverSamples`,
        'invariant',
        'Unavailable directories cannot own cover samples'
      );
    }
  }

  const hasPositiveEvidence = value.facts.directMediaCount > 0 || value.coverSampleCount > 0;
  let expectedDescendantMedia = 'unknown';
  if (!unavailable && hasPositiveEvidence) {
    expectedDescendantMedia = 'yes';
  } else if (!unavailable && allObservationsComplete
    && value.facts.directMediaCount === 0 && value.facts.childDirectoryCount === 0) {
    expectedDescendantMedia = 'no';
  }
  if (value.approximate.hasDescendantMedia !== expectedDescendantMedia) {
    addIssue(
      issues,
      `${path}.approximate.hasDescendantMedia`,
      'invariant',
      `Expected hasDescendantMedia=${expectedDescendantMedia}`
    );
  }

  const expectedTruncated = unavailable || hasPartialObservation
    || value.facts.childDirectoryCount > 0;
  if (value.approximate.truncated !== expectedTruncated) {
    addIssue(
      issues,
      `${path}.approximate.truncated`,
      'invariant',
      `Expected truncated=${expectedTruncated}`
    );
  }
}

function isExactlyOneSegmentBelow(parentPath, candidatePath) {
  if (!isPortableRelativePath(parentPath) || !isPortableRelativePath(candidatePath)) return false;
  const parentSegments = splitPortableRelativePath(parentPath);
  const candidateSegments = splitPortableRelativePath(candidatePath);
  return candidateSegments.length === parentSegments.length + 1
    && parentSegments.every((segment, index) => candidateSegments[index] === segment);
}

function isDescendantOf(parentPath, candidatePath) {
  if (!isPortableRelativePath(parentPath) || !isPortableRelativePath(candidatePath)) return false;
  const parentSegments = splitPortableRelativePath(parentPath);
  const candidateSegments = splitPortableRelativePath(candidatePath);
  return candidateSegments.length > parentSegments.length
    && parentSegments.every((segment, index) => candidateSegments[index] === segment);
}

function validatePortableSegment(value, path, issues) {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'type', 'Expected a string path segment');
    return false;
  }
  if (!isPortableRelativePath(value) || splitPortableRelativePath(value).length !== 1) {
    addIssue(issues, path, 'format', 'Expected one portable path segment');
    return false;
  }
  return true;
}

function validateApproximateAt(value, path, relativePath, issues) {
  const record = readPlainDataRecord(value, path, issues, APPROXIMATE_FIELDS);
  if (!record) return null;

  let coverSamples = null;
  if (!hasOwn(record, 'coverSamples')) {
    addIssue(issues, `${path}.coverSamples`, 'required', 'coverSamples is required');
  } else {
    coverSamples = readDenseArray(record.coverSamples, `${path}.coverSamples`, issues);
  }
  if (coverSamples) {
    for (const entry of coverSamples.entries) {
      const sample = entry.value;
      const samplePath = `${path}.coverSamples[${entry.index}]`;
      if (typeof sample !== 'string') {
        addIssue(issues, samplePath, 'type', 'Cover sample must be a string');
      } else if (!isPortableRelativePath(sample)) {
        addIssue(issues, samplePath, 'format', 'Cover sample must use a portable path');
      } else if (typeof relativePath === 'string' && isPortableRelativePath(relativePath)
        && !isDescendantOf(relativePath, sample)) {
        addIssue(issues, samplePath, 'invariant', 'Cover sample must be below its directory');
      }
    }
  }

  validateRequiredEnum(
    record,
    'hasDescendantMedia',
    path,
    DESCENDANT_MEDIA_STATUSES,
    issues
  );
  validateRequiredNonNegativeNumber(record, 'observedAt', path, issues);

  if (!hasOwn(record, 'truncated')) {
    addIssue(issues, `${path}.truncated`, 'required', 'truncated is required');
  } else if (typeof record.truncated !== 'boolean') {
    addIssue(issues, `${path}.truncated`, 'type', 'truncated must be a boolean');
  }
  return {
    coverSampleCount: coverSamples ? coverSamples.entries.length : 0,
    record
  };
}

function validateMediaAt(value, path, rootRelativePath, issues) {
  const record = readPlainDataRecord(value, path, issues, MEDIA_FIELDS);
  if (!record) return null;

  let relativePathValid = false;
  if (!hasOwn(record, 'relativePath')) {
    addIssue(issues, `${path}.relativePath`, 'required', 'relativePath is required');
  } else if (typeof record.relativePath !== 'string') {
    addIssue(issues, `${path}.relativePath`, 'type', 'relativePath must be a string');
  } else if (!isPortableRelativePath(record.relativePath)) {
    addIssue(issues, `${path}.relativePath`, 'format', 'relativePath must be portable');
  } else {
    relativePathValid = true;
    if (!isExactlyOneSegmentBelow(rootRelativePath, record.relativePath)) {
      addIssue(
        issues,
        `${path}.relativePath`,
        'invariant',
        'Direct media must be exactly one segment below the snapshot'
      );
    }
  }

  let nameValid = false;
  if (!hasOwn(record, 'name')) {
    addIssue(issues, `${path}.name`, 'required', 'name is required');
  } else {
    nameValid = validatePortableSegment(record.name, `${path}.name`, issues);
  }
  if (relativePathValid && nameValid) {
    const segments = splitPortableRelativePath(record.relativePath);
    if (segments[segments.length - 1] !== record.name) {
      addIssue(issues, `${path}.name`, 'invariant', 'Media name must match its relative path');
    }
  }

  validateRequiredNonNegativeNumber(record, 'size', path, issues);
  validateRequiredFiniteNumber(record, 'mtimeMs', path, issues);
  return record;
}

function validateChildAt(value, path, rootRef, issues) {
  const record = readPlainDataRecord(value, path, issues, CHILD_FIELDS);
  if (!record) return null;

  const childRef = validateRequiredObjectField(record, 'ref', path, issues, validateDirectoryRefAt);
  if (childRef && typeof childRef.sourceId === 'string'
    && rootRef && typeof rootRef.sourceId === 'string' && childRef.sourceId !== rootRef.sourceId) {
    addIssue(issues, `${path}.ref.sourceId`, 'invariant', 'Child source id must match the snapshot');
  }
  if (childRef && typeof childRef.relativePath === 'string'
    && isPortableRelativePath(childRef.relativePath)
    && rootRef && typeof rootRef.relativePath === 'string'
    && isPortableRelativePath(rootRef.relativePath)
    && !isExactlyOneSegmentBelow(rootRef.relativePath, childRef.relativePath)) {
    addIssue(
      issues,
      `${path}.ref.relativePath`,
      'invariant',
      'Child ref must be exactly one segment below the snapshot'
    );
  }

  let nameValid = false;
  if (!hasOwn(record, 'name')) {
    addIssue(issues, `${path}.name`, 'required', 'name is required');
  } else {
    nameValid = validatePortableSegment(record.name, `${path}.name`, issues);
  }
  if (childRef && typeof childRef.relativePath === 'string'
    && isPortableRelativePath(childRef.relativePath) && nameValid) {
    const segments = splitPortableRelativePath(childRef.relativePath);
    if (segments[segments.length - 1] !== record.name) {
      addIssue(issues, `${path}.name`, 'invariant', 'Child name must match its ref');
    }
  }

  validateRequiredEnum(record, 'status', path, DIRECTORY_STATUSES, issues);
  const completeness = validateRequiredObjectField(
    record,
    'completeness',
    path,
    issues,
    (field, fieldPath, fieldIssues) => validateCompletenessAt(
      field,
      fieldPath,
      CHILD_COMPLETENESS_FIELDS,
      fieldIssues
    )
  );
  const facts = validateRequiredObjectField(record, 'facts', path, issues, validateFactsAt);
  const approximate = validateRequiredObjectField(
    record,
    'approximate',
    path,
    issues,
    (field, fieldPath, fieldIssues) => validateApproximateAt(
      field,
      fieldPath,
      childRef?.relativePath,
      fieldIssues
    )
  );
  validateDirectorySemantics({
    approximate: approximate?.record,
    completeness,
    coverSampleCount: approximate?.coverSampleCount,
    facts,
    status: record.status
  }, path, CHILD_COMPLETENESS_FIELDS, issues);
  return record;
}

function validateLocatorAt(value, path, issues) {
  const record = readPlainDataRecord(value, path, issues, LOCATOR_FIELDS);
  if (!record) return null;
  validateRequiredNonEmptyString(record, 'absolutePath', path, issues);
  return record;
}

function validateDirectorySnapshotAt(value, path, issues) {
  const record = readPlainDataRecord(value, path, issues, SNAPSHOT_FIELDS);
  if (!record) return null;
  validateContractVersion(record, path, issues);
  const rootRef = validateRequiredObjectField(record, 'ref', path, issues, validateDirectoryRefAt);
  validateRequiredObjectField(record, 'locator', path, issues, validateLocatorAt);
  validateRequiredNonEmptyString(record, 'name', path, issues);
  validateRequiredEnum(record, 'status', path, DIRECTORY_STATUSES, issues);
  validateRequiredNonNegativeNumber(record, 'observedAt', path, issues);
  validateRequiredNonEmptyString(record, 'revision', path, issues);
  const completeness = validateRequiredObjectField(
    record,
    'completeness',
    path,
    issues,
    (field, fieldPath, fieldIssues) => validateCompletenessAt(
      field,
      fieldPath,
      ROOT_COMPLETENESS_FIELDS,
      fieldIssues
    )
  );
  const facts = validateRequiredObjectField(record, 'facts', path, issues, validateFactsAt);

  const rootRelativePath = rootRef && typeof rootRef.relativePath === 'string'
    ? rootRef.relativePath
    : '';
  let directMedia = null;
  if (!hasOwn(record, 'directMedia')) {
    addIssue(issues, `${path}.directMedia`, 'required', 'directMedia is required');
  } else {
    directMedia = readDenseArray(record.directMedia, `${path}.directMedia`, issues);
  }
  if (directMedia) {
    for (const entry of directMedia.entries) {
      validateMediaAt(
        entry.value,
        `${path}.directMedia[${entry.index}]`,
        rootRelativePath,
        issues
      );
    }
  }

  let children = null;
  if (!hasOwn(record, 'children')) {
    addIssue(issues, `${path}.children`, 'required', 'children is required');
  } else {
    children = readDenseArray(record.children, `${path}.children`, issues);
  }
  if (children) {
    for (const entry of children.entries) {
      validateChildAt(entry.value, `${path}.children[${entry.index}]`, rootRef, issues);
    }
  }

  const approximate = validateRequiredObjectField(
    record,
    'approximate',
    path,
    issues,
    (field, fieldPath, fieldIssues) => validateApproximateAt(
      field,
      fieldPath,
      rootRelativePath,
      fieldIssues
    )
  );

  if (facts && directMedia && Number.isInteger(facts.directMediaCount)
    && facts.directMediaCount !== directMedia.length) {
    addIssue(
      issues,
      `${path}.facts.directMediaCount`,
      'invariant',
      'Direct media count must match the returned entries'
    );
  }
  if (facts && children && Number.isInteger(facts.childDirectoryCount)
    && facts.childDirectoryCount !== children.length) {
    addIssue(
      issues,
      `${path}.facts.childDirectoryCount`,
      'invariant',
      'Child directory count must match the returned entries'
    );
  }
  validateDirectorySemantics({
    approximate: approximate?.record,
    completeness,
    coverSampleCount: approximate?.coverSampleCount,
    facts,
    status: record.status
  }, path, ROOT_COMPLETENESS_FIELDS, issues);
  return record;
}

function validateRuntimeSourceV1(value) {
  const issues = [];
  validateRuntimeSourceAt(value, '$', issues);
  return createValidationResult(value, issues);
}

function validateDirectoryRefV1(value) {
  const issues = [];
  validateDirectoryRefAt(value, '$', issues);
  return createValidationResult(value, issues);
}

function validateDirectoryLevelRequestV1(value) {
  const issues = [];
  const record = readPlainDataRecord(value, '$', issues, REQUEST_FIELDS);
  if (!record) return createValidationResult(value, issues);
  validateContractVersion(record, '$', issues);
  const runtimeSource = validateRequiredObjectField(
    record,
    'runtimeSource',
    '$',
    issues,
    validateRuntimeSourceAt
  );
  const ref = validateRequiredObjectField(record, 'ref', '$', issues, validateDirectoryRefAt);

  if (runtimeSource && ref && typeof runtimeSource.sourceId === 'string'
    && typeof ref.sourceId === 'string' && runtimeSource.sourceId !== ref.sourceId) {
    addIssue(issues, '$.ref.sourceId', 'invariant', 'Directory ref must match runtime source');
  }

  return createValidationResult(value, issues);
}

function deriveTriState(count, completeness) {
  if (Number.isInteger(count) && count > 0) return true;
  if (completeness === 'complete' && count === 0) return false;
  return 'unknown';
}

function deriveDirectoryCapabilitiesV1(record) {
  const canViewDirectMedia = deriveTriState(
    record?.facts?.directMediaCount,
    record?.completeness?.directMedia
  );
  const canBrowseChildren = deriveTriState(
    record?.facts?.childDirectoryCount,
    record?.completeness?.children
  );
  let contentKind = 'unknown';
  if (canViewDirectMedia === true && canBrowseChildren === true) contentKind = 'hybrid';
  if (canViewDirectMedia === true && canBrowseChildren === false) contentKind = 'photoSet';
  if (canViewDirectMedia === false && canBrowseChildren === true) contentKind = 'container';
  if (canViewDirectMedia === false && canBrowseChildren === false) contentKind = 'empty';
  return { canViewDirectMedia, canBrowseChildren, contentKind };
}

function validateDirectorySnapshotV1(value) {
  const issues = [];
  validateDirectorySnapshotAt(value, '$', issues);
  return createValidationResult(value, issues);
}

function createDirectorySuccessEnvelopeV1(snapshot) {
  return {
    contractVersion: DIRECTORY_CONTRACT_VERSION,
    ok: true,
    data: snapshot
  };
}

function createDirectoryErrorEnvelopeV1(code, message, options = {}) {
  const error = {
    code,
    message,
    retryable: options.retryable ?? false
  };
  if (hasOwn(options, 'details')) {
    error.details = options.details;
  }
  return {
    contractVersion: DIRECTORY_CONTRACT_VERSION,
    ok: false,
    error
  };
}

function validateErrorAt(value, path, issues) {
  const record = readPlainDataRecord(value, path, issues, ERROR_FIELDS);
  if (!record) return null;
  validateRequiredNonEmptyString(record, 'code', path, issues);
  validateRequiredNonEmptyString(record, 'message', path, issues);
  if (!hasOwn(record, 'retryable')) {
    addIssue(issues, `${path}.retryable`, 'required', 'retryable is required');
  } else if (typeof record.retryable !== 'boolean') {
    addIssue(issues, `${path}.retryable`, 'type', 'retryable must be a boolean');
  }
  if (hasOwn(record, 'details')) {
    validatePureDataAt(record.details, `${path}.details`, issues);
  }
  return record;
}

function validateDirectoryEnvelopeV1(value) {
  const issues = [];
  const record = readPlainDataRecord(value, '$', issues, ENVELOPE_FIELDS);
  if (!record) return createValidationResult(value, issues);
  validateContractVersion(record, '$', issues);

  if (!hasOwn(record, 'ok')) {
    addIssue(issues, '$.ok', 'required', 'ok is required');
  } else if (typeof record.ok !== 'boolean') {
    addIssue(issues, '$.ok', 'type', 'ok must be a boolean');
  } else if (record.ok) {
    if (!hasOwn(record, 'data')) {
      addIssue(issues, '$.data', 'required', 'Successful envelope requires data');
    } else {
      const data = validateDirectorySnapshotAt(record.data, '$.data', issues);
      if (data && hasOwn(data, 'status') && data.status !== 'ready') {
        addIssue(
          issues,
          '$.data.status',
          'invariant',
          'Successful envelopes require a ready top-level directory'
        );
      }
    }
    if (hasOwn(record, 'error')) {
      addIssue(issues, '$.error', 'invariant', 'Successful envelope cannot own error');
    }
  } else {
    if (!hasOwn(record, 'error')) {
      addIssue(issues, '$.error', 'required', 'Failure envelope requires error');
    } else {
      validateErrorAt(record.error, '$.error', issues);
    }
    if (hasOwn(record, 'data')) {
      addIssue(issues, '$.data', 'invariant', 'Failure envelope cannot own data');
    }
  }

  return createValidationResult(value, issues);
}

module.exports = {
  DIRECTORY_CONTRACT_VERSION,
  DIRECTORY_STATUSES,
  COMPLETENESS_STATUSES,
  DESCENDANT_MEDIA_STATUSES,
  createDirectoryErrorEnvelopeV1,
  createDirectorySuccessEnvelopeV1,
  deriveDirectoryCapabilitiesV1,
  validateDirectoryEnvelopeV1,
  validateDirectoryLevelRequestV1,
  validateDirectoryRefV1,
  validateDirectorySnapshotV1,
  validateRuntimeSourceV1
};
