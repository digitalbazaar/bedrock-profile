/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

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

// module API
const api = {};
module.exports = api;

/**
 * Creates a Profile for a given account
 *
 *
 * @return {Promise<Profile>} resolves to a Profile.
 */
api.create = async ({account, settings}) => {
  const {profileAgent} = await profileAgents.create({account});
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
      profile: profileDid
    }
  });
  // 6. Store a single 'user' object in the profile's 'users' EDV
  // TODO: Make sure these config variables works in production mode
  const usersReferenceId = edvs.getReferenceId('users');
  const profileUsersEdv = await edvs.create({
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
  await profileUsersEdv.insert({
    doc: userDoc,
    invocationSigner,
    keyResolver
  });
  // 7. Store profile settings in the profile's settings EDV
  // TODO: Make sure these config variables works in production mode
  const settingsReferenceId = edvs.getReferenceId('settings');

  const profileSettingsEdv = await edvs.create({
    invocationSigner,
    kmsClient,
    profileId: profileDid,
    referenceId: settingsReferenceId
  });
  const settingsDoc = {
    id: await EdvClient.generateId(),
    content: {
      ...settings,
      id: profileDid,
      type: 'Profile'
    }
  };
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
    referenceId: usersReferenceId,
    allowedAction: ['read', 'write'],
    controller: paZcapAgent.id,
    invocationTarget: {
      id: profileUsersEdv.id,
      type: 'urn:edv:documents'
    }
  };
  const delegateSettingsEdvRequest = {
    referenceId: settingsReferenceId,
    allowedAction: ['read', 'write'],
    controller: paZcapAgent.id,
    invocationTarget: {
      id: profileSettingsEdv.id,
      type: 'urn:edv:documents'
    }
  };
  const [useresEdvZcap, settingsEdvZcap] = await Promise.all([
    delegateCapability({
      edvClient: profileUsersEdv,
      signer: invocationSigner,
      request: delegateUsersEdvRequest
    }),
    delegateCapability({
      edvClient: profileSettingsEdv,
      signer: invocationSigner,
      request: delegateSettingsEdvRequest
    })
  ]);
  const zcaps = [useresEdvZcap, settingsEdvZcap];
  const {capabilitySet: oldSet} = await capabilitySets.get(
    {profileAgentId: profileAgent.id});
  const newCapabilitySet = {
    ...oldSet,
    sequence: oldSet.sequence + 1,
    // TODO: Ensure duplicate zcaps are not added to list
    zcaps: oldSet.zcaps.concat(zcaps)
  };
  await capabilitySets.update({capabilitySet: newCapabilitySet});
  return res.content;
};
