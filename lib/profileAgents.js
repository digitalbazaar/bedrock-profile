/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import * as kms from './kms.js';
import * as meterClient from './meterClient.js';
import * as profileMeters from './profileMeters.js';
import * as utils from './utils.js';
import * as zcaps from './zcaps.js';
import {createRequire} from 'module';
const require = createRequire(import.meta.url);
const assert = require('assert-plus');
const {CapabilityAgent} = require('@digitalbazaar/webkms-client');

const {
  assertKeystoreOptions,
  createCapabilityAgent,
  getCollection,
  getPublicAliasTemplate
} = utils;
const {util: {BedrockError}} = bedrock;

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections(['profile-profileAgent']);

  await database.createIndexes([{
    collection: 'profile-profileAgent',
    fields: {'profileAgent.id': 1},
    options: {unique: true, background: false}
  }, {
    collection: 'profile-profileAgent',
    fields: {'profileAgent.profile': 1},
    options: {unique: false, background: false}
  }, {
    collection: 'profile-profileAgent',
    fields: {'profileAgent.controller': 1},
    options: {unique: true, background: false}
  }, {
    collection: 'profile-profileAgent',
    fields: {'profileAgent.id': 1, 'profileAgent.sequence': 1},
    options: {unique: false, background: false}
  }, {
    collection: 'profile-profileAgent',
    fields: {'profileAgent.account': 1, 'profileAgent.id': 1},
    options: {
      partialFilterExpression: {account: {$exists: true}},
      unique: true,
      background: false
    }
  }, {
    collection: 'profile-profileAgent',
    fields: {'secrets.token': 1},
    options: {
      partialFilterExpression: {'secrets.token': {$exists: true}},
      unique: true,
      background: false
    }
  }]);
});

/**
 * Creates a ProfileAgent record and inserts it into the database if specified.
 *
 * @param {object} options - The options to use.
 * @param {KeystoreOptions} options.keystoreOptions - The keystore options to
 *   use.
 * @param {boolean} options.store - True to store the record, false to just
 *   return it for later modification and storage.
 * @param {string} [options.profileId] - The ID of a profile.
 * @param {string} [options.accountId] - The ID of an account.
 * @param {string} [options.token] - An application token.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent record.
 */
export async function create({
  keystoreOptions, accountId, profileId, token, store
} = {}) {
  assert.bool(store, 'store');

  const {profileAgent, secrets} = await _createProfileAgent({
    keystoreOptions, accountId, profileId, token
  });

  const now = Date.now();
  const meta = {created: now, updated: now};
  const record = {
    meta,
    profileAgent,
    secrets,
  };
  if(!store) {
    return record;
  }

  return insert({record});
}

/**
 * Get a Profile Agent.
 *
 * @param {object} options - The options to use.
 * @param {string} options.id - The ID of the ProfileAgent.
 * @param {boolean} [options.includeSecrets=false] - Include secrets
 *   in the result.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent record.
 */
