const {
  getRootPathFlavor,
  isPortableRelativePath,
  splitPortableRelativePath
} = require('../path-codec');

const DIRECTORY_CONTRACT_VERSION = 1;
const DIRECTORY_STATUSES = Object.freeze(['ready', 'unreadable', 'missing', 'sourceOffline']);
const COMPLETENESS_STATUSES = Object.freeze(['complete', 'partial']);
const DESCENDANT_MEDIA_STATUSES = Object.freeze(['yes', 'no', 'unknown']);
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_FIELDS = Object.freeze([
  'type', 'kind', 'canOpenAlbum', 'canViewAsPhotoSet', 'hasImages',
  'imageCount', 'directImageCount', 'childFolders'
]);

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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function validateObject(value, path, issues) {
  if (!isRecord(value)) {
    addIssue(issues, path, 'type', 'Expected an object');
    return false;
  }
  return true;
}

function validateAllowedFields(value, path, allowedFields, issues) {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      addIssue(issues, `${path}.${key}`, 'invariant', 'Unexpected canonical field');
    }
  }
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
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, RUNTIME_SOURCE_FIELDS, issues);
  validateSourceIdField(value, path, issues);

  if (!hasOwn(value, 'rootPath')) {
    addIssue(issues, `${path}.rootPath`, 'required', 'Root path is required');
  } else if (typeof value.rootPath !== 'string') {
    addIssue(issues, `${path}.rootPath`, 'type', 'Root path must be a string');
  } else if (getRootPathFlavor(value.rootPath) === null) {
    addIssue(issues, `${path}.rootPath`, 'format', 'Root path must be an absolute POSIX or Windows path');
  }
}

function validateDirectoryRefAt(value, path, issues) {
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, DIRECTORY_REF_FIELDS, issues);
  validateSourceIdField(value, path, issues);

  if (!hasOwn(value, 'relativePath')) {
    addIssue(issues, `${path}.relativePath`, 'required', 'Relative path is required');
  } else if (typeof value.relativePath !== 'string') {
    addIssue(issues, `${path}.relativePath`, 'type', 'Relative path must be a string');
  } else if (!isPortableRelativePath(value.relativePath)) {
    addIssue(issues, `${path}.relativePath`, 'format', 'Relative path must be portable');
  }
}

function validateRequiredObjectField(value, key, path, issues, validator) {
  const fieldPath = `${path}.${key}`;
  if (!hasOwn(value, key)) {
    addIssue(issues, fieldPath, 'required', `${key} is required`);
    return;
  }
  validator(value[key], fieldPath, issues);
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
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, allowedFields, issues);
  for (const field of allowedFields) {
    validateRequiredEnum(value, field, path, COMPLETENESS_STATUSES, issues);
  }
}

function validateFactsAt(value, path, issues) {
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, FACT_FIELDS, issues);
  validateRequiredNonNegativeInteger(value, 'directMediaCount', path, issues);
  validateRequiredNonNegativeInteger(value, 'childDirectoryCount', path, issues);
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
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, APPROXIMATE_FIELDS, issues);

  if (!hasOwn(value, 'coverSamples')) {
    addIssue(issues, `${path}.coverSamples`, 'required', 'coverSamples is required');
  } else if (!Array.isArray(value.coverSamples)) {
    addIssue(issues, `${path}.coverSamples`, 'type', 'coverSamples must be an array');
  } else {
    value.coverSamples.forEach((sample, index) => {
      const samplePath = `${path}.coverSamples[${index}]`;
      if (typeof sample !== 'string') {
        addIssue(issues, samplePath, 'type', 'Cover sample must be a string');
      } else if (!isPortableRelativePath(sample)) {
        addIssue(issues, samplePath, 'format', 'Cover sample must use a portable path');
      } else if (typeof relativePath === 'string' && isPortableRelativePath(relativePath)
        && !isDescendantOf(relativePath, sample)) {
        addIssue(issues, samplePath, 'invariant', 'Cover sample must be below its directory');
      }
    });
  }

  validateRequiredEnum(
    value,
    'hasDescendantMedia',
    path,
    DESCENDANT_MEDIA_STATUSES,
    issues
  );
  validateRequiredNonNegativeNumber(value, 'observedAt', path, issues);

  if (!hasOwn(value, 'truncated')) {
    addIssue(issues, `${path}.truncated`, 'required', 'truncated is required');
  } else if (typeof value.truncated !== 'boolean') {
    addIssue(issues, `${path}.truncated`, 'type', 'truncated must be a boolean');
  }
}

