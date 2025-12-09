/*!
 * Copyright (c) 2020-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import * as kms from './kms.js';
import * as meterClient from './meterClient.js';
import * as profileMeters from './profileMeters.js';
import * as utils from './utils.js';
import * as zcaps from './zcaps.js';
import {
  AsymmetricKey, CapabilityAgent, Hmac, KeyAgreementKey, KmsClient
} from '@digitalbazaar/webkms-client';
import {
  decryptRecordSecrets, encryptRecordSecrets, isSecretsEncryptionEnabled
} from './secretsEncryption.js';
import {EdvClient, EdvDocument} from '@digitalbazaar/edv-client';
import assert from 'assert-plus';
import {httpsAgent} from '@bedrock/https-agent';
import {keyResolver} from './keyResolver.js';

const {
  assertKeystoreOptions,
  createCapabilityAgent,
  getCollection,
  getPublicAliasTemplate,
  removeSecretsFromRecords
} = utils;
const {config, util: {BedrockError}} = bedrock;

const COLLECTION_NAME = 'profile-profileAgent';

// hard limits on zcap config options:

// external systems will not accept more than 365 days generally
const MAX_ZCAP_TTL_DEFAULT = 365 * 24 * 60 * 60 * 1000;
// KMS system will not accept more than 1000 years
const MAX_ZCAP_TTL_PROFILE_ZCAP_KEY = 1000 * 365 * 24 * 60 * 60 * 1000;
// "long-lived" zcaps should not be configured to auto-refresh less frequently
// than 15 minutes as this may result in errors in using zcaps that expire
// shortly after they are retrieved
const MIN_AUTO_REFRESH_THRESHOLD = 15 * 60 * 1000;
// this must be less than the minimum auto refresh threshold otherwise the
// user EDV doc zcaps can get out of sync with the mongodb record zcaps; we
// also account for clock skew of ~5 minutes between systems)
const MAX_ZCAP_SYNC_DELTA = MIN_AUTO_REFRESH_THRESHOLD - 5 * 60 * 1000;

bedrock.events.on('bedrock.start', async () => {
  // validate zcap config
  const {zcap: zcapConfig} = config.profile.profileAgent;

  // enforce hard limits on configuration
  if(zcapConfig.autoRefreshThreshold < MIN_AUTO_REFRESH_THRESHOLD) {
    throw new Error(
      'Configuration option "zcap.autoRefreshThreshold" must be greater ' +
      `than or equal to ${MIN_AUTO_REFRESH_THRESHOLD} milliseconds.`);
  }
  if(zcapConfig.syncTimeDelta < 0 ||
    zcapConfig.syncTimeDelta > MAX_ZCAP_SYNC_DELTA) {
    throw new Error(
      'Configuration option "zcap.syncTimeDelta" must be between ' +
      `0 and ${MAX_ZCAP_SYNC_DELTA} milliseconds.`);
  }
  if(zcapConfig.ttl.default < 0 ||
    zcapConfig.ttl.default > MAX_ZCAP_TTL_DEFAULT) {
    throw new Error(
      'Configuration option "zcap.ttl.default" must be between ' +
      `0 and ${MAX_ZCAP_TTL_DEFAULT} milliseconds.`);
  }
  if(zcapConfig.ttl.profileCapabilityInvocationKey < 0 ||
    zcapConfig.ttl.profileCapabilityInvocationKey >
      MAX_ZCAP_TTL_PROFILE_ZCAP_KEY) {
    throw new Error(
      'Configuration option "zcap.ttl.profileCapabilityInvocationKey" must ' +
      `be between 0 and ${MAX_ZCAP_TTL_PROFILE_ZCAP_KEY} milliseconds.`);
  }
});

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections([COLLECTION_NAME]);

  await database.createIndexes([{
    collection: COLLECTION_NAME,
    fields: {'profileAgent.id': 1},
    options: {unique: true}
  }, {
    collection: COLLECTION_NAME,
    fields: {'profileAgent.profile': 1},
    options: {unique: false}
  }, {
    collection: COLLECTION_NAME,
    fields: {'profileAgent.id': 1, 'profileAgent.sequence': 1},
    options: {unique: false}
  }, {
    collection: COLLECTION_NAME,
    fields: {'profileAgent.account': 1, 'profileAgent.id': 1},
    options: {
      partialFilterExpression: {'profileAgent.account': {$exists: true}},
      unique: false
    }
  }, {
    collection: COLLECTION_NAME,
    fields: {'secrets.token': 1},
    options: {
      partialFilterExpression: {'secrets.token': {$exists: true}},
      unique: false
    }
  }, {
    collection: COLLECTION_NAME,
    fields: {
      'profileAgent.profile': 1,
      'profileAgent.zcaps.profileCapabilityInvocationKey.id': 1
    },
    options: {
      partialFilterExpression: {
        'profileAgent.zcaps.profileCapabilityInvocationKey.id': {$exists: true}
      },
      unique: false
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
    secrets
  };

  if(!store) {
    return record;
  }

  return insert({record});
}

/**
 * Gets a count of all profile agents for the given account.
 *
 * @param {object} options - The options to use.
 * @param {string} options.accountId - The ID of an account.
 *
 * @returns {Promise<object>} Resolves with an object `{count}` with the
 *   number of profile agents associated with the given `accountId`.
 */
