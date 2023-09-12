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
import {CapabilityAgent, KmsClient} from '@digitalbazaar/webkms-client';
import assert from 'assert-plus';
import {EdvClient} from '@digitalbazaar/edv-client';
import {httpsAgent} from '@bedrock/https-agent';
import {keyResolver} from './keyResolver.js';

const {
  assertKeystoreOptions,
  createCapabilityAgent,
  getCollection,
  getEdvConfig,
  getEdvDocument,
  getProfileSigner,
  getPublicAliasTemplate
} = utils;
const {config, util: {BedrockError}} = bedrock;

const {
  defaultZcapTtl: DEFAULT_PROFILE_AGENT_ZCAP_TTL,
} = config.profile.profileAgent;

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
    fields: {'profileAgent.id': 1, 'profileAgent.sequence': 1},
    options: {unique: false, background: false}
  }, {
    collection: 'profile-profileAgent',
    fields: {'profileAgent.account': 1, 'profileAgent.id': 1},
    options: {
      partialFilterExpression: {'profileAgent.account': {$exists: true}},
      unique: false,
      background: false
    }
  }, {
    collection: 'profile-profileAgent',
    fields: {'secrets.token': 1},
    options: {
      partialFilterExpression: {'secrets.token': {$exists: true}},
      unique: false,
      background: false
    }
  }]);
});

/**
 * Creates a profile agent record and inserts it into the database if
 * specified.
 *
 * The use case for not storing a profile agent record immediately is for
 * creating a new profile. In this case, the profile agent will be the root
 * profile agent and a number of steps in a provisioning process must complete
 * before storing the root profile agent to ensure the process is both
 * predictable and continuable.
 *
 * @param {object} options - The options to use.
 * @param {KeystoreOptions} options.keystoreOptions - The keystore options to
 *   use.
 * @param {boolean} options.store - True to store the record, false to just
 *   return it for later modification and storage.
 * @param {string} [options.profileId] - The ID of a profile; required if
 *   `store` is `true`.
 * @param {string} [options.accountId] - The ID of an account.
 * @param {string} [options.token] - An application token.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent record.
 */