function validateMediaAt(value, path, rootRelativePath, issues) {
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, MEDIA_FIELDS, issues);

  let relativePathValid = false;
  if (!hasOwn(value, 'relativePath')) {
    addIssue(issues, `${path}.relativePath`, 'required', 'relativePath is required');
  } else if (typeof value.relativePath !== 'string') {
    addIssue(issues, `${path}.relativePath`, 'type', 'relativePath must be a string');
  } else if (!isPortableRelativePath(value.relativePath)) {
    addIssue(issues, `${path}.relativePath`, 'format', 'relativePath must be portable');
  } else {
    relativePathValid = true;
    if (!isExactlyOneSegmentBelow(rootRelativePath, value.relativePath)) {
      addIssue(
        issues,
        `${path}.relativePath`,
        'invariant',
        'Direct media must be exactly one segment below the snapshot'
      );
    }
  }

  let nameValid = false;
  if (!hasOwn(value, 'name')) {
    addIssue(issues, `${path}.name`, 'required', 'name is required');
  } else {
    nameValid = validatePortableSegment(value.name, `${path}.name`, issues);
  }
  if (relativePathValid && nameValid) {
    const segments = splitPortableRelativePath(value.relativePath);
    if (segments[segments.length - 1] !== value.name) {
      addIssue(issues, `${path}.name`, 'invariant', 'Media name must match its relative path');
    }
  }

  validateRequiredNonNegativeNumber(value, 'size', path, issues);
  validateRequiredNonNegativeNumber(value, 'mtimeMs', path, issues);
}

function validateChildAt(value, path, rootRef, issues) {
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, CHILD_FIELDS, issues);

  validateRequiredObjectField(value, 'ref', path, issues, validateDirectoryRefAt);
  const childRef = isRecord(value.ref) ? value.ref : null;
  if (childRef && typeof childRef.sourceId === 'string'
    && typeof rootRef.sourceId === 'string' && childRef.sourceId !== rootRef.sourceId) {
    addIssue(issues, `${path}.ref.sourceId`, 'invariant', 'Child source id must match the snapshot');
  }
  if (childRef && typeof childRef.relativePath === 'string'
    && isPortableRelativePath(childRef.relativePath)
    && typeof rootRef.relativePath === 'string' && isPortableRelativePath(rootRef.relativePath)
    && !isExactlyOneSegmentBelow(rootRef.relativePath, childRef.relativePath)) {
    addIssue(
      issues,
      `${path}.ref.relativePath`,
      'invariant',
      'Child ref must be exactly one segment below the snapshot'
    );
  }

  let nameValid = false;
  if (!hasOwn(value, 'name')) {
    addIssue(issues, `${path}.name`, 'required', 'name is required');
  } else {
    nameValid = validatePortableSegment(value.name, `${path}.name`, issues);
  }
  if (childRef && typeof childRef.relativePath === 'string'
    && isPortableRelativePath(childRef.relativePath) && nameValid) {
    const segments = splitPortableRelativePath(childRef.relativePath);
    if (segments[segments.length - 1] !== value.name) {
      addIssue(issues, `${path}.name`, 'invariant', 'Child name must match its ref');
    }
  }

  validateRequiredEnum(value, 'status', path, DIRECTORY_STATUSES, issues);
  validateRequiredObjectField(value, 'completeness', path, issues, (field, fieldPath, fieldIssues) => {
    validateCompletenessAt(field, fieldPath, CHILD_COMPLETENESS_FIELDS, fieldIssues);
  });
  validateRequiredObjectField(value, 'facts', path, issues, validateFactsAt);
  validateRequiredObjectField(value, 'approximate', path, issues, (field, fieldPath, fieldIssues) => {
    validateApproximateAt(field, fieldPath, childRef?.relativePath, fieldIssues);
  });
}

function validateNoLegacyFields(value, path, issues, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoLegacyFields(entry, `${path}[${index}]`, issues, seen));
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (LEGACY_FIELDS.includes(key)) {
      addIssue(issues, `${path}.${key}`, 'invariant', 'Legacy fields are not canonical');
    }
    validateNoLegacyFields(nestedValue, `${path}.${key}`, issues, seen);
  }
}

