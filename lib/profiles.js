/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const kms = require('./kms');
const profileAgents = require('./profileAgents');
const utils = require('./utils');
const {delegateCapability} = require('./zcaps');

/**
 * @typedef Profile
 * Creates a Profile for a given account.
 *
 * @typedef {object} ProfileKeystoreOptions
 * @property {KeystoreOptions} options.keystoreOptions.profileAgent - The
 *   root profile agent keystore options to use.
 * @property {KeystoreOptions} options.keystoreOptions.profile - The profile
 *   keystore options to use.
 *
 * @param {object} options - The options to use.
 * @param {string} options.accountId - The id of the account to associate
 *   with the Profile.
 * @param {string} options.didMethod - Supported: 'key' and 'v1'.
 * @param {ProfileKeystoreOptions} options.keystoreOptions - The keystore
 *   options to use.
 * @param {object} [options.didOptions] - Hashmap of optional DID
 *   method options.
 *
 * @returns {Promise<Profile>} Resolves to a profile's settings.
 */
module.exports.create = async ({
  accountId, didMethod, keystoreOptions, didOptions
} = {}) => {
  assert.string(accountId, 'accountId');
  assert.string(didMethod, 'didMethod');
  assert.object(keystoreOptions, 'keystoreOptions');
  utils.assertKeystoreOptions(
    keystoreOptions.profileAgent, 'keystoreOptions.profileAgent');
  utils.assertKeystoreOptions(
    keystoreOptions.profile, 'keystoreOptions.profile');
  assert.optionalObject(didOptions, 'didOptions');

  const SUPPORTED_DID_METHODS = ['key', 'v1'];
  if(!SUPPORTED_DID_METHODS.includes(didMethod)) {
    throw new Error(`Unsupported DID method "${didMethod}".`);
  }
  const {profileAgent, secrets} = await profileAgents.create({
    keystoreOptions: keystoreOptions.profileAgent,
    accountId
  });
  const {capabilityAgent: paZcapAgent} = await profileAgents.getAgents(
    {profileAgent, secrets});
  // 1. Use the ProfileAgent to generate a new AsymmetricKey in its  keystore.
  //    This key will be the Profile's ZcapKey.
  const profileKeystore = await kms.createKeystore({
    ...keystoreOptions.profile,
    applyIpAllowList: false,
    controller: paZcapAgent.id
  });
  const profileKeystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent: paZcapAgent, keystoreId: profileKeystore.id});
  const key = await profileKeystoreAgent.generateKey({type: 'asymmetric'});
  // 2. Use the ProfileZcapKey to generate the Profile DID
  key.id = await utils.computeKeyId({key, didMethod, didOptions});
  // 3. Delegate a capability from the Profile DID to the ProfileAgent to
  //    allow the ProfileAgent to sign with the ProfileZcapKey for the purpose
  //    of performing capability invocations.
  const keyDescription = await key.getKeyDescription();
  const delegateZcapKeyRequest = {
    referenceId: `${key.id}-key-capabilityInvocation`,
    // string should match KMS ops
    allowedAction: 'sign',
    controller: paZcapAgent.id,
    invocationTarget: {
      // use KMS key ID here
      id: keyDescription.id,
      type: keyDescription.type,
      proofPurpose: 'capabilityInvocation',
      publicAlias: key.id
    }
  };
  const zcap = await delegateCapability(
    {signer: key, request: delegateZcapKeyRequest});

  // 4. Update the `controller` for the Profile Keystore, change from
  // `profileAgent.id` to Profile DID.
  // Assuming structure of did:key and did:v1 key identifiers to be:
  // DID#KEY_IDENTIFIER
  const profileDid = key.id.split('#')[0];
  profileKeystore.controller = profileDid;
  await kms.updateKeystoreConfig({
    keystoreAgent: profileKeystoreAgent,
    keystoreConfig: profileKeystore,
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
