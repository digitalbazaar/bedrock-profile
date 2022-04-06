/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections(['profile-meter']);

  await database.createIndexes([{
    collection: 'profile-meter',
    fields: {'meter.id': 1},
    options: {unique: true, background: false}
  }, {
    collection: 'profile-meter',
    fields: {'meter.profile': 1, 'meter.serviceType': 1},
    options: {unique: false, background: false}
  }]);
});

/**
 * Adds a meter for a Profile.
 *
 * @param {object} options - The options for the function.
 * @param {string} options.meter - The meter to be stored in the database.
 *
 * @returns {Promise<object>} Returns the Meter Record.
 */
export async function add({meter} = {}) {
  assert.object(meter, 'meter');
  assert.string(meter.id, 'meter.id');
  assert.string(meter.profile, 'meter.profile');
  assert.string(meter.serviceType, 'meter.serviceType');
  assert.string(meter.referenceId, 'meter.referenceId');

  const now = Date.now();
  const meta = {created: now, updated: now};
  let record = {
    meta,
    meter,
  };
  try {
    const collection = database.collections['profile-meter'];
    const result = await collection.insertOne(record, database.writeOptions);
    record = result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError(
      'Duplicate meter.',
      'DuplicateError', {
        public: true,
        httpStatusCode: 409
      }, e);
  }
  return record;
}

/**
 * Gets all meters associated with a Profile.
 *
 * @param {object} options - The options for the function.
 * @param {string} options.profileId - The ID of the profile associated
 *   with the meters.
 *
 * @returns {Promise<object[]>} Resolves to a list of meters.
 */
export async function findByProfile({profileId} = {}) {
  assert.string(profileId, 'profileId');
  if(!profileId) {
    throw new TypeError('"profileId" must be a non-empty string.');
  }

  const query = {'meter.profile': profileId};
  const projection = {_id: 0};
  const collection = database.collections['profile-meter'];

  const meters = await collection.find(query, {projection}).toArray();
  return {meters};
}