function validateDirectorySnapshotAt(value, path, issues) {
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, SNAPSHOT_FIELDS, issues);
  validateNoLegacyFields(value, path, issues);
  validateContractVersion(value, path, issues);
  validateRequiredObjectField(value, 'ref', path, issues, validateDirectoryRefAt);

  if (!hasOwn(value, 'locator')) {
    addIssue(issues, `${path}.locator`, 'required', 'locator is required');
  } else if (validateObject(value.locator, `${path}.locator`, issues)) {
    validateAllowedFields(value.locator, `${path}.locator`, LOCATOR_FIELDS, issues);
    validateRequiredNonEmptyString(value.locator, 'absolutePath', `${path}.locator`, issues);
  }

  validateRequiredNonEmptyString(value, 'name', path, issues);
  validateRequiredEnum(value, 'status', path, DIRECTORY_STATUSES, issues);
  validateRequiredNonNegativeNumber(value, 'observedAt', path, issues);
  validateRequiredNonEmptyString(value, 'revision', path, issues);
  validateRequiredObjectField(value, 'completeness', path, issues, (field, fieldPath, fieldIssues) => {
    validateCompletenessAt(field, fieldPath, ROOT_COMPLETENESS_FIELDS, fieldIssues);
  });
  validateRequiredObjectField(value, 'facts', path, issues, validateFactsAt);

  const rootRef = isRecord(value.ref) ? value.ref : {};
  const rootRelativePath = typeof rootRef.relativePath === 'string' ? rootRef.relativePath : '';
  if (!hasOwn(value, 'directMedia')) {
    addIssue(issues, `${path}.directMedia`, 'required', 'directMedia is required');
  } else if (!Array.isArray(value.directMedia)) {
    addIssue(issues, `${path}.directMedia`, 'type', 'directMedia must be an array');
  } else {
    value.directMedia.forEach((media, index) => {
      validateMediaAt(media, `${path}.directMedia[${index}]`, rootRelativePath, issues);
    });
  }

  if (!hasOwn(value, 'children')) {
    addIssue(issues, `${path}.children`, 'required', 'children is required');
  } else if (!Array.isArray(value.children)) {
    addIssue(issues, `${path}.children`, 'type', 'children must be an array');
  } else {
    value.children.forEach((child, index) => {
      validateChildAt(child, `${path}.children[${index}]`, rootRef, issues);
    });
  }

  validateRequiredObjectField(value, 'approximate', path, issues, (field, fieldPath, fieldIssues) => {
    validateApproximateAt(field, fieldPath, rootRelativePath, fieldIssues);
  });

  if (isRecord(value.facts) && Array.isArray(value.directMedia)
    && Number.isInteger(value.facts.directMediaCount)
    && value.facts.directMediaCount !== value.directMedia.length) {
    addIssue(
      issues,
      `${path}.facts.directMediaCount`,
      'invariant',
      'Direct media count must match the returned entries'
    );
  }
  if (isRecord(value.facts) && Array.isArray(value.children)
    && Number.isInteger(value.facts.childDirectoryCount)
    && value.facts.childDirectoryCount !== value.children.length) {
    addIssue(
      issues,
      `${path}.facts.childDirectoryCount`,
      'invariant',
      'Child directory count must match the returned entries'
    );
  }
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
  if (!validateObject(value, '$', issues)) return createValidationResult(value, issues);
  validateAllowedFields(value, '$', REQUEST_FIELDS, issues);
  validateContractVersion(value, '$', issues);
  validateRequiredObjectField(value, 'runtimeSource', '$', issues, validateRuntimeSourceAt);
  validateRequiredObjectField(value, 'ref', '$', issues, validateDirectoryRefAt);

  if (isRecord(value.runtimeSource) && isRecord(value.ref)
    && typeof value.runtimeSource.sourceId === 'string'
    && typeof value.ref.sourceId === 'string'
    && value.runtimeSource.sourceId !== value.ref.sourceId) {
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
  if (!validateObject(value, path, issues)) return;
  validateAllowedFields(value, path, ERROR_FIELDS, issues);
  validateRequiredNonEmptyString(value, 'code', path, issues);
  validateRequiredNonEmptyString(value, 'message', path, issues);
  if (!hasOwn(value, 'retryable')) {
    addIssue(issues, `${path}.retryable`, 'required', 'retryable is required');
  } else if (typeof value.retryable !== 'boolean') {
    addIssue(issues, `${path}.retryable`, 'type', 'retryable must be a boolean');
  }
  if (hasOwn(value, 'details') && !isRecord(value.details)) {
    addIssue(issues, `${path}.details`, 'type', 'details must be an object');
  }
}

function validateDirectoryEnvelopeV1(value) {
  const issues = [];
  if (!validateObject(value, '$', issues)) return createValidationResult(value, issues);
  validateAllowedFields(value, '$', ENVELOPE_FIELDS, issues);
  validateContractVersion(value, '$', issues);

  if (!hasOwn(value, 'ok')) {
    addIssue(issues, '$.ok', 'required', 'ok is required');
  } else if (typeof value.ok !== 'boolean') {
    addIssue(issues, '$.ok', 'type', 'ok must be a boolean');
  } else if (value.ok) {
    if (!hasOwn(value, 'data')) {
      addIssue(issues, '$.data', 'required', 'Successful envelope requires data');
    } else {
      validateDirectorySnapshotAt(value.data, '$.data', issues);
    }
    if (hasOwn(value, 'error')) {
      addIssue(issues, '$.error', 'invariant', 'Successful envelope cannot own error');
    }
  } else {
    if (!hasOwn(value, 'error')) {
      addIssue(issues, '$.error', 'required', 'Failure envelope requires error');
    } else {
      validateErrorAt(value.error, '$.error', issues);
    }
    if (hasOwn(value, 'data')) {
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
