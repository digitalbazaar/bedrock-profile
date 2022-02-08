/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const kms = require('./kms');
const meterClient = require('./meterClient');
const profileMeters = require('./profileMeters');
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
 * @param {object} options.edvOptions - The edv options to use.
 * @param {object} [options.didOptions] - Hashmap of optional DID
 *   method options.
 *
 * @returns {Promise<Profile>} Resolves to a profile's settings.
 */
module.exports.create = async ({
  accountId, didMethod, keystoreOptions, edvOptions, didOptions
} = {}) => {
  assert.string(accountId, 'accountId');
  assert.string(didMethod, 'didMethod');
  assert.object(keystoreOptions, 'keystoreOptions');
  assert.object(edvOptions, 'edvOptions');
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
  // 2. Use the ProfileZcapKey to generate the Profile DID
  const publicAliasTemplate = utils.getPublicAliasTemplate({
    didMethod, didOptions
  });
  const key = await profileKeystoreAgent.generateKey({
    type: 'asymmetric',
    publicAliasTemplate,
  });
  // 3. Delegate a capability from the Profile DID to the ProfileAgent to
  //    allow the ProfileAgent to sign with the ProfileZcapKey for the purpose
  //    of performing capability invocations.
  // set expiration for profile agent zcap 1000yrs. from current date
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1000);
  const delegateZcapKeyRequest = {
    // string should match KMS ops
    allowedAction: 'sign',
    controller: paZcapAgent.id,
    invocationTarget: key.kmsId,
    parentCapability: `urn:zcap:root:${encodeURIComponent(profileKeystore.id)}`,
    // FIXME: Figure out where to put type information
    type: key.type,
    // FIXME: Figure out location for desired "proofPurpose"
    proofPurpose: 'capabilityInvocation',
    // FIXME: Figure out if we still use publicAlias
    publicAlias: key.id,
    expires
  };

  const zcap = await delegateCapability({
    signer: key, request: delegateZcapKeyRequest
  });

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

  // 5. Update the `controller` for the WebKMS Meter and EDV Meter, change from
  // `br-app-identity.application.id` to Profile DID.
  const edvMeter = {
    id: edvOptions.profile.meterId,
    profile: profileDid,
    serviceType: 'edv',
    referenceId: 'profile:core:edv'
  };
  const kmsMeter = {
    id: keystoreOptions.profile.meterId,
    profile: profileDid,
    serviceType: 'webkms',
    referenceId: 'profile:core:webkms'
  };

  const results = await Promise.all([
    _updateMeterController({
      ...keystoreOptions.profile, controller: profileDid
    }),
    _updateMeterController({...edvOptions.profile, controller: profileDid}),
    profileMeters.add({meter: kmsMeter}),
    profileMeters.add({meter: edvMeter}),
  ]);
  const meters = results.slice(Math.max(results.length - 2, 1));

  return {id: profileDid, meters};
};

async function _updateMeterController({
  meterId, meterCapabilityInvocationSigner, controller
}) {
  const {meter} = await meterClient.get({
    url: meterId, invocationSigner: meterCapabilityInvocationSigner
  });

  meter.controller = controller;

  return meterClient.update({
    meter, url: meterId, invocationSigner: meterCapabilityInvocationSigner
  });
}
