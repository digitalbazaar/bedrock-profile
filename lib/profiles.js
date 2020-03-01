/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const bedrock = require('bedrock');
const brHttpsAgent = require('bedrock-https-agent');
const {AsymmetricKey, KmsClient} = require('webkms-client');
const {EdvClient} = require('edv-client');
const capabilitySets = require('./capabilitySets');
const edvs = require('./edvs');
const keyResolver = require('./keyResolver');
const kms = require('./kms');
const profileAgents = require('./profileAgents');
const utils = require('./utils');
const {delegateCapability} = require('./zcaps');

// load config defaults
require('./config');
const KMS_MODULE = 'ssm-v1';

/**
 * Creates a Profile for a given account
 *
 *
 * @param {String} accountId the id of the account to associate with the
 *                           Profile.
 * @param {Object} settings the settings for a Profile.
 *
 * @return {Promise<Profile>} resolves to a profile's settings.
 */
exports.create = async ({actor, accountId, settings} = {}) => {
  const {profileAgent} = await profileAgents.create({accountId});
  // 1. Use the ProfileAgent to generate a new AsymmetricKey in its  keystore.
  //    This key will be the Profile's ZcapKey.
  const {capabilityAgent: paZcapAgent} = profileAgent;
  const profileKeystore = await kms.createKeystore(
    {capabilityAgent: paZcapAgent, referenceId: 'primary'});
  const profileKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: paZcapAgent, keystore: profileKeystore});
  const key = await profileKeystoreAgent.generateKey(
    {type: 'Ed25519VerificationKey2018', kmsModule: KMS_MODULE});
  // 2. Use the ProfileZcapKey to generate the Profile DID
  // FIXME: Should be setting the profile DID to a V1 DID
  await utils.setKeyId({key, method: 'key'});
  // 3. Delegate a capability from the Profile DID to the ProfileAgent to
  //    allow the ProfileAgent to sign with the ProfileZcapKey for the purpose
  //    of performing capability invocations.
  const delegateZcapKeyRequest = {
    referenceId: `${key.id}-key-capabilityInvocation`,
    // string should match KMS ops
    allowedAction: 'sign',
    controller: paZcapAgent.id,
    invocationTarget: {
      id: (await key.getKeyDescription()).id,
      type: 'Ed25519VerificationKey2018',
      proofPurpose: 'capabilityInvocation',
      verificationMethod: key.id
    }
  };
  const zcap = await delegateCapability(
    {signer: key, request: delegateZcapKeyRequest});
  // 4. Save the delegated capability in the profile agent's capability set
  const capabilitySet = {
    sequence: 0,
    profileAgent: profileAgent.id,
    zcaps: [zcap]
  };
  await capabilitySets.create({capabilitySet});
  // 5. Update the `controller` for the Profile Keystore, change from
  // `profileAgent.id` to Profile DID.
  // FIXME: Need to properly find the DID associated with the key
  const profileDid = key.id.split('#')[0];
  const updatedKeystore = await kms.updateKeystoreController(
    {id: profileKeystore.id, controller: profileDid});
  const {httpsAgent} = brHttpsAgent;
  const kmsClient = new KmsClient({keystore: updatedKeystore.id, httpsAgent});
  const invocationSigner = new AsymmetricKey({
    capability: zcap,
    invocationSigner: paZcapAgent.getSigner(),
    kmsClient
  });
  await profileAgents.update({
    profileAgent: {
      ...profileAgent,
      sequence: profileAgent.sequence + 1,
      profile: profileDid,
      profileZcapId: zcap.id
    }
  });
  // 6. Store a single 'user' object in the profile's 'users' EDV
  // TODO: Make sure these config variables works in production mode
  const usersReferenceId = edvs.getReferenceId('users');
  const profileUsersEdv = await edvs.create({
    actor,
    invocationSigner,
    kmsClient,
    profileId: profileDid,
    referenceId: usersReferenceId
  });
  const userDoc = {
    id: await EdvClient.generateId(),
    content: {
      id: bedrock.util.uuid(),
      type: 'User',
      name: settings.name,
      email: '',
      profileAgent: profileAgent.id,
      authorizedDate: (new Date()).toISOString()
    }
  };
  profileUsersEdv.ensureIndex({attribute: 'content.id'});
  profileUsersEdv.ensureIndex({attribute: 'content.name'});
  profileUsersEdv.ensureIndex({attribute: 'content.email'});
  profileUsersEdv.ensureIndex({attribute: 'content.profileAgent'});
  await profileUsersEdv.insert({
    doc: userDoc,
    invocationSigner,
    keyResolver
  });
  // 7. Store profile settings in the profile's settings EDV
  // TODO: Make sure these config variables works in production mode
  const settingsReferenceId = edvs.getReferenceId('settings');

  const profileSettingsEdv = await edvs.create({
    actor,
    invocationSigner,
    kmsClient,
    profileId: profileDid,
    referenceId: settingsReferenceId
  });
  const settingsDoc = {
    id: await EdvClient.generateId(),
    content: {
      ...settings,
      id: profileDid
    }
  };
  profileSettingsEdv.ensureIndex({attribute: 'content.id'});
  profileSettingsEdv.ensureIndex({attribute: 'content.type'});
  const res = await profileSettingsEdv.insert({
    doc: settingsDoc,
    invocationSigner,
    keyResolver
  });
  // 8. Give profileAgent zcaps to read/write from the 'users' EDV and any other
  //     profile EDVs (settings, etc.), for consistency with other profile
  //     agents that don't have a zcap to use the capabilityInvocation key of
  //     the profile
  const delegateUsersEdvRequest = {
    referenceId: `${usersReferenceId}-edv-configuration`,
    allowedAction: ['read', 'write'],
    controller: paZcapAgent.id,
    invocationTarget: {
      id: `${profileUsersEdv.id}/documents`,
      type: 'urn:edv:documents'
    }
  };
  const delegateUsersEdvHmacRequest = {
    referenceId: `${usersReferenceId}-hmac`,
    allowedAction: 'sign',
    controller: paZcapAgent.id,
    invocationTarget: {
      id: profileUsersEdv.hmac.id,
      type: profileUsersEdv.hmac.type,
      verificationMethod: profileUsersEdv.hmac.id
    }
  };
  const delegateUsersEdvKakRequest = {
    referenceId: `${usersReferenceId}-kak`,
    allowedAction: ['deriveSecret', 'sign'],
    controller: paZcapAgent.id,
    invocationTarget: {
      id: profileUsersEdv.keyAgreementKey.id,
      type: profileUsersEdv.keyAgreementKey.type,
      verificationMethod: profileUsersEdv.keyAgreementKey.id
    }
  };
  const delegateSettingsEdvRequest = {
    referenceId: `${settingsReferenceId}-edv-configuration`,
    allowedAction: ['read', 'write'],
    controller: paZcapAgent.id,
    invocationTarget: {
      id: `${profileSettingsEdv.id}/documents`,
      type: 'urn:edv:documents'
    }
  };
  const delegateSettingsEdvHmacRequest = {
    referenceId: `${settingsReferenceId}-hmac`,
    allowedAction: 'sign',
    controller: paZcapAgent.id,
    invocationTarget: {
      id: profileSettingsEdv.hmac.id,
      type: profileSettingsEdv.hmac.type,
      verificationMethod: profileSettingsEdv.hmac.id
    }
  };
  const delegateSettingsEdvKakRequest = {
    referenceId: `${settingsReferenceId}-kak`,
    allowedAction: ['deriveSecret', 'sign'],
    controller: paZcapAgent.id,
    invocationTarget: {
      id: profileSettingsEdv.keyAgreementKey.id,
      type: profileSettingsEdv.keyAgreementKey.type,
      verificationMethod: profileSettingsEdv.keyAgreementKey.id
    }
  };
  const edvZcaps = await Promise.all([
    delegateCapability({
      edvClient: profileUsersEdv,
      signer: invocationSigner,
      request: delegateUsersEdvRequest
    }),
    delegateCapability({
      signer: invocationSigner,
      request: delegateUsersEdvHmacRequest
    }),
    delegateCapability({
      signer: invocationSigner,
      request: delegateUsersEdvKakRequest
    }),
    delegateCapability({
      edvClient: profileSettingsEdv,
      signer: invocationSigner,
      request: delegateSettingsEdvRequest
    }),
    delegateCapability({
      signer: invocationSigner,
      request: delegateSettingsEdvHmacRequest
    }),
    delegateCapability({
      signer: invocationSigner,
      request: delegateSettingsEdvKakRequest
    })
  ]);
  const {capabilitySet: oldSet} = await capabilitySets.get(
    {profileAgentId: profileAgent.id});
  const newCapabilitySet = {
    ...oldSet,
    sequence: oldSet.sequence + 1,
    // TODO: Investigate using a map instead of a list
    // TODO: Ensure duplicate zcaps are not added to list
    zcaps: oldSet.zcaps.concat(edvZcaps)
  };
  await capabilitySets.update({capabilitySet: newCapabilitySet});
  return res.content;
};