export async function get({id, includeSecrets = false} = {}) {
  assert.string(id, 'id');

  const query = {'profileAgent.id': id};
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = getCollection('profile-profileAgent');
  const record = await collection.findOne(query, {projection});
  // FIXME: if `record` exists but is for an incomplete profile, delete it
  // and return not found; this handles previously created partial profiles
  // that now cannot complete provisioning; it will not affect profiles being
  // created through the new continuable provisioning process

  if(!record) {
    const details = {
      profileAgent: id,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError(
      'Profile agent not found.',
      'NotFoundError', details);
  }
  return record;
}

/**
 * Get all Profile Agent(s).
 *
 * @param {object} options - The options to use.
 * @param {string} options.accountId - The ID of the account associated with the
 *   ProfileAgent(s).
 * @param {boolean} [options.includeSecrets=false] - Include secrets in the
 *   results.
 *
 * @returns {Promise<Array<object>>} Resolves to a ProfileAgent record(s).
 */
export async function getAll({accountId, includeSecrets = false} = {}) {
  assert.string(accountId, 'accountId');

  const query = {'profileAgent.account': accountId};
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = getCollection('profile-profileAgent');
  return collection.find(query, {projection}).toArray();
}

/**
 * Get a Profile Agent.
 *
 * @param {object} options - The options to use.
 * @param {string} options.profileId - The ID of the profile associated
 *   with the ProfileAgent.
 * @param {string} options.accountId - The ID of the account associated with the
 *   ProfileAgent.
 * @param {boolean} [options.includeSecrets=false] - Include secrets in the
 *   result.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent record.
 */
export async function getByProfile({
  accountId, profileId, includeSecrets = false
} = {}) {
  assert.string(accountId, 'accountId');
  assert.string(profileId, 'profileId');

  const query = {
    'profileAgent.account': accountId,
    'profileAgent.profile': profileId
  };
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = getCollection('profile-profileAgent');
  const record = await collection.findOne(query, {projection});
  if(!record) {
    const details = {
      'profileAgent.account': accountId,
      'profileAgent.profile': profileId,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError(
      'Profile agent not found.',
      'NotFoundError', details);
  }
  return record;
}

/**
 * Get a Profile Agent by token.
 *
 * @param {object} options - The options to use.
 * @param {string} options.token - The token associated with the profileAgent.
 * @param {boolean} [options.includeSecrets=false] - Include secrets in the
 *   result.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent record.
 */
export async function getByToken({token, includeSecrets = false} = {}) {
  assert.string(token, 'token');

  const query = {
    'secrets.token': token,
  };
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = getCollection('profile-profileAgent');
  const record = await collection.findOne(query, {projection});
  if(!record) {
    throw new BedrockError(
      'Profile agent not found.', 'NotFoundError', {
        token,
        httpStatusCode: 404,
        public: true
      });
  }
  return record;
}

/**
 * Inserts a previously created / modified ProfileAgent record into the
 * database.
 *
 * @param {object} options - The options to use.
 * @param {object} options.record - The profile agent record to insert.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent record.
 */
export async function insert({record} = {}) {
  assert.object(record, 'record');
  assert.object(record.meta, 'record.meta');
  assert.object(record.profileAgent, 'record.profileAgent');
  assert.object(record.secrets, 'record.secrets');

  try {
    const collection = getCollection('profile-profileAgent');
    const result = await collection.insertOne(record, database.writeOptions);
    record = result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError(
      'Duplicate profile agent.',
      'DuplicateError', {
        public: true,
        httpStatusCode: 409
      }, e);
  }
  return record;
}

/**
 * Update a Profile Agent.
 *
 * @param {object} options - The options to use.
 * @param {object} options.profileAgent - The updated profile agent.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent.
 */
export async function update({profileAgent} = {}) {
  _assertProfileAgent(profileAgent);

  // update record
  const {id} = profileAgent;
  const query = {
    'profileAgent.id': id,
    // existing profile agent must be `1` before the new update
    'profileAgent.sequence': profileAgent.sequence - 1
  };
  const $set = {
    'meta.updated': Date.now(),
    profileAgent
  };
  const collection = getCollection('profile-profileAgent');
  const result = await collection.updateOne(
    query, {$set}, database.writeOptions);
  if(result.result.n === 0) {
    const details = {
      profileAgent: id,
      httpStatusCode: 409,
      public: true
    };
    throw new BedrockError(
      'Could not update profile agent; ' +
      'profile agent either not found or unexpected sequence number.',
      'InvalidStateError', details);
  }
}

// remove a profile agent
export async function remove({id, account} = {}) {
  assert.string(id, 'id');
  assert.optionalString(account, 'account');

  const query = {'profileAgent.id': id};
  if(account) {
    // account must also match, if given
    query['profileAgent.account'] = account;
  }
  const collection = getCollection('profile-profileAgent');
  const result = await collection.deleteOne(query);
  if(result.result.n === 0) {
    const details = {
      id,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError(
      'Profile agent not found.',
      'NotFoundError', details);
  }
}

export async function delegateCapabilities(
  {profileAgent, capabilities, controller, secrets, expires} = {}) {
  _assertProfileAgent(profileAgent);
  assert.object(secrets, 'secrets');
  assert.array(capabilities, 'capabilities');
  assert.string(controller, 'controller');
  const {capabilityAgent} = await getAgents({profileAgent, secrets});
  const signer = capabilityAgent.getSigner();
  const promises = capabilities.map(async parentZcap =>
    zcaps.delegate({capability: parentZcap, controller, signer, expires}));
  // TODO: Find proper promise-fun library for concurrency
  return Promise.all(promises);
}

export async function getAgents({profileAgent, secrets} = {}) {
  _assertProfileAgent(profileAgent);
  assert.object(secrets, 'secrets');
  const {keystore: keystoreId, capabilityInvocationKey} = profileAgent;
  const {seed} = secrets;
  const controller = await CapabilityAgent.fromSecret(
    {handle: 'primary', secret: seed});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystoreId});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);
  const capabilityAgent = new CapabilityAgent({handle: 'primary', signer: key});
  return {capabilityAgent, keystoreAgent};
}

