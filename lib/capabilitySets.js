/*!
 * Copyright (c) 2019-2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const bedrock = require('bedrock');
const database = require('bedrock-mongodb');
const {promisify} = require('util');
const utils = require('./utils');
const {util: {BedrockError}} = bedrock;

// load config defaults
require('./config');

bedrock.events.on('bedrock-mongodb.ready', async () => {
  const collections = ['profile-profileAgentCapabilitySet'];
  await promisify(database.openCollections)(collections);

  await promisify(database.createIndexes)([{
    collection: 'profile-profileAgentCapabilitySet',
    fields: {'capabilitySet.profileAgent': 1},
    options: {unique: true, background: false}
  }, {
    collection: 'profile-profileAgentCapabilitySet',
    fields: {'capabilitySet.profileAgent': 1, 'capabilitySet.sequence': 1},
    options: {unique: false, background: false}
  }]);
});

// create a capability set
exports.create = async ({capabilitySet} = {}) => {
  _assertCapabilitySet(capabilitySet);
  if(capabilitySet.sequence !== 0) {
    throw new BedrockError(
      'Profile agent capability set sequence must be zero when created.',
      'InvalidStateError', {
        public: true,
        httpStatusCode: 400
      });
  }

  // insert the capability set and get the updated record
  const now = Date.now();
  const meta = {created: now, updated: now};
  let record = {
    meta,
    capabilitySet
  };
  try {
    const collection = utils.getCollection('profile-profileAgentCapabilitySet');
    const result = await collection.insert(record, database.writeOptions);
    record = result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError(
      'Duplicate profile agent capability set.',
      'DuplicateError', {
        public: true,
        httpStatusCode: 409
      }, e);
  }
  return record;
};

// get a capability set by profile agent ID
exports.get = async ({profileAgentId} = {}) => {
  assert.string(profileAgentId, 'profileAgentId');

  const query = {'capabilitySet.profileAgent': profileAgentId};
  const collection = utils.getCollection('profile-profileAgentCapabilitySet');
  const record = await collection.findOne(query,
    {_id: 0, capabilitySet: 1, meta: 1});
  if(!record) {
    const details = {
      profileAgentId,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError(
      'Profile agent capability set not found.',
      'NotFoundError', details);
  }
  return record;
};

// update capability set
exports.update = async ({capabilitySet} = {}) => {
  _assertCapabilitySet(capabilitySet);

  // get existing capability set
  const {profileAgent: profileAgentId} = capabilitySet;
  const oldRecord = await exports.get({
    profileAgentId
  });

  // ensure sequence number for old set is one less than new set
  const {capabilitySet: oldSet} = oldRecord;
  const expectedSequence = oldSet.sequence + 1;
  if(capabilitySet.sequence !== expectedSequence) {
    throw new BedrockError(
      'Could not update profile agent capability set; ' +
      'unexpected sequence number.',
      'InvalidStateError', {
        public: true,
        httpStatusCode: 409,
        actual: capabilitySet.sequence,
        expected: expectedSequence
      });
  }

  // FIXME: Add new revocation code
  // // determine which zcaps must be revoked
  // const zcapsToRevoke = getZcapsToRevoke({oldSet, newSet: capabilitySet});

  // // revoke old zcaps
  // const profile = await profiles.get({id: profileId});
  // const keystoreAgent = await profiles.getKeystoreAgent({id: profileId});
  // await revokeCapabilities({profile, keystoreAgent, zcaps: zcapsToRevoke});

  // update record
  const query = {
    'capabilitySet.profileAgent': profileAgentId,
    'capabilitySet.sequence': oldSet.sequence
  };
  const $set = {
    'meta.updated': Date.now(),
    capabilitySet
  };
  const collection = utils.getCollection('profile-profileAgentCapabilitySet');
  const result = await collection.update(query, {$set}, database.writeOptions);
  if(result.result.n === 0) {
    const details = {
      profileAgent: profileAgentId,
      httpStatusCode: 400,
      public: true
    };
    throw new BedrockError(
      'Could not update profile agent capability set; ' +
      'set either not found or unexpected sequence number.',
      'InvalidStateError', details);
  }
};

// remove a capability set
exports.remove = async ({profileAgentId} = {}) => {
  assert.string(profileAgentId, 'profileAgentId');

  // update existing capability set to have no zcaps, revoking any as needed
  const oldRecord = await exports.get({profileAgentId});
  const {capabilitySet} = oldRecord;
  capabilitySet.sequence++;
  capabilitySet.zcaps = [];
  await exports.update({capabilitySet});

  // remove capability set if sequence matches
  const query = {
    'capabilitySet.profileAgent': profileAgentId,
    'capability.sequence': capabilitySet.sequence
  };
  const collection = utils.getCollection('profile-profileAgentCapabilitySet');
  const result = await collection.remove(query);
  if(result.result.n === 0) {
    const details = {
      profileAgent: profileAgentId,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError(
      'Profile agent capability set with expected sequence not found.',
      'NotFoundError', details);
  }
};

function _assertCapabilitySet(capabilitySet) {
  assert.object(capabilitySet, 'capabilitySet');
  assert.string(capabilitySet.profileAgent, 'capabilitySet.profileAgent');
  assert.arrayOfObject(capabilitySet.zcaps, 'capabilitySet.zcaps');

  const {sequence} = capabilitySet;
  assert.number(sequence, 'capabilitySet.sequence');
  if(!(Number.isInteger(sequence) && sequence >= 0)) {
    throw new TypeError(
      '"capabilitySet.sequence" must be a non-negative integer.');
  }
}

// function getZcapsToRevoke({oldSet, newSet}) {
//   // return all zcaps in the old set that are not present in the new one
//   const zcapSet = new Set(newSet.zcaps.map(({id}) => id));
//   return oldSet.zcaps.filter(({id}) => !zcapSet.has(id));
// }
