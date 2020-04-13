/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const kms = require('./kms');
const profileAgents = require('./profileAgents');
const utils = require('./utils');
const {delegateCapability} = require('./zcaps');

const KMS_MODULE = 'ssm-v1';

/**
 * Creates a Profile for a given account
 *
 *
 * @param {string} accountId - Id of the account to associate with the Profile.
 * @param {string} [didMethod='key'] - Profile ID DID method (key or v1, etc).
 * @param {string} [didMethodMode='test'] - Optional DID Method ledger mode
 *   (relevant only for Veres One for the moment, to select testnet or main).
 *
 * @return {Promise<Profile>} resolves to a profile's settings.
 */
module.exports.create = async ({
  accountId, didMethod = 'key', didMethodMode = 'test'} = {}) => {
  assert.string(accountId, 'accountId');
  const {profileAgent, secrets} = await profileAgents.create({accountId});
  const {capabilityAgent: paZcapAgent} = await profileAgents.getAgents({
    profileAgent, secrets
  });
  // 1. Use the ProfileAgent to generate a new AsymmetricKey in its  keystore.
  //    This key will be the Profile's ZcapKey.
  const profileKeystore = await kms.createKeystore(
    {capabilityAgent: paZcapAgent, referenceId: 'primary'});
  const profileKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: paZcapAgent, keystore: profileKeystore});
  const key = await profileKeystoreAgent.generateKey(
    {type: 'Ed25519VerificationKey2018', kmsModule: KMS_MODULE});
  // 2. Use the ProfileZcapKey to generate the Profile DID
  // FIXME: Should be setting the profile DID to a V1 DID
  key.id = await utils.computeKeyId({key, didMethod, didMethodMode});
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

  // 4. Update the `controller` for the Profile Keystore, change from
  // `profileAgent.id` to Profile DID.
  // FIXME: Need to properly find the DID associated with the key
  const profileDid = key.id.split('#')[0];
  // FIXME: Add tests to ensure that keystore is controller by profile
  await kms.updateKeystoreController({
    id: profileKeystore.id,
    controller: profileDid
  });
  await profileAgents.update({
    profileAgent: {
      ...profileAgent,
      sequence: profileAgent.sequence + 1,
      profile: profileDid,
      zcaps: {
        profileCapabilityInvocationKey: zcap,
      }
    }
  });

  return {id: profileDid};
};