export async function getSigner({profileAgentRecord}) {
  const {profileAgent, secrets: {seed}} = profileAgentRecord;
  const {keystore: keystoreId, capabilityInvocationKey} = profileAgent;
  const controller = await CapabilityAgent.fromSecret(
    {handle: 'primary', secret: seed});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystoreId});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);
  return key;
}

export async function completeProfileProvisioning({profileAgentRecord}) {
  const {profileAgent} = profileAgentRecord;
  if(!profileAgent._meters) {
    // already complete
    return {meters: null};
  }

  /* In parallel:
  1. Update the controllers for the KMS and EDV meters, changing them
    the local application to the profile. This update function must be written
    in a loop, allowing for concurrent updates. If a concurrent update occurs,
    the function must treat errors that are thrown because the meter
    controllers have already been changed to the profile (by a concurrent
    process that is also continuing the provisioning process) as success.
    Other errors must be thrown.
  2. Write the meters to the profile meter collection. This function must
    ignore duplicate errors; others must be thrown. Duplicate errors will
    be thrown when a concurrent process inserts the meters because it is
    also continuing the provisioning process. */
  const {profile: profileId, _meters: {edvMeter, kmsMeter}} = profileAgent;
  const [, , ...meters] = await Promise.all([
    _updateMeterController({meterId: kmsMeter.id, controller: profileId}),
    _updateMeterController({meterId: edvMeter.id, controller: profileId}),
    _insertMeter({meter: kmsMeter}),
    _insertMeter({meter: edvMeter})
  ]);

  while(profileAgentRecord.profileAgent._meters) {
    /* 3. Remove the meters from the profile agent record, signaling that the
      provisioning process is complete and does not need to be continued by
      any other process. This update function must be written in a loop,
      allowing for concurrent updates. If a concurrent update occurs, the
      function must treat errors that are thrown because the profile agent
      record has already been updated to remove the meters (by a concurrent
      process that is also continuing the provisioning process) as success.
      Other errors must be thrown. */
    const {profileAgent} = profileAgentRecord;
    const newProfileAgent = {
      ...profileAgent,
      sequence: profileAgent.sequence + 1,
    };
    delete newProfileAgent._meters;
    try {
      await update({profileAgent: newProfileAgent});
      profileAgentRecord = {
        ...profileAgentRecord,
        profileAgent: newProfileAgent
      };
      break;
    } catch(e) {
      if(e.name !== 'InvalidStateError') {
        throw e;
      }
      // concurrent process updated profile, get updated profile and try again
      profileAgentRecord = await get(
        {id: profileAgent.id, includeSecrets: true});
    }
  }

  return {meters, profileAgentRecord};
}

function _assertProfileAgent(profileAgent) {
  assert.object(profileAgent, 'profileAgent');
  assert.string(profileAgent.id, 'profileAgent.id');
  assert.string(profileAgent.keystore, 'profileAgent.keystore');
  assert.object(profileAgent.capabilityInvocationKey,
    'profileAgent.capabilityInvocationKey');
  assert.string(profileAgent.controller, 'profileAgent.controller');

  const {sequence} = profileAgent;
  assert.number(sequence, 'profileAgent.sequence');
  if(!(Number.isInteger(sequence) && sequence >= 0)) {
    throw new TypeError(
      '"profileAgent.sequence" must be a non-negative integer.');
  }
}

