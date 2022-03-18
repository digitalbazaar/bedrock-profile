/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const kms = require('./kms');
const meterClient = require('./meterClient');
const profileMeters = require('./profileMeters');
const profileAgents = require('./profileAgents');
const utils = require('./utils');
const {delegateCapability} = require('./zcaps');

// TTL for root profile agent's zcap to use profile zcap invocation key:
// 1000 years
const PROFILE_ZCAP_INVOCATION_KEY_ZCAP_TTL = 1000 * 365 * 24 * 60 * 60 * 1000;

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
exports.create = async ({
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
  // 1. Use the ProfileAgent to generate a new AsymmetricKey in its keystore.
  //    This key will be the Profile's ZcapKey.
  const profileKeystore = await kms.createKeystore({
    ...keystoreOptions.profile,
    // this keystore must be accessible from any IP; it needs to support
    // delegated zcaps, it defers key security to external parties at the edge
    // where there is no centralized "honey pot" of keys to attempt to steal
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
  // Assuming structure of did:key and did:v1 key identifiers to be:
  // DID#KEY_IDENTIFIER
  const profileDid = key.id.split('#')[0];

  // 3. Delegate a capability from the Profile DID to the ProfileAgent to
  //    allow the ProfileAgent to sign with the ProfileZcapKey for the purpose
  //    of performing capability invocations.
  const zcap = await _delegateProfileCapabilityInvocationKeyZcap({
    key, controller: paZcapAgent.id, profileKeystoreId: profileKeystore.id
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

  // 4. Update the `controller` for the Profile Keystore, change from
  // `profileAgent.id` to Profile DID and update the `controller` for the
  // WebKMS Meter and EDV Meter, change from `br-app-identity.application.id`
  // to Profile DID.
  profileKeystore.controller = profileDid;
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

  const [, , , ...meters] = await Promise.all([
    kms.updateKeystoreConfig({
      keystoreAgent: profileKeystoreAgent,
      keystoreConfig: profileKeystore,
    }),
    _updateMeterController({
      ...keystoreOptions.profile, controller: profileDid
    }),
    _updateMeterController({...edvOptions.profile, controller: profileDid}),
    profileMeters.add({meter: kmsMeter}),
    profileMeters.add({meter: edvMeter})
  ]);

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

async function _delegateProfileCapabilityInvocationKeyZcap({
  key, controller, profileKeystoreId
}) {
  const expires = new Date(Date.now() + PROFILE_ZCAP_INVOCATION_KEY_ZCAP_TTL);
  const request = {
    // string should match KMS ops
    allowedAction: 'sign',
    controller,
    invocationTarget: key.kmsId,
    parentCapability: `urn:zcap:root:${encodeURIComponent(profileKeystoreId)}`,
    // FIXME: Figure out where to put type information
    type: key.type,
    expires
  };
  return delegateCapability({signer: key, request});
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
