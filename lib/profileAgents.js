/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
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
 * @param {object} options.kmsMeterCapability - The meter capability to
 *   give to the KMS service when creating keystores associated with the
 *   profile agent.
 * @param {string} [options.profileId] - The ID of a profile.
 * @param {string} [options.accountId] - The ID of an account.
 * @param {string} [options.token] - An application token.
 * @param {string} [options.kmsModule] - The KMS module to use to create the
 *   profile agent's keystore.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent.
 */
exports.create = async ({
  kmsMeterCapability, accountId, profileId, token, kmsModule
} = {}) => {
  assert.object(kmsMeterCapability, 'kmsMeterCapability');
  assert.optionalString(profileId, 'profileId');
  assert.optionalString(accountId, 'accountId');
  assert.optionalString(token, 'token');
  assert.optionalString(kmsModule, 'kmsModule');

  if(accountId && token) {
    throw new TypeError(
      '"accountId" and "token" are mutually exclusive options.');
  }
  if(!(accountId || profileId)) {
    throw new TypeError('"profileId" or "accountId" is required.');
  }

  // FIXME: try to remove the capability agent keystore here to reduce
  // complexity; do this by making the profile agent keystore IP restricted
  // to the application that installed bedrock-profile and always delegate
  // zcaps to ephemeral did:keys when using it; the controller of that keystore
  // will still be a capability agent that is generated from a secret stored
  // in the application's database but only during bootstrapping afterwhich
  // it will be changed to the profile agent's controller; this will mirror
  // how the profile keystore works when it is bootstrapped by a profile agent
  // and then changed to the profile; a zcap for the root capability invocation
  // key must be given to the capability agent and stored along with it that
  // will allow it to delegate zcaps to ephemeral did:keys; the capability
  // agent can be rotated to a new one by invoking this zcap to use the
  // capability delegation key of the profile agent to delegate a new zcap
  // to the newly rotated capability agent (if ever necessary); this
  // optimization can't happen, however, without other changes in
  // bedrock-web-profile-manager, etc. -- so until then, the capability agent
  // keystore used here should be created using the same meter as the
  // profile agent

  // FIXME: the application that installs bedrock-profile will always be
  // the controller of meters, this should be configured;
  // the app will sign the zcap invocation for creating the keystore using
  // its own keys

  // FIXME: a new meter should be created for both the profile agent keystore
  // and the profile keystore; these keystores will be created by the app
  // ... the creation may need a hook function OR, MORE LIKELY, will need
  // to have already happened and the meter usage capability will just be
  // passed in (when creating a profile, one capability for the profile's
  // keystore meter and another for the profile agent's keystore meter)

  // 1. Generate a random secret.
  const secret = await randomBytesAsync(32);
  const handle = 'primary';
  // 2. Generate capability agent to represent controller of profile agent
  //   (and its zcap key).
  const controller = await CapabilityAgent.fromSecret({handle, secret});
  // 3. Create keystore in order to create the zCap key for the profile agent.
  //  This keystore must be IP restricted because it is accessed by a
  //  `capabilityAgent` that is generated from a secret that is stored in the
  //  database. If the database is stolen, the attacker cannot use the secret
  //  to hit the keystore without also breaking into the network and generating
  //  a request from an acceptable IP. Delegating zcaps for accessing the
  //  capability agent's keys is not supported.
  // TODO: Will want to store the capability agent up here first, otherwise we
  //   have no clean way of cleaning up the other stuff that gets created
  //   on other systems should we experience a failure.
  const keystore = await kms.createKeystore({
    applyIpAllowList: true,
    capabilityAgent: controller,
    meterCapability: kmsMeterCapability,
    kmsModule
  });
  // 4. Create the zCap key for the profile agent.
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystore});
  const key = await keystoreAgent.generateKey({type: 'asymmetric'});
  // 5. Use the zCap key to create the DID for the profile agent.
  key.id = await utils.computeKeyId({key, didMethod: 'key'});
  // 6. Generate profile agent's CapabilityAgent instance.
  // TODO: This should be using a .from*() method, but we don't have one yet.
  //   In the docs for CapabilityAgent, it says to never call the
  //   constructor directly.
  const capabilityAgent = new CapabilityAgent({handle: 'primary', signer: key});
  // 7. Create keystore to store keys controlled by the profile agent
  const paKeystore = await kms.createKeystore({
    // FIXME: change this to only be accessible via the IP allow list's IPs;
    // do not allow direct invocation via this keystore, only allow that with
    // a profile's keystore

    // this keystore must be accessible from any IP; it needs to support
    // delegated zcaps, it defers key security to external parties at the edge
    // where there is no centralized "honey pot" of keys to attempt to steal
    applyIpAllowList: false,
    capabilityAgent,
    meterCapability: kmsMeterCapability,
    kmsModule
  });
  const profileAgent = {
    id: capabilityAgent.id,
    sequence: 0,
    account: accountId,
    profile: profileId,
    controller: {
      id: controller.id,
      keystore: keystore.id
    },
    keystore: paKeystore.id,
    capabilityInvocationKey: {
      id: key.id,
      type: key.type,
      kmsId: (await key.getKeyDescription()).id
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
  {profileAgent, capabilities, controller, secrets} = {}) => {
  _assertProfileAgent(profileAgent);
  assert.object(secrets, 'secrets');
  assert.array(capabilities, 'capabilities');
  assert.string(controller, 'controller');
  const {capabilityAgent} = await exports.getAgents({profileAgent, secrets});
  const invocationSigner = capabilityAgent.getSigner();
  const promises = capabilities.map(async parentZcap => {
    const {zcap, capabilityChain} = await _createZcap({parentZcap, controller});
    return zcaps.delegate({zcap, signer: invocationSigner, capabilityChain});
  });
  // TODO: Find proper promise-fun library for concurrency
  return Promise.all(promises);
};

exports.delegateCapabilityInvocationKey = async ({
  profileAgent, invoker, secrets, expires
}) => {
  assert.object(secrets, 'secrets');
  const {
    controller: {keystore: keystoreId},
    capabilityInvocationKey
  } = profileAgent;
  const {seed} = secrets;
  const controller = await CapabilityAgent.fromSecret(
    {handle: 'primary', secret: seed});

  const keystore = await kms.getKeystore({id: keystoreId});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystore});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);

  const request = {
    referenceId: 'profileAgentCapabilityInvocationKey',
    // string should match KMS ops
    allowedAction: 'sign',
    invoker,
    invocationTarget: {
      id: capabilityInvocationKey.kmsId,
      type: capabilityInvocationKey.type,
      publicAlias: key.id
    },
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
  const keystore = await kms.getKeystore({id: keystoreId});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystore});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);
  // TODO: This should be using a .from*() method, but we don't have one yet.
  //       In the docs for CapabilityAgent, it says to never call the
  //       constructor directly.
  const capabilityAgent = new CapabilityAgent({handle: 'primary', signer: key});
  const paKeystore = await kms.getKeystore({id: paKeystoreId});
  const paKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent, keystore: paKeystore});
  return {capabilityAgent, keystoreAgent: paKeystoreAgent};
};