async function _createProfileAgent({
  keystoreOptions, accountId, profileId, token
}) {
  assertKeystoreOptions(keystoreOptions, 'keystoreOptions');
  assert.optionalString(profileId, 'profileId');
  assert.optionalString(accountId, 'accountId');
  assert.optionalString(token, 'token');

  if(accountId && token) {
    throw new TypeError(
      '"accountId" and "token" are mutually exclusive options.');
  }
  if(!(accountId || profileId)) {
    throw new TypeError('"profileId" or "accountId" is required.');
  }

  // 1. Generate a new capability agent to represent controller of profile
  //   agent and its keystore.
  const {
    capabilityAgent: controller,
    secret: seed
  } = await createCapabilityAgent();
  // 2. Create keystore to store the profile agent's keys.
  const keystore = await kms.createKeystore({
    ...keystoreOptions,
    /* Note: This keystore must be IP restricted because it is accessed by a
    `capabilityAgent` that is generated from a secret that is stored in the
    database. If the database is stolen, the attacker cannot use the secret
    to hit the keystore without also breaking into the network and generating
    a request from an acceptable IP. Delegating zcaps for accessing the
    profile agent's keys is not supported. */
    applyIpAllowList: true,
    controller: controller.id
  });
  // 3. Create the zCap key for the profile agent.
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystoreId: keystore.id});
  const key = await keystoreAgent.generateKey({
    type: 'asymmetric',
    publicAliasTemplate: getPublicAliasTemplate({didMethod: 'key'})
  });

  // 4. Use the zCap key to create the DID for the profile agent.
  const profileAgentId = key.id.slice(0, key.id.indexOf('#'));

  const profileAgent = {
    id: profileAgentId,
    sequence: 0,
    account: accountId,
    profile: profileId,
    controller: controller.id,
    keystore: keystore.id,
    capabilityInvocationKey: {
      id: key.id,
      type: key.type,
      kmsId: key.kmsId
    }
  };

  const secrets = {seed};
  if(token) {
    secrets.token = token;
  }

  return {profileAgent, secrets};
}

async function _insertMeter({meter}) {
  let record;
  try {
    record = await profileMeters.add({meter});
  } catch(e) {
    if(e.name !== 'DuplicateError') {
      throw e;
    }
    record = await profileMeters.get({id: meter.id});
  }
  return record;
}

async function _updateMeterController({meterId, controller}) {
  const {ZCAP_CLIENT: {invocationSigner}} = utils;

  try {
    while(true) {
      // note: if the meter controller does not match the local application ID,
      // then a `NotAllowedError` will be thrown
      const {meter} = await meterClient.get({url: meterId, invocationSigner});
      meter.controller = controller;

      try {
        await meterClient.update({meter, url: meterId, invocationSigner});
      } catch(e) {
        if((e.data && e.data.type) !== 'InvalidStateError') {
          throw e;
        }
        // invalid state error when updating means sequence didn't match
        // because meter was changed by another concurrent process, so loop to
        // try again
      }
    }
  } catch(e) {
    // if getting or updating the meter is not allowed; we presume it has
    // already been updated to the profile ID -- future code could be added to
    // attempt to get the meter using the profile's invocation signer if it
    // is really necessary to verify this assumption
    if((e.data && e.data.type === 'NotAllowedError')) {
      return;
    }
  }
}

/**
 * @typedef {object} KeystoreOptions
 * @property {object} meterId - The full URL ID of the meter; to be given to
 *   the KMS service when creating a keystore.
 * @property {object} meterCapabilityInvocationSigner - The invocation signer
 *   to use to create a keystore associated with the given meter capability.
 * @property {string} [options.kmsModule] - The KMS module to use to create
 *   a keystore.
 */
