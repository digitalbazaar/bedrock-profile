/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const bedrock = require('bedrock');
const {CapabilityAgent} = require('@digitalbazaar/webkms-client');
const database = require('bedrock-mongodb');
const kms = require('./kms');
const utils = require('./utils');
const zcaps = require('./zcaps');
const {promisify} = require('util');

const randomBytesAsync = promisify(require('crypto').randomBytes);

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
 * Creates a ProfileAgent and associates it with an account if provided.
 *
 * @param {object} options - The options to use.
 * @param {KeystoreOptions} options.keystoreOptions - The keystore options to
 *   use.
 * @param {string} [options.profileId] - The ID of a profile.
 * @param {string} [options.accountId] - The ID of an account.
 * @param {string} [options.token] - An application token.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent.
 */
exports.create = async ({
  keystoreOptions, accountId, profileId, token
} = {}) => {
  utils.assertKeystoreOptions(keystoreOptions, 'keystoreOptions');
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

  // 1. Generate a random secret.
  const secret = await randomBytesAsync(32);
  const handle = 'primary';
  // 2. Generate capability agent to represent controller of profile agent
  //   and its keystore.
  const controller = await CapabilityAgent.fromSecret({handle, secret});
  // 3. Create keystore to store the profile agent's keys.
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
  // 4. Create the zCap key for the profile agent.
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystoreId: keystore.id});
  const publicAliasTemplate = utils.getPublicAliasTemplate({
    didMethod: 'key'
  });
  const key = await keystoreAgent.generateKey({
    type: 'asymmetric',
    publicAliasTemplate
  });

  // 5. Use the zCap key to create the DID for the profile agent.
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

  const secrets = {seed: secret};
  if(token) {
    secrets.token = token;
  }

  const now = Date.now();
  const meta = {created: now, updated: now};
  let record = {
    meta,
    profileAgent,
    secrets,
  };
  try {
    const collection = utils.getCollection('profile-profileAgent');
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
};

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
exports.get = async ({id, includeSecrets = false} = {}) => {
  assert.string(id, 'id');

  const query = {'profileAgent.id': id};
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = utils.getCollection('profile-profileAgent');
  const record = await collection.findOne(query, {projection});
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
};

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
exports.getAll = async ({accountId, includeSecrets = false} = {}) => {
  assert.string(accountId, 'accountId');

  const query = {'profileAgent.account': accountId};
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = utils.getCollection('profile-profileAgent');
  return collection.find(query, {projection}).toArray();
};

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
exports.getByProfile = async ({
  accountId, profileId, includeSecrets = false
} = {}) => {
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
  const collection = utils.getCollection('profile-profileAgent');
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
};

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
exports.getByToken = async ({token, includeSecrets = false} = {}) => {
  assert.string(token, 'token');

  const query = {
    'secrets.token': token,
  };
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = utils.getCollection('profile-profileAgent');
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
};

/**
 * Update a Profile Agent.
 *
 * @param {object} options - The options to use.
 * @param {object} options.profileAgent - The updated profile agent.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent.
 */
exports.update = async ({profileAgent} = {}) => {
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
  const collection = utils.getCollection('profile-profileAgent');
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
};

// remove a profile agent
exports.remove = async ({id} = {}) => {
  assert.string(id, 'id');

  const query = {'profileAgent.id': id};
  const collection = utils.getCollection('profile-profileAgent');
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
};

exports.delegateCapabilities = async (
  {profileAgent, capabilities, controller, secrets, expires} = {}) => {
  _assertProfileAgent(profileAgent);
  assert.object(secrets, 'secrets');
  assert.array(capabilities, 'capabilities');
  assert.string(controller, 'controller');
  const {capabilityAgent} = await exports.getAgents({profileAgent, secrets});
  const signer = capabilityAgent.getSigner();
  const promises = capabilities.map(async parentZcap => {
    return zcaps.delegate(
      {capability: parentZcap, controller, signer, expires});
  });
  // TODO: Find proper promise-fun library for concurrency
  return Promise.all(promises);
};

// FIXME: remove; this delegation is not permitted
exports.delegateCapabilityInvocationKey = async ({
  profileAgent, invoker, secrets, expires
}) => {
  assert.object(secrets, 'secrets');
  const {
    keystore: keystoreId,
    capabilityInvocationKey
  } = profileAgent;
  const {seed} = secrets;
  const controller = await CapabilityAgent.fromSecret(
    {handle: 'primary', secret: seed});

  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystoreId});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);

  const request = {
    // string should match KMS ops
    allowedAction: 'sign',
    controller: invoker,
    invocationTarget: capabilityInvocationKey.kmsId,
    // FIXME: Figure out where to put type information
    type: capabilityInvocationKey.type,
    // FIXME: Figure out if we still use publicAlias
    publicAlias: key.id,
    parentCapability: `urn:zcap:root:${encodeURIComponent(keystoreId)}`,
    expires
  };

  const profileAgentCapabilityInvocationKeyDelegation =
    await zcaps.delegateCapability({
      request,
      signer: controller.getSigner()
    });

  return profileAgentCapabilityInvocationKeyDelegation;
};

exports.getAgents = async ({profileAgent, secrets} = {}) => {
  _assertProfileAgent(profileAgent);
  assert.object(secrets, 'secrets');
  const {
    controller: {keystore: keystoreId},
    keystore: paKeystoreId,
    capabilityInvocationKey
  } = profileAgent;
  const {seed} = secrets;
  const controller = await CapabilityAgent.fromSecret(
    {handle: 'primary', secret: seed});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystoreId});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);
  // TODO: This should be using a .from*() method, but we don't have one yet.
  //       In the docs for CapabilityAgent, it says to never call the
  //       constructor directly.
  const capabilityAgent = new CapabilityAgent({handle: 'primary', signer: key});
  const paKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent, keystoreId: paKeystoreId});
  return {capabilityAgent, keystoreAgent: paKeystoreAgent};
};

exports.getSigner = async ({profileAgentRecord}) => {
  const {profileAgent, secrets: {seed}} = profileAgentRecord;
  const {
    controller: {keystore: keystoreId},
    capabilityInvocationKey
  } = profileAgent;
  const controller = await CapabilityAgent.fromSecret(
    {handle: 'primary', secret: seed});

  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystoreId});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);

  return key;
};

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

/**
 * @typedef {object} KeystoreOptions
 * @property {object} meterId - The full URL ID of the meter; to be given to
 *   the KMS service when creating a keystore.
 * @property {object} meterCapabilityInvocationSigner - The invocation signer
 *   to use to create a keystore associated with the given meter capability.
 * @property {string} [options.kmsModule] - The KMS module to use to create
 *   a keystore.
 */
