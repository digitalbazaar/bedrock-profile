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
const kms = require('./kms');
const utils = require('./utils');
const zcaps = require('./zcaps');

const {util: {BedrockError}} = bedrock;

// load config defaults
require('./config');
const KMS_MODULE = 'ssm-v1';

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await promisify(database.openCollections)(['profile-profileAgent']);

  await promisify(database.createIndexes)([{
    // cover queries of a profile agent by its ID
    collection: 'profile-profileAgent',
    fields: {'profileAgent.id': 1},
    options: {unique: true, background: false}
  }, {
    // cover queries of a profile agent by its ID
    collection: 'profile-profileAgent',
    fields: {'profileAgent.profile': 1},
    options: {unique: false, background: false}
  }, {
    collection: 'profile-profileAgent',
    fields: {'profileAgent.controller': 1},
    options: {unique: true, background: false}
  }, {
    // cover queries of a profile agent by an account ID
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
 * @param {Object} account the account to associate with the ProfileAgent.
 *
 * @return {Promise<ProfileAgent>} resolves to a ProfileAgent.
 */
exports.create = async ({account}) => {
  // 1. Generate a random secret
  const secret = base64url.encode(crypto.randomBytes(32));
  const handle = 'primary';
  // 2. Generate capability agent for the zCap key
  const capabilityAgent = await CapabilityAgent.fromSecret({handle, secret});
  // 3. Create keystore in order to create the zCap key for the profile agent
  // TODO: Will want to store the capability agent up here first, otherwise we
  //       have no clean way of cleaning up the other stuff that gets created
  //       on other systems should we experience a failure.
  const keystore = await kms.createKeystore(
    {capabilityAgent, referenceId: 'primary'});
  // 4. Create the zCap key for the profile agent
  const keystoreAgent = kms.getKeystoreAgent({capabilityAgent, keystore});
  const key = await keystoreAgent.generateKey(
    {type: 'Ed25519VerificationKey2018', kmsModule: KMS_MODULE});
  // 5. Use the zCap key to create the DID for the profile agent
  await utils.setKeyId({key});
  // 6. Generate capability agent for ProfileAgent
  const paZcapAgent = new CapabilityAgent({handle: 'primary', signer: key});
  // 7. Create keystore to store keys controlled by the profile agent
  const paKeystore = await kms.createKeystore(
    {capabilityAgent: paZcapAgent, referenceId: 'primary'});
  const paKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: paZcapAgent, keystore: paKeystore});

  const did = key.id.split('#')[0];
  const profileAgent = {
    id: did,
    sequence: 0,
    account,
    controller: {
      id: capabilityAgent.id,
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
  return {
    ...record,
    profileAgent: {
      ...record.profileAgent,
      profile: undefined,
      capabilityAgent: paZcapAgent,
      keystoreAgent: paKeystoreAgent
    }
  };
};

/**
 * Get a Profile Agent
 *
 * @param {Object} id the id of the ProfileAgent.
 *
 * @return {Promise<ProfileAgent>} resolves to a ProfileAgent.
 */
exports.get = async ({id}) => {
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
  const {capabilityAgent, keystoreAgent} = await _getAgents(record);
  return {
    ...record,
    profileAgent: {
      ...record.profileAgent,
      capabilityAgent,
      keystoreAgent
    }
  };
};

/**
 * Get all Profile Agent(s)
 *
 * @param {Object} account the account associated with the ProfileAgent(s).
 *
 * @return {Promise<Arrray<ProfileAgent>>} resolves to a ProfileAgent(s).
 */
exports.getAll = async ({account}) => {
  assert.string(account, 'account');

  const query = {'profileAgent.account': account};
  const collection = utils.getCollection('profile-profileAgent');
  const records = await collection.find(query, {_id: 0}).toArray();
  if(records.length === 0) {
    return [];
  }
  // TODO: Find proper promise-fun library for concurrency
  const promises = records.map(async record => {
    const {capabilityAgent, keystoreAgent} = await _getAgents(record);
    return {
      ...record,
      profileAgent: {
        ...record.profileAgent,
        capabilityAgent,
        keystoreAgent
      }
    };
  });
  return Promise.all(promises);
};

/**
 * Get a Profile Agent
 *
 * @param {Object} profile the profile associated with the ProfileAgent.
 * @param {Object} account the account associated with the ProfileAgent.
 *
 * @return {Promise<ProfileAgent>} resolves to a ProfileAgent.
 */
exports.getByProfile = async ({account, profile}) => {
  assert.string(account, 'account');
  assert.string(profile, 'profile');

  const query = {
    'profileAgent.account': account,
    'profileAgent.profile': profile
  };
  const collection = utils.getCollection('profile-profileAgent');
  const record = await collection.findOne(query, {_id: 0});
  if(!record) {
    const details = {
      'profileAgent.account': account,
      'profileAgent.profile': profile,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError(
      'Profile agent not found.',
      'NotFoundError', details);
  }
  const {capabilityAgent, keystoreAgent} = await _getAgents(record);
  return {
    ...record,
    profileAgent: {
      ...record.profileAgent,
      capabilityAgent,
      keystoreAgent
    }
  };
};

/**
 * Get a Profile Agent
 *
 * @param {Object} profileAgent the updated profile agent.
 *
 * @return {Promise<ProfileAgent>} resolves to a ProfileAgent.
 */
exports.update = async ({profileAgent: prAgent}) => {
  const profileAgent = {...prAgent};
  delete profileAgent.capabilityAgent;
  delete profileAgent.keystoreAgent;
  assertProfileAgent(profileAgent);

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

exports.delegateCapabilities = async (
  {profileAgentId, capabilities, controller}) => {
  const {profileAgent} = await exports.get({id: profileAgentId});
  const invocationSigner = profileAgent.capabilityAgent.getSigner();
  const promises = capabilities.map(async parentZcap => {
    const {zcap, capabilityChain} = await _createZcap({parentZcap, controller});
    return zcaps.delegate({zcap, signer: invocationSigner, capabilityChain});
  });
  // TODO: Find proper promise-fun library for concurrency
  return Promise.all(promises);
};

async function _getAgents({profileAgent}) {
  const {
    controller: {seed, keystore: keystoreId},
    keystore: paKeystoreId,
    capabilityInvocationKey
  } = profileAgent;
  const zCapKeyCapabilityAgent =
    await CapabilityAgent.fromSecret({handle: 'primary', secret: seed});
  const keystore = await kms.getKeystore({id: keystoreId});
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: zCapKeyCapabilityAgent, keystore});
  const key = await keystoreAgent.getAsymmetricKey(
    {id: capabilityInvocationKey, type: 'Ed25519VerificationKey2018'});
  await utils.setKeyId({key});
  const paZcapAgent = new CapabilityAgent({handle: 'primary', signer: key});
  // 7. Create keystore to store keys controlled by the profile agent
  const paKeystore = await kms.getKeystore({id: paKeystoreId});
  const paKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: paZcapAgent, keystore: paKeystore});
  return {capabilityAgent: paZcapAgent, keystoreAgent: paKeystoreAgent};
}

async function _createZcap({parentZcap, controller}) {
  const zcap = {...parentZcap};
  delete zcap.invoker;
  delete zcap.delegator;
  delete zcap.proof;

  zcap.id = await zcaps.id();
  zcap.parentCapability = parentZcap.id;
  zcap.controller = controller;
  const capabilityChain = [
    ...parentZcap.proof.capabilityChain,
    parentZcap
  ];
  return {zcap, capabilityChain};
}

function assertProfileAgent(profileAgent) {
  assert.object(profileAgent, 'profileAgent');
  assert.string(profileAgent.id, 'profileAgent.id');
  assert.string(profileAgent.keystore, 'profileAgent.keystore');
  assert.string(profileAgent.capabilityInvocationKey,
    'profileAgent.capabilityInvocationKey');
  assert.object(profileAgent.controller, 'profileAgent.controller');

  const {sequence} = profileAgent;
  assert.number(sequence, 'profileAgent.sequence');
  if(!(sequence >= 0 && Number.isInteger(sequence))) {
    throw new TypeError(
      '"profileAgent.sequence" must be a non-negative integer.');
  }
}
