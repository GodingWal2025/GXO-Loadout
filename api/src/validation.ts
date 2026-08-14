// Runtime Schema Validation for Loadout Shared Storage Records

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

function isObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isString(val: unknown): val is string {
  return typeof val === 'string';
}

function isOptionalString(val: unknown): boolean {
  return val === undefined || val === null || typeof val === 'string';
}

function isOptionalNumber(val: unknown): boolean {
  return val === undefined || val === null || typeof val === 'number';
}

function isOptionalBoolean(val: unknown): boolean {
  return val === undefined || val === null || typeof val === 'boolean';
}

export function validateInspectionRecord(record: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(record)) {
    return { valid: false, errors: [{ path: '', message: 'Inspection must be an object' }] };
  }

  if (!isString(record.id) || !record.id.trim()) {
    errors.push({ path: 'id', message: 'id must be a non-empty string' });
  }

  if (!isOptionalString(record.siteId)) {
    errors.push({ path: 'siteId', message: 'siteId must be a string' });
  }

  if (!isOptionalString(record.status)) {
    errors.push({ path: 'status', message: 'status must be a string' });
  }

  if (record.pallets !== undefined && !Array.isArray(record.pallets)) {
    errors.push({ path: 'pallets', message: 'pallets must be an array' });
  }

  if (record.photos !== undefined && !Array.isArray(record.photos)) {
    errors.push({ path: 'photos', message: 'photos must be an array' });
  }

  if (record.picklist !== undefined && !isObject(record.picklist)) {
    errors.push({ path: 'picklist', message: 'picklist must be an object' });
  }

  if (record.bol !== undefined && !isObject(record.bol)) {
    errors.push({ path: 'bol', message: 'bol must be an object' });
  }

  if (!isOptionalString(record.lastEditedAt) && !isOptionalString(record.startedAt) && !isOptionalString(record.completedAt)) {
    errors.push({ path: 'timestamps', message: 'Record must have valid ISO timestamp fields' });
  }

  return { valid: errors.length === 0, errors };
}

export function validateInventoryRecord(record: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(record)) {
    return { valid: false, errors: [{ path: '', message: 'Inventory item must be an object' }] };
  }

  if (!isString(record.id) || !record.id.trim()) {
    errors.push({ path: 'id', message: 'id must be a non-empty string' });
  }

  if (!isOptionalString(record.sku)) {
    errors.push({ path: 'sku', message: 'sku must be a string' });
  }

  if (!isOptionalString(record.description)) {
    errors.push({ path: 'description', message: 'description must be a string' });
  }

  if (!isOptionalNumber(record.quantity) && !isOptionalNumber(record.expectedQuantity)) {
    errors.push({ path: 'quantity', message: 'quantity must be a number' });
  }

  if (!isOptionalString(record.lastUpdated)) {
    errors.push({ path: 'lastUpdated', message: 'lastUpdated must be a string timestamp' });
  }

  return { valid: errors.length === 0, errors };
}

export function validateSiteRecord(record: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(record)) {
    return { valid: false, errors: [{ path: '', message: 'Site must be an object' }] };
  }

  if (!isString(record.id) || !record.id.trim()) {
    errors.push({ path: 'id', message: 'id must be a non-empty string' });
  }

  if (!isOptionalString(record.name)) {
    errors.push({ path: 'name', message: 'name must be a string' });
  }

  if (!isOptionalBoolean(record.active)) {
    errors.push({ path: 'active', message: 'active must be a boolean' });
  }

  return { valid: errors.length === 0, errors };
}

export function validateInspectorRecord(record: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(record)) {
    return { valid: false, errors: [{ path: '', message: 'Inspector must be an object' }] };
  }

  if (!isString(record.id) || !record.id.trim()) {
    errors.push({ path: 'id', message: 'id must be a non-empty string' });
  }

  if (!isOptionalString(record.name)) {
    errors.push({ path: 'name', message: 'name must be a string' });
  }

  if (!isOptionalString(record.siteId)) {
    errors.push({ path: 'siteId', message: 'siteId must be a string' });
  }

  return { valid: errors.length === 0, errors };
}

export function validateStagingRecord(record: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(record)) {
    return { valid: false, errors: [{ path: '', message: 'Staging location must be an object' }] };
  }

  if (!isString(record.id) || !record.id.trim()) {
    errors.push({ path: 'id', message: 'id must be a non-empty string' });
  }

  if (!isOptionalString(record.name)) {
    errors.push({ path: 'name', message: 'name must be a string' });
  }

  if (!isOptionalString(record.siteId)) {
    errors.push({ path: 'siteId', message: 'siteId must be a string' });
  }

  return { valid: errors.length === 0, errors };
}

export function validateRecordSchema(kind: string, record: unknown): ValidationResult {
  switch (kind) {
    case 'inspections':
      return validateInspectionRecord(record);
    case 'inventory':
      return validateInventoryRecord(record);
    case 'sites':
      return validateSiteRecord(record);
    case 'inspectors':
      return validateInspectorRecord(record);
    case 'staging':
      return validateStagingRecord(record);
    default:
      return { valid: false, errors: [{ path: 'kind', message: `Unknown record kind: ${kind}` }] };
  }
}