/**
 * Returns a Profile for a given account
 *
 * @param {String} accountId the id of the account associated with the
 *                           ProfileAgent.
 * @param {String} profileId the id associated with the Profile.
 *
 * @return {Promise<Profile>} resolves to a profile's settings.
 */
exports.get = async ({actor, accountId, profileId} = {}) => {
  assert.string(accountId, 'accountId');
  assert.string(profileId, 'profileId');

  const {profileAgent} = await profileAgents.getByProfile(
    {accountId, profileId});
  const {id, keystore, capabilityAgent} = profileAgent;

  const profileKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent, keystore});
  const {capabilitySet} = await capabilitySets.get({profileAgentId: id});

  const settingsReferenceId = edvs.getReferenceId('settings');
  // TODO: Investigate using a map instead of a list to stop O(n) lookups
  const [settingsEdvZcap] = capabilitySet.zcaps.filter(({referenceId}) => {
    return referenceId === `${settingsReferenceId}-edv-configuration`;
  });
  // TODO: Investigate using a map instead of a list to stop O(n) lookups
  const [settingsEdvHmacZcap] = capabilitySet.zcaps.filter(({referenceId}) => {
    return referenceId === `${settingsReferenceId}-hmac`;
  });
  // TODO: Investigate using a map instead of a list to stop O(n) lookups
  const [settingsEdvKakZcap] = capabilitySet.zcaps.filter(({referenceId}) => {
    return referenceId === `${settingsReferenceId}-kak`;
  });
  const settingsEdv = await edvs.get({
    actor,
    capabilities: {
      hmac: settingsEdvHmacZcap,
      kak: settingsEdvKakZcap
    },
    keystoreAgent: profileKeystoreAgent,
    referenceId: settingsReferenceId,
    profileId
  });
  const [settingsDoc] = await settingsEdv.find({
    equals: {'content.id': profileId},
    capability: settingsEdvZcap,
    invocationSigner: capabilityAgent.getSigner()
  });
  return settingsDoc.content;
};

/**
 * Returns Profile(s) for a given account
 *
 * @param {String} accountId the id of the account associated with the
 *                           Profile(s).
 *
 * @return {Promise<Array<Profile>>} resolves to an array of profile settings.
 */
exports.getAll = async ({actor, accountId} = {}) => {
  assert.string(accountId, 'accountId');
  const prAgents = await profileAgents.getAll({accountId});
  // TODO: Find proper promise-fun library for concurrency
  const promises = prAgents.map(async ({profileAgent: {profile}}) => {
    return exports.get({actor, accountId, profileId: profile});
  });

  return Promise.all(promises);
};