async function _createZcap({parentZcap, controller} = {}) {
  const zcap = {...parentZcap};
  delete zcap.invoker;
  delete zcap.delegator;
  delete zcap.proof;

  zcap.id = await zcaps.id();
  zcap.parentCapability = parentZcap.id;
  zcap.controller = controller;

  const capabilityChain = [
    ...parentZcap.proof.capabilityChain.map(
      zcap => typeof zcap === 'string' ? zcap : zcap.id),
    parentZcap
  ];
  return {zcap, capabilityChain};
}

exports.getSigner = async ({profileAgentRecord}) => {
  const {profileAgent, secrets: {seed}} = profileAgentRecord;
  const {
    controller: {keystore: keystoreId},
    capabilityInvocationKey
  } = profileAgent;
  const controller = await CapabilityAgent.fromSecret(
    {handle: 'primary', secret: seed});

  const keystore = await kms.getKeystore({id: keystoreId});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystore});
  const key = await keystoreAgent.getAsymmetricKey(capabilityInvocationKey);

  return key;
};

function _assertProfileAgent(profileAgent) {
  assert.object(profileAgent, 'profileAgent');
  assert.string(profileAgent.id, 'profileAgent.id');
  assert.string(profileAgent.keystore, 'profileAgent.keystore');
  assert.object(profileAgent.capabilityInvocationKey,
    'profileAgent.capabilityInvocationKey');
  assert.object(profileAgent.controller, 'profileAgent.controller');

  const {sequence} = profileAgent;
  assert.number(sequence, 'profileAgent.sequence');
  if(!(Number.isInteger(sequence) && sequence >= 0)) {
    throw new TypeError(
      '"profileAgent.sequence" must be a non-negative integer.');
  }
}
