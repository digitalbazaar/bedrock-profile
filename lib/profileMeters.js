/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const bedrock = require('bedrock');
const database = require('bedrock-mongodb');

const {util: {BedrockError}} = bedrock;

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections(['profile-meters']);

  await database.createIndexes([{
    collection: 'profile-meters',
    fields: {'meter.id': 1},
    options: {unique: true, background: false}
  }, {
    collection: 'profile-meters',
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
exports.add = async ({meter} = {}) => {
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
    const collection = database.collections['profile-meters'];
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
};

/**
 * Gets all meters associated with a Profile.
 *
 * @param {object} options - The options for the function.
 * @param {string} options.profileId - The ID of the profile associated
 *   with the meters.
 *
 * @returns {Promise<object[]>} Resolves to a list of meters.
 */
exports.findByProfile = async ({profileId} = {}) => {
  assert.string(profileId, 'profileId');
  if(!profileId) {
    throw new TypeError('"profileId" must be a non-empty string.');
  }

  const query = {'meter.profile': profileId};
  const projection = {_id: 0};
  const collection = database.collections['profile-meters'];

  const meters = await collection.find(query, {projection}).toArray();
  return {meters};
};