export async function create({
  keystoreOptions, accountId, profileId, token, store
} = {}) {
  assert.bool(store, 'store');

  if(store && !profileId) {
    throw new Error('If "store" is "true" then "profileId" is required.');
  }

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
 * @param {boolean} [options._reconcile=true] - Reconcile profile agent
 *   record as needed; for internal use only.
 *
 * @returns {Promise<object>} Resolves to a ProfileAgent record.
 */
export async function get({
  id, includeSecrets = false, _reconcile = true
} = {}) {
  assert.string(id, 'id');

  const query = {'profileAgent.id': id};
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = getCollection('profile-profileAgent');
  let record = await collection.findOne(query, {projection});
  if(record && _reconcile) {
    ([record] = await _reconcileProfileAgentRecords({records: [record]}));
  }
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
  const records = await _getProfileAgentRecords({
    accountId, includeSecrets
  });
  return _reconcileProfileAgentRecords({records});
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
  let record = await collection.findOne(query, {projection});
  if(record) {
    ([record] = await _reconcileProfileAgentRecords({records: [record]}));
  }
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

  const query = {'secrets.token': token};
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    delete projection.secrets;
  }
  const collection = getCollection('profile-profileAgent');
  // no need to reconcile profile agent records that have tokens; these are
  // not used to create profiles
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
    return {meters: null, profileAgentRecord};
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

async function _reconcileProfileAgentRecords({records}) {
  // filter and remove any profile agents that were created with bad state
  const reconciled = await Promise.all(records.map(async record => {
    const {profileAgent} = record;

    // if a profile agent has no `profile`, it is in an invalid state
    // and must be removed
    if(!profileAgent.profile) {
      await remove({id: profileAgent.id});
      return;
    }

    // if profile agent has `profileCapabilityInvocationKey` zcap it is
    // a root profile agent, however, if it has no `userDocument` zcap, it is
    // for a profile that is in a partial state and it must be removed
    const isRoot = profileAgent.zcaps &&
      profileAgent.zcaps.profileCapabilityInvocationKey;
    if(isRoot && !profileAgent.zcaps.userDocument) {
      // remove profile agent; meters are not removed because there may be
      // another root profile agent that is not invalid
      await remove({id: profileAgent.id});
      return;
    }

    // complete profile provisioning as needed
    const {profileAgentRecord} = await completeProfileProvisioning(
      {profileAgentRecord: record});
    return profileAgentRecord;
  }));
  return reconciled.filter(r => r);
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

async function _getProfileAgentRecords({accountId, includeSecrets}) {
  const query = {'profileAgent.account': accountId};
  const projection = {_id: 0};
  const collection = getCollection('profile-profileAgent');
  let records = await collection.find(query, {projection}).toArray();
  const zcapRefreshed = await _refreshProfileAgentZcaps({
    profileAgentRecords: records
  });
  if(zcapRefreshed) {
    records = await collection.find(query, {projection}).toArray();
  }
  if(!includeSecrets) {
    records = records.map(record => {
      record = JSON.parse(JSON.stringify(record));
      delete record.secrets;
      return record;
    });
  }
  return records;
}

async function _refreshProfileAgentZcaps({profileAgentRecords}) {
  let zcapRefreshed = false;
  const records = JSON.parse(JSON.stringify(profileAgentRecords));
  for(const record of records) {
    if(!record.profileAgent.zcaps) {
      continue;
    }
    const {zcaps} = record.profileAgent;
    for(const zcapName in zcaps) {
      if(zcapName !== 'profileCapabilityInvocationKey') {
        const zcap = zcaps[zcapName];
        const {expires} = zcap;
        // check if the zcap is close to expiry
        const expTime = Date.parse(expires);
        const now = Date.now();
        const {zcapRefreshThreshold} = config.profile.profileAgent;
        if(expTime - now <= zcapRefreshThreshold) {
          if(zcapName === 'userDocument') {
            const kmsClient = new KmsClient({httpsAgent});
            const profileSigner = await getProfileSigner({
              kmsClient, profileAgentRecord: record
            });
            const docUrl = new URL(zcap.invocationTarget);
            const edvId =
              `${docUrl.protocol}//${docUrl.hostname}:${docUrl.port}` +
              `${docUrl.pathname.split('/').slice(0, 3).join('/')}`;
            const edvClient = new EdvClient({id: edvId, httpsAgent});
            const edvConfig = await getEdvConfig({edvClient, profileSigner});
            const docId = zcap.invocationTarget.split('/').pop();
            // get profile agent user doc
            const profileAgentUserDoc = await getEdvDocument({
              docId, edvConfig, edvClient, kmsClient, profileSigner
            });
            const updatedProfileAgentUserDoc =
              JSON.parse(JSON.stringify(profileAgentUserDoc));
            const {zcaps: profileAgentUserDocZcaps} =
              updatedProfileAgentUserDoc.content;
            for(const profileAgentUserDocZcapName in profileAgentUserDocZcaps) {
              if(
                profileAgentUserDocZcapName !== 'profileCapabilityInvocationKey'
              ) {
                const profileAgentUserDocZcap =
                  profileAgentUserDocZcaps[profileAgentUserDocZcapName];
                const {
                  expires: profileAgentUserDocZcapExpires
                } = profileAgentUserDocZcap;
                // check if the zcap is close to expiry
                const profileAgentUserDocZcapExpTime =
                  Date.parse(profileAgentUserDocZcapExpires);
                if(
                  profileAgentUserDocZcapExpTime - now <= zcapRefreshThreshold
                ) {
                  // refresh the zcap's expires property
                  profileAgentUserDocZcap.expires =
                    new Date(now + DEFAULT_PROFILE_AGENT_ZCAP_TTL);
                  zcapRefreshed = true;
                }
              }
            }
            if(zcapRefreshed) {
              try {
                await edvClient.update({
                  doc: updatedProfileAgentUserDoc,
                  invocationSigner: profileSigner,
                  keyResolver
                });
              } catch(error) {
                console.log(error);
              }
            }
          }
          zcap.expires = new Date(now + DEFAULT_PROFILE_AGENT_ZCAP_TTL);
          zcapRefreshed = true;
        }
      }
    }
    if(zcapRefreshed) {
      // update the profile agent record
      record.profileAgent.sequence += 1;
      await update({profileAgent: record.profileAgent});
    }
  }
  return zcapRefreshed;
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
