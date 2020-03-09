/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const base64url = require('base64url-universal');
const bedrock = require('bedrock');
const crypto = require('crypto');
const {CapabilityAgent} = require('webkms-client');
const database = require('bedrock-mongodb');
const {promisify} = require('util');
const capabilitySets = require('./capabilitySets');
const kms = require('./kms');
const utils = require('./utils');
const zcaps = require('./zcaps');

const {util: {BedrockError}} = bedrock;

const KMS_MODULE = 'ssm-v1';

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await promisify(database.openCollections)(['profile-profileAgent']);

  await promisify(database.createIndexes)([{
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
  }]);
});

/**
 * Creates a ProfileAgent and associates it with an account if provided.
 *
 * @param {String} accountId the id of the account to associate with the
 *                           ProfileAgent.
 *
 * @return {Promise<Object>} resolves to a ProfileAgent.
 */
exports.create = async ({accountId, profileId} = {}) => {
  // 1. Generate a random secret
  const secret = base64url.encode(crypto.randomBytes(32));
  const handle = 'primary';
  // 2. Generate capability agent to represent controller of profile agent
  //    (and its zcap key)
  const controller = await CapabilityAgent.fromSecret({handle, secret});
  // 3. Create keystore in order to create the zCap key for the profile agent
  // TODO: Will want to store the capability agent up here first, otherwise we
  //       have no clean way of cleaning up the other stuff that gets created
  //       on other systems should we experience a failure.
  const keystore = await kms.createKeystore(
    {capabilityAgent: controller, referenceId: 'primary'});
  // 4. Create the zCap key for the profile agent
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystore});
  const key = await keystoreAgent.generateKey(
    {type: 'Ed25519VerificationKey2018', kmsModule: KMS_MODULE});
  // 5. Use the zCap key to create the DID for the profile agent
  await utils.setKeyId({key});
  // 6. Generate profile agent's CapabilityAgent instance
  // TODO: This should be using a .from*() method, but we don't have one yet.
  //       In the docs for CapabilityAgent, it says to never call the
  //       constructor directly.
  const capabilityAgent = new CapabilityAgent({handle: 'primary', signer: key});
  // 7. Create keystore to store keys controlled by the profile agent
  const paKeystore = await kms.createKeystore(
    {capabilityAgent, referenceId: 'primary'});
  const profileAgent = {
    id: capabilityAgent.id,
    sequence: 0,
    account: accountId,
    profile: profileId,
    controller: {
      id: controller.id,
      seed: secret,
      keystore: keystore.id
    },
    keystore: paKeystore.id,
    capabilityInvocationKey: (await key.getKeyDescription()).id
  };
  const now = Date.now();
  const meta = {created: now, updated: now};
  let record = {
    meta,
    profileAgent
  };
  try {
    const collection = utils.getCollection('profile-profileAgent');
    const result = await collection.insert(record, database.writeOptions);
    const capabilitySet = {
      sequence: 0,
      profileAgent: profileAgent.id,
      zcaps: []
    };
    await capabilitySets.create({capabilitySet});
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
 * Get a Profile Agent
 *
 * @param {String} id the id of the ProfileAgent.
 *
 * @return {Promise<Object>} resolves to a ProfileAgent.
 */
exports.get = async ({id} = {}) => {
  assert.string(id, 'id');

  const query = {'profileAgent.id': id};
  const collection = utils.getCollection('profile-profileAgent');
  const record = await collection.findOne(query, {_id: 0});
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
 * Get all Profile Agent(s)
 *
 * @param {String} accountId the id of the account associated with the
 *                           ProfileAgent(s).
 *
 * @return {Promise<Arrray<ProfileAgent>>} resolves to a ProfileAgent(s).
 */
exports.getAll = async ({accountId} = {}) => {
  assert.string(accountId, 'accountId');

  const query = {'profileAgent.account': accountId};
  const collection = utils.getCollection('profile-profileAgent');
  return collection.find(query, {_id: 0}).toArray();
};

/**
 * Get a Profile Agent
 *
 * @param {String} profileId the id of the profile associated with the
 *                           ProfileAgent.
 * @param {String} accountId the id of the account associated with the
 *                           ProfileAgent.
 *
 * @return {Promise<Object>} resolves to a ProfileAgent.
 */
exports.getByProfile = async ({accountId, profileId} = {}) => {
  assert.string(accountId, 'accountId');
  assert.string(profileId, 'profileId');

  const query = {
    'profileAgent.account': accountId,
    'profileAgent.profile': profileId
  };
  const collection = utils.getCollection('profile-profileAgent');
  const record = await collection.findOne(query, {_id: 0});
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
 * Get a Profile Agent
 *
 * @param {Object} profileAgent the updated profile agent.
 *
 * @return {Promise<Object>} resolves to a ProfileAgent.
 */
exports.update = async ({profileAgent} = {}) => {
  _assertProfileAgent(profileAgent);

  // get existing capability set
  const {id} = profileAgent;
  const oldRecord = await exports.get({id});

  // ensure sequence number for old set is one less than new set
  const {profileAgent: oldProfileAgent} = oldRecord;
  const expectedSequence = oldProfileAgent.sequence + 1;

  if(profileAgent.sequence !== expectedSequence) {
    throw new BedrockError(
      'Could not update profile agent; ' +
      'unexpected sequence number.',
      'InvalidStateError', {
        public: true,
        httpStatusCode: 409,
        actual: profileAgent.sequence,
        expected: expectedSequence
      });
  }

  // update record
  const query = {
    'profileAgent.id': id,
    'profileAgent.sequence': oldProfileAgent.sequence
  };
  const $set = {
    'meta.updated': Date.now(),
    profileAgent
  };
  const collection = utils.getCollection('profile-profileAgent');
  const result = await collection.update(query, {$set}, database.writeOptions);
  if(result.result.n === 0) {
    const details = {
      profileAgent: id,
      httpStatusCode: 400,
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

  const oldRecord = await exports.get({id});
  const {profileAgent} = oldRecord;

  // remove profile agent if sequence matches
  const query = {
    'profileAgent.id': id,
    'profileAgent.sequence': profileAgent.sequence
  };
  const collection = utils.getCollection('profile-profileAgent');
  const result = await collection.remove(query);
  if(result.result.n === 0) {
    const details = {
      id,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError(
      'Profile agent with expected sequence not found.',
      'NotFoundError', details);
  }
};

exports.delegateCapabilities = async (
  {profileAgent, capabilities, controller} = {}) => {
  _assertProfileAgent(profileAgent);
  assert.array(capabilities, 'capabilities');
  assert.string(controller, 'controller');
  const {capabilityAgent} = await exports.getAgents({profileAgent});
  const invocationSigner = capabilityAgent.getSigner();
  const promises = capabilities.map(async parentZcap => {
    const {zcap, capabilityChain} = await _createZcap({parentZcap, controller});
    return zcaps.delegate({zcap, signer: invocationSigner, capabilityChain});
  });
  // TODO: Find proper promise-fun library for concurrency
  return Promise.all(promises);
};

exports.getAgents = async ({profileAgent} = {}) => {
  _assertProfileAgent(profileAgent);
  const {
    controller: {seed, keystore: keystoreId},
    keystore: paKeystoreId,
    capabilityInvocationKey
  } = profileAgent;
  const controller =
    await CapabilityAgent.fromSecret({handle: 'primary', secret: seed});
  const keystore = await kms.getKeystore({id: keystoreId});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: controller, keystore});
  const key = await keystoreAgent.getAsymmetricKey(
    {id: capabilityInvocationKey, type: 'Ed25519VerificationKey2018'});
  await utils.setKeyId({key});
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

function _assertProfileAgent(profileAgent) {
  assert.object(profileAgent, 'profileAgent');
  assert.string(profileAgent.id, 'profileAgent.id');
  assert.string(profileAgent.keystore, 'profileAgent.keystore');
  assert.string(profileAgent.capabilityInvocationKey,
    'profileAgent.capabilityInvocationKey');
  assert.object(profileAgent.controller, 'profileAgent.controller');

  const {sequence} = profileAgent;
  assert.number(sequence, 'profileAgent.sequence');
  if(!(Number.isInteger(sequence) && sequence >= 0)) {
    throw new TypeError(
      '"profileAgent.sequence" must be a non-negative integer.');
  }
}
