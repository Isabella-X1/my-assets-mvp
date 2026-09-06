import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formIdentifier,
  submissionOperationKey,
  tracksUnsavedChanges,
} from '../src/lib/form-identity.js';

function browserLikeForm(id, recordId = '') {
  return {
    // In real browsers, a descendant named "id" can shadow HTMLFormElement.id.
    id: { name: 'id', value: recordId },
    elements: { id: { value: recordId } },
    getAttribute: (name) => name === 'id' ? id : null,
  };
}

test('form routing ignores a named id input that shadows HTMLFormElement.id', () => {
  const createForm = browserLikeForm('account-form');
  const editForm = browserLikeForm('asset-edit-form', 'asset-a');

  assert.equal(formIdentifier(createForm), 'account-form');
  assert.equal(submissionOperationKey(createForm), 'account:create');
  assert.equal(submissionOperationKey(editForm), 'asset:asset-a');
  assert.equal(tracksUnsavedChanges(createForm), true);
});