export async function count({accountId} = {}) {
  assert.string(accountId, 'accountId');

  // count all profile agent records with the given `accountId`
  const query = {'profileAgent.account': accountId};
  const collection = getCollection(COLLECTION_NAME);
  const count = await collection.countDocuments(query);
  return {count};
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
  // exclude secrets info by default
  const projection = {_id: 0, secrets: 0};
  // do not exclude secrets info if requested or if reconciling
  if(includeSecrets || _reconcile) {
    delete projection.secrets;
  }
  const collection = getCollection(COLLECTION_NAME);
  let record = await collection.findOne(query, {projection});
  if(record) {
    if(_reconcile) {
      // ensure record has been reconciled
      [record] = await _reconcileProfileAgentRecords({records: [record]});
      if(record) {
        // apply auto-refresh to zcaps
        [record] = await _refreshProfileAgentZcaps({records: [record]});
        if(!includeSecrets) {
          [record] = removeSecretsFromRecords({records: [record]});
        }
      }
    } else {
      // ensure any secrets are decrypted
      record = await decryptRecordSecrets({record});
    }
  }
  if(!record) {
    const details = {
      profileAgent: id,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError('Profile agent not found.', {
      name: 'NotFoundError',
      details
    });
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
  // get raw records
  let records = await _getProfileAgentRecords({accountId});
  // ensure records have been reconciled
  records = await _reconcileProfileAgentRecords({records});
  // apply auto-refresh to zcaps
  records = await _refreshProfileAgentZcaps({records});
  if(!includeSecrets) {
    records = removeSecretsFromRecords({records});
  }
  return records;
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
  const projection = {_id: 0};
  const collection = getCollection(COLLECTION_NAME);
  let record = await collection.findOne(query, {projection});
  if(record) {
    // ensure record has been reconciled
    [record] = await _reconcileProfileAgentRecords({records: [record]});
    if(record) {
      // apply auto-refresh to zcaps
      [record] = await _refreshProfileAgentZcaps({records: [record]});
      if(!includeSecrets) {
        [record] = removeSecretsFromRecords({records: [record]});
      }
    }
  }
  if(!record) {
    const details = {
      'profileAgent.account': accountId,
      'profileAgent.profile': profileId,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError('Profile agent not found.', {
      name: 'NotFoundError',
      details
    });
  }
  return record;
}

/**
 * Gets root Profile Agents by Profile.
 *
 * @param {object} options - The options to use.
 * @param {string} options.profileId - The ID of the profile associated
 *   with the ProfileAgent.
 * @param {object} [options.options={limit: 1}] - The query options to use.
 * @param {boolean} [options.includeSecrets=false] - Include secrets in the
 *   result.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise<Array | ExplainObject>} Resolves to ProfileAgent records
 *   or an `ExplainObject` if `explain=true`.
 */
export async function getRootAgents({
  profileId, options = {limit: 1}, includeSecrets = false, explain = false
} = {}) {
  assert.string(profileId, 'profileId');
  assert.object(options, 'options');
  assert.optionalNumber(options?.skip, 'options.skip');
  assert.optionalNumber(options?.limit, 'options.limit');
  assert.bool(includeSecrets, 'includeSecrets');
  assert.bool(explain, 'explain');

  const query = {
    'profileAgent.profile': profileId,
    'profileAgent.zcaps.profileCapabilityInvocationKey.id': {$exists: true}
  };
  // exclude secrets info by default
  const projection = {_id: 0, secrets: 0};
  if(includeSecrets) {
    // do not exclude secrets info per request
    delete projection.secrets;
  }
  const collection = getCollection(COLLECTION_NAME);
  const cursor = await collection.find(query, options);

  if(explain) {
    return cursor.explain('executionStats');
  }

  let records = await cursor.toArray();
  if(records.length > 0) {
    // ensure records have been reconciled
    records = await _reconcileProfileAgentRecords({records});
    // apply auto-refresh to zcaps
    records = await _refreshProfileAgentZcaps({records});
    if(!includeSecrets) {
      records = removeSecretsFromRecords({records});
    }
    // handle rare case where one record was requested and the returned one
    // was invalid
    if(records.length === 0 && options.limit === 1) {
      // fetch up to 10 profile agents and return first, if any
      options = {...options, limit: 10};
      records = await getRootAgents({profileId, options, includeSecrets});
      records = records.slice(0, 1);
    }
  }
  return records;
}

/**
 * Get a Profile Agent by token.
 *
 * Note: Profile agents returned by token are presently not reconciled; this
 * might be changed in a future revision without a major breaking change as
 * it would correct invalid state.
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
  // exclude secrets info by default
  const projection = {_id: 0, secrets: 0, encryptedSecrets: 0};
  if(includeSecrets) {
    // do not exclude secrets info per request
    delete projection.secrets;
    delete projection.encryptedSecrets;
  }
  const collection = getCollection(COLLECTION_NAME);
  // no need to reconcile profile agent records that have tokens; these are
  // not used to create profiles
  const record = await collection.findOne(query, {projection});
  if(!record) {
    throw new BedrockError('Profile agent not found.', {
      name: 'NotFoundError',
      details: {
        token,
        httpStatusCode: 404,
        public: true
      }
    });
  }
  return decryptRecordSecrets({record});
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
    const collection = getCollection(COLLECTION_NAME);
    // encrypt secrets according to configuration
    const updatedRecord = await encryptRecordSecrets({record});
    await collection.insertOne(updatedRecord);
  } catch(cause) {
    if(!database.isDuplicateError(cause)) {
      throw cause;
    }
    throw new BedrockError('Duplicate profile agent.', {
      name: 'DuplicateError',
      cause,
      details: {
        public: true,
        httpStatusCode: 409
      }
    });
  }
  return record;
}

/**
 * Update a Profile Agent.
 *
 * @param {object} options - The options to use.
 * @param {object} options.profileAgent - The updated profile agent.
 * @param {boolean} [options.includeSecrets=false] - Include secrets
 *   in the result.
 * @param {object} [options.secrets=undefined] - The `secrets` to update.
 *
 * @returns {Promise<object>} Resolves to the updated record on success,
 *   including the record secrets if requested.
 */
export async function update({
  profileAgent, includeSecrets = false, secrets
} = {}) {
  _assertProfileAgent(profileAgent);

  // build update
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
  const update = {$set};
  if(secrets) {
    // handle `secrets` update
    const record = {profileAgent, secrets};
    const {encryptedSecrets} = await encryptRecordSecrets({record});
    if(encryptedSecrets) {
      $set.encryptedSecrets = encryptedSecrets;
      update.$unset = {secrets: true};
    } else {
      $set.secrets = secrets;
      update.$unset = {encryptedSecrets: true};
    }
  }

  // exclude secrets info by default from returned record
  const projection = {_id: 0, secrets: 0, encryptedSecrets: 0};
  if(includeSecrets) {
    // do not exclude secrets info per request
    delete projection.secrets;
    delete projection.encryptedSecrets;
  }

  // perform update and return updated record
  const collection = getCollection(COLLECTION_NAME);
  const result = await collection.findOneAndUpdate(query, update, {
    projection,
    promoteBuffers: true,
    returnDocument: 'after',
    includeResultMetadata: true
  });
  if(result.lastErrorObject?.updatedExisting === false) {
    const details = {
      profileAgent: id,
      httpStatusCode: 409,
      public: true
    };
    throw new BedrockError(
      'Could not update profile agent; ' +
      'profile agent either not found or unexpected sequence number.', {
        name: 'InvalidStateError',
        details
      });
  }

  return decryptRecordSecrets({record: result.value});
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
  const collection = getCollection(COLLECTION_NAME);
  const result = await collection.deleteOne(query);
  if(result.deletedCount === 0) {
    const details = {
      id,
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError('Profile agent not found.', {
      name: 'NotFoundError',
      details
    });
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

/**
 * Get an API for signing capability invocations as a profile, that is driven
 * by the profile agent associated with the given record.
 *
 * @param {object} options - The options to use.
 * @param {object} options.profileAgentRecord - The profile agent record to use.
 *
 * @returns {Promise<object>} Resolves to an invocation signer API.
 */
export async function getProfileSigner({profileAgentRecord} = {}) {
  const {
    profileAgent: {zcaps: {profileCapabilityInvocationKey: capability}}
  } = profileAgentRecord;
  if(!capability) {
    throw new TypeError(
      '"profileAgentRecord" must include "profileCapabilityInvocationKey" ' +
      'capability to get a profile capability invocation signer.');
  }
  const profileSigner = await AsymmetricKey.fromCapability({
    capability,
    invocationSigner: await getSigner({profileAgentRecord}),
    kmsClient: new KmsClient({httpsAgent})
  });
  return profileSigner;
}

/**
 * Get an API for signing capability invocations as a profile agent, the
 * profile agent associated with the given record. This method returns
 * the same signer as using `getAgents()` to get the profile agent's capability
 * agent and then calling `getSigner()` on it.
 *
 * @param {object} options - The options to use.
 * @param {object} options.profileAgentRecord - The profile agent record to use.
 *
 * @returns {Promise<object>} Resolves to an invocation signer API.
 */
export async function getSigner({profileAgentRecord} = {}) {
  const {capabilityAgent} = await getAgents(profileAgentRecord);
  return capabilityAgent.getSigner();
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
      profileAgentRecord = await update(
        {profileAgent: newProfileAgent, includeSecrets: true});
      break;
    } catch(e) {
      if(e.name !== 'InvalidStateError') {
        throw e;
      }
      // concurrent process updated record, get updated record and try again
      profileAgentRecord = await get(
        {id: profileAgent.id, includeSecrets: true});
    }
  }

  return {meters, profileAgentRecord};
}

/**
 * Refreshes a capability (zcap). The zcap must have a capability chain length
 * of 1 and have been previously delegated by a profile that matches the
 * given `profileSigner`.
 *
 * @param {object} options - The options to use.
 * @param {object} options.capability - The capability to refresh.
 * @param {object} options.profileSigner - The profile signer to use.
 * @param {number|Date} options.now - The current datetime in milliseconds
 *   since the epoch, or as a Date.
 * @param {number|string|Date} [options.expires] - The new zcap expiration
 *   datetime as an xmlschema datetimeStamp or in milliseconds since the epoch,
 *   or as a Date; if not given, the `profile.profileAgent.zcap.ttl` value
 *   from the bedrock config will be used.
 *
 * @returns {Promise<object>} Resolves to a fresh delegated zcap.
 */
export async function refreshCapability({
  capability, profileSigner, now, expires
} = {}) {
  if(expires === undefined) {
    const {zcap: {ttl: {default: ttl}}} = config.profile.profileAgent;
    expires = new Date(now + ttl);
  } else if(typeof expires === 'number') {
    expires = new Date(expires);
  }
  return zcaps.refresh({capability, expires, signer: profileSigner});
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
    let {profileAgentRecord} = await completeProfileProvisioning(
      {profileAgentRecord: record});

    // ensure `secrets` are stored in encrypted form per configuration
    profileAgentRecord = await _completeSecretsEncryption({
      record: profileAgentRecord
    });

    // decrypt any encrypted secrets
    return decryptRecordSecrets({record: profileAgentRecord});
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

async function _completeSecretsEncryption({record}) {
  if(!isSecretsEncryptionEnabled() || !record.secrets) {
    return record;
  }

  while(!record.encryptedSecrets) {
    const {profileAgent} = record;
    const newProfileAgent = {
      ...profileAgent,
      sequence: profileAgent.sequence + 1,
    };
    try {
      record = await update(
        {profileAgent: newProfileAgent, includeSecrets: true});
      break;
    } catch(e) {
      if(e.name !== 'InvalidStateError') {
        throw e;
      }
      // concurrent process updated record, get updated record and try again
      record = await get({
        id: profileAgent.id,
        includeSecrets: true,
        _reconcile: false
      });
    }
  }

  return record;
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

async function _getProfileAgentRecords({accountId}) {
  const query = {'profileAgent.account': accountId};
  const projection = {_id: 0};
  const collection = getCollection(COLLECTION_NAME);
  return collection.find(query, {projection}).toArray();
}

async function _refreshProfileAgentZcaps({records}) {
  return Promise.all(records.map(record => _refreshZcaps({record})));
}

async function _refreshZcaps({record}) {
  /* Note: To ensure that this process is repeatable / continuable / retryable
  and works in the face of concurrent processes attempting to perform this same
  process or perform other updates to the profile agent's EDV user document,
  the refresh process is defined as:

  1. Start a loop to perform auto-refresh.
  2. Establish a baseline `now` working time to use consistently across all
    comparisons.
  3. Generate new zcaps to be stored in the profile agent record by refreshing
    the old ones.
  4. Use the new zcaps to access the EDV user document.
  5. If the user document has other zcaps delegated by the profile, then
    auto-refresh them as well, but store the new ones all at once using a
    single update to the EDV document. Note that zcaps should be refreshed if
    they were delegated <= `syncTimeDelta` before `now`; this is used instead
    of the zcap auto-refresh time again to ensure that the zcaps are kept
    reasonably in-sync, but to allow for other processes to have updated the
    user EDV document within `syncTimeDelta` w/o needing another EDV update.
  6. Finally, update the profile agent record if its `sequence` hasn't changed
    since it was last read. If the update fails, read the record again and
    restart the process.

  Note: Any failure during the auto-refresh process will cause the profile
  agent record to fail to be retrieved, blocking the ability to retrieve the
  profile agent record until the error is addressed. This provides a
  consistent view of the record (with always-refreshed zcaps). Future versions
  of this module may relax this to allow for retrieval with expired zcaps. */

  const {zcap: {autoRefreshThreshold}} = config.profile.profileAgent;

  while(true) {
    const now = Date.now();

    /* Note: There are only two specific zcaps in any profile agent record
    that might need to be refreshed: `userDocument` and `user-edv-kak`. These
    can only be auto-refreshed if the `profileCapabilityInvocationKey` zcap is
    also present. Both of them should always be present and have the same
    `expires` so just check `userDocument`. */
    const {zcaps: existingZcaps} = record.profileAgent;
    if(!(existingZcaps?.profileCapabilityInvocationKey &&
      existingZcaps.userDocument && existingZcaps['user-edv-kak'])) {
      // nothing to refresh or cannot auto-refresh
      return record;
    }

    // time at which at zcap should be refreshed if it will expire by then
    const refreshTime = now + autoRefreshThreshold;
    if(Date.parse(existingZcaps.userDocument.expires) > refreshTime) {
      // no need to refresh zcaps
      return record;
    }

    const kmsClient = new KmsClient({httpsAgent});
    const profileSigner = await getProfileSigner({
      kmsClient, profileAgentRecord: record
    });

    // refresh profile agent zcaps and replace them in a new copy of the record
    const {zcaps} = await _generateProfileAgentZcaps(
      {profileSigner, now, zcaps: existingZcaps});
    const newRecord = structuredClone({...record, secrets: undefined});
    newRecord.secrets = record.secrets;
    newRecord.profileAgent.zcaps = {...newRecord.profileAgent.zcaps, ...zcaps};

    // refresh all auto-refreshable zcaps in the profile agent's user EDV doc
    await _refreshUserEdvDocZcaps(
      {profileAgentRecord: newRecord, profileSigner, now, zcaps});

    // update the profile agent record
    try {
      newRecord.profileAgent.sequence++;
      return await update(
        {profileAgent: newRecord.profileAgent, includeSecrets: true});
    } catch(e) {
      if(e.name !== 'InvalidStateError') {
        throw e;
      }
      // fetch new record and try again
      record = await get({id: record.profileAgent.id, includeSecrets: true});
    }
  }
}

async function _generateProfileAgentZcaps({profileSigner, now, zcaps}) {
  const refreshMap = new Map();
  for(const [zcapName, capability] of Object.entries(zcaps)) {
    if(zcapName === 'profileCapabilityInvocationKey') {
      // profile capability invocation key zcap cannot be refreshed
      continue;
    }
    refreshMap.set(
      zcapName, refreshCapability({capability, profileSigner, now}));
  }
  await Promise.all([...refreshMap.values()]);
  const result = {};
  for(const [zcapName, promise] of refreshMap) {
    result[zcapName] = await promise;
  }
  return {zcaps: result};
}

async function _getUserEdvDocument({profileAgentRecord, zcaps, kmsClient}) {
  const invocationSigner = await getSigner({profileAgentRecord});
  const {userDocument: capability} = zcaps;
  const edvClient = new EdvClient({capability, httpsAgent, keyResolver});
  // ensure core indexes are set
  edvClient.ensureIndex({attribute: 'content.id', unique: true});
  edvClient.ensureIndex({attribute: 'content.type'});
  edvClient.ensureIndex({attribute: 'content.name'});
  edvClient.ensureIndex({attribute: 'content.email'});
  const keyAgreementKey = await KeyAgreementKey.fromCapability(
    {capability: zcaps['user-edv-kak'], invocationSigner, kmsClient});
  const doc = new EdvDocument({
    capability,
    invocationSigner,
    keyAgreementKey,
    client: edvClient
  });
  return doc;
}

function _isProfileDelegated({verificationMethod, zcap}) {
  return (zcap.proof?.proofPurpose === 'capabilityDelegation' &&
    zcap.proof?.verificationMethod === verificationMethod);
}

async function _refreshUserEdvDocZcaps({
  profileAgentRecord, now, profileSigner, zcaps
}) {
  /* Note: Read the profile agent's user EDV doc and get any zcaps. Each
  zcap is checked to see if it was directly delegated by the profile. This
  check is done by seeing if the zcap has a delegation proof (and this is
  the only proof) that includes the same verification method as the key used to
  delegate the profile agent's profile capability invocation zcap. If the zcap
  does not match this criteria, then it is not auto-refreshed. */

  // get the verification method associated with the capability delegation
  // proof on the `capabilityInvocationKey` zcap; this helper function presumes
  // the caller will ensure the presence of this zcap and the proof in this
  // position
  const {
    profileCapabilityInvocationKey: capabilityInvocationKeyZcap
  } = profileAgentRecord.profileAgent.zcaps;
  const {proof: {verificationMethod}} = capabilityInvocationKeyZcap;

  // calculate earliest acceptable zcap delegation time
  const {zcap: {syncTimeDelta}} = config.profile.profileAgent;
  const earliestDelegation = now - syncTimeDelta;

  const kmsClient = new KmsClient({httpsAgent});
  while(true) {
    // read existing profile agent user EDV document
    const edvDoc = await _getUserEdvDocument(
      {profileAgentRecord, zcaps, kmsClient});
    const doc = await edvDoc.read();

    // check existing zcaps to auto-refresh as needed; start each refresh
    const existingZcaps = doc.content?.zcaps || {};
    const refreshMap = new Map();
    for(const [zcapName, zcap] of Object.entries(existingZcaps)) {
      if(zcapName === 'profileCapabilityInvocationKey') {
        // profile capability invocation key zcap cannot be refreshed
        continue;
      }

      // skip zcaps that are not delegated by the profile, they are not
      // auto-refreshable
      if(!_isProfileDelegated({verificationMethod, zcap})) {
        continue;
      }

      // get zcap delegation date
      const created = Date.parse(zcap.proof.created);
      if(isNaN(created)) {
        // zcap delegation date cannot be parsed, skip it
        continue;
      }

      // if zcap was delegated too early, it must be refreshed
      if(created < earliestDelegation) {
        refreshMap.set(
          zcapName, refreshCapability({capability: zcap, profileSigner, now}));
      }
    }

    if(refreshMap.size === 0) {
      // nothing to auto-refresh
      return;
    }

    // await all refresh operations in parallel
    await Promise.all([...refreshMap.values()]);

    // update user doc with resolved promise values (new zcaps)
    for(const [zcapName, promise] of refreshMap) {
      doc.content.zcaps[zcapName] = await promise;
    }

    // set zcap with `write` permission and use HMAC zcap to enable updating
    // EDV document
    const {
      'user-edv-documents': userEdvDocuments,
      'user-edv-hmac': hmacZcap
    } = doc.content.zcaps;
    if(!(userEdvDocuments && hmacZcap)) {
      throw new BedrockError(
        'Profile agent capabilities cannot be refreshed; missing the ' +
        'capabilities required to write to the user EDV document.', {
          name: 'OperationError',
          details: {
            profileAgent: profileAgentRecord.profileAgent.id,
            httpStatusCode: 500,
            public: true
          }
        });
    }
    edvDoc.capability = userEdvDocuments;
    edvDoc.hmac = await Hmac.fromCapability({
      capability: hmacZcap,
      invocationSigner: edvDoc.invocationSigner,
      kmsClient
    });

    try {
      await edvDoc.write({doc});
      return;
    } catch(e) {
      if(e.name !== 'InvalidStateError') {
        // unrecoverable error
        throw e;
      }
      // loop to retry
    }
  }
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */

/**
 * @typedef {object} KeystoreOptions
 * @property {object} meterId - The full URL ID of the meter; to be given to
 *   the KMS service when creating a keystore.
 * @property {object} meterCapabilityInvocationSigner - The invocation signer
 *   to use to create a keystore associated with the given meter capability.
 * @property {string} [options.kmsModule] - The KMS module to use to create
 *   a keystore.
 */
