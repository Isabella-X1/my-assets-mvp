const DATA_ENTRY_FORM_IDS = new Set([
  'asset-create-form',
  'asset-edit-form',
  'account-form',
]);

export function formIdentifier(form) {
  return String(form?.getAttribute?.('id') || '');
}

export function submissionOperationKey(form) {
  const formId = formIdentifier(form);
  if (formId === 'asset-create-form') return 'asset:create';
  if (formId === 'asset-edit-form') return `asset:${form.elements.id.value}`;
  if (formId === 'account-form') {
    return form.elements.id.value ? `account:${form.elements.id.value}` : 'account:create';
  }
  return `form:${formId || 'unknown'}`;
}

export function tracksUnsavedChanges(form) {
  return DATA_ENTRY_FORM_IDS.has(formIdentifier(form));
}
