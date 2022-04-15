/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as kms from './kms.js';
import * as meterClient from './meterClient.js';
import * as profileMeters from './profileMeters.js';
import * as profileAgents from './profileAgents.js';
import * as utils from './utils.js';
import {createRequire} from 'module';
import {delegateCapability} from './zcaps.js';
const require = createRequire(import.meta.url);
const assert = require('assert-plus');

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
export async function create({
  accountId, didMethod, keystoreOptions, edvOptions, didOptions
} = {}) {
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

  /* The following is the profile provisioning process. It is safe for this
  process to fail at any step. If it fails before the profile agent record
  is written then some unusable data will be generated on external systems
  that can be garbage collected. If it fails thereafter, the process is
  recoverable / continuable:

  1. In parallel, do 1.x steps:
  1.1. Generate a new profile agent w/o storing it.
  1.2. Generate a TMP capability agent. Do not use the zcap client for the
    application so that we can distinguish keystores created for the
    application from those created for users (that may be abandoned if the
    provisioning process doesn't fully complete). Also, we can increase
    security by never storing the secret material for the capability agent
    that is used to bootstrap the keystore.
  1.2.2. Use the passed meters to create a keystore for the new profile that is
    temporarily controlled by the capability agent. Each meter's controller
    MUST be the local application's identity and these will be updated after
    provisioning is complete. The created keystore's controller will be changed
    later in the provisioning steps.
  1.2.3. Generate the ZCAP key for the profile and assign the profile ID based
    on the DID in its generated key ID.
  1.2.4. Create N EDVs for the profile. The User EDV will be created
    automatically for access management purposes, but additional EDVs may be
    passed to be created during provisioning. The root profile agent will be
    given full access to all provisioned EDVs.
  2. In parallel, do 2.x steps:
  2.1. Delegate a ZCAP for the profile's ZCAP key to the profile agent.
  2.2. Create a User EDV document ID for the profile.
  2.3. Create a User EDV document ID for the profile agent.
  2.4. Delegate ZCAPs to every profile EDV's KAK and HMAC to the
    profile agent. These must be delegated using the profile's ZCAP key.
  2.5. Delegate ZCAPs to the two User EDV documents to the profile agent. These
    must be delegated using the profile's ZCAP key.
  2.6. Delegate ZCAPs to the two User EDV documents to TMP. These must be
    delegated using the profile's ZCAP key. These ZCAPs are delegated to
    TMP to enable it to write the User EDV documents; it can write them
    more quickly and more timely than using the profile agent. More quickly
    because it does not need to hit a WebKMS system to do HTTP signatures and
    more timely because we do not have to wait for the profile's keystore
    controller to be changed to do this (TMP is still the controller at this
    time).
  3. In parallel, do 3.x steps:
  3.1. Write Profile User EDV doc using TMP. TMP is still the controller of
    the profile's KAK and HMAC, so it can use the root ZCAP to invoke these.
  3.2. Write Profile agent EDV doc using TMP.
  4. Update the profile keystore controller to be the profile agent. This
    step effectively invalidates TMP and must be done last right before
    the profile agent record is written to the database. If the process
    fails at this point (or at any point prior), then some unusable data may
    have been created on external systems (e.g., KMS and EDV systems), but
    it will be linked to the meter controller, which is the local application.
    Therefore, if necessary, this data can be periodically garbage collected by
    the local application or disassociated from the local application as it
    has authority over it via this meter binding.
  5. Write the profile agent record to the database, including the meter IDs
    in its meta to track them temporarily. **Once this step completes, the
    provisioning process is recoverable / continuable if it should fail in
    any subsequent step.**
  6. In parallel, do 6.x steps:
  6.1. Update the controllers for the KMS and EDV meters, changing them
    the local application to the profile. This update function must be written
    in a loop, allowing for concurrent updates. If a concurrent update occurs,
    the function must treat errors that are thrown because the meter
    controllers have already been changed to the profile (by a concurrent
    process that is also continuing the provisioning process) as success. Other
    errors must be thrown.
  6.2. Write the meters to the profile meter collection. This function must
    ignore duplicate errors; others must be thrown. Duplicate errors will
    be thrown when a concurrent process inserts the meters because it is
    also continuing the provisioning process.
  7. Remove the meters from the profile agent record, signaling that the
    provisioning process is complete and does not need to be continued by
    any other process. This update function must be written in a loop, allowing
    for concurrent updates. If a concurrent update occurs, the function must
    treat errors that are thrown because the profile agent record has already
    been updated to remove the meters (by a concurrent process that is also
    continuing the provisioning process) as success. Other errors must be
    thrown.
  8. Return the profile ID and the meters. */

  /* Note: Here we create profile agent record without storing it yet. We will
  only store it once the profile has been fully provisioned. If this process
  fails before then, then some data will have been generated on external
  systems, e.g., on KMS / EDV systems, but it will be linked to the meter
  controller. In typical practice, the meter controller will be the local
  application (e.g., a digital wallet) during profile provisioning and will
  be changed to the profile itself only after provisioning completes. This
  means the local application (or an administrator for it) can periodically
  clean up the external, unused data as needed. */
  const profileAgentRecord = await profileAgents.create({
    keystoreOptions: keystoreOptions.profileAgent, accountId,
    store: true
  });
  const {profileAgent, secrets} = profileAgentRecord;

  // FIXME: consider using `keystoreAgent.capabilityAgent` to create the
  // profile keystore as it would be more efficient and potential threat
  // is low in new model (profile agent will only be stored if the
  // profile keystore controller is changed to the profile)
  // FIXME: in fact, we could just create another profile agent here
  // from a random seed ... and then throw it away once we assign the
  // profile agent; that would allow us to create the profile and profile
  // agent concurrently, further improving performance
  const {capabilityAgent: paZcapAgent} = await profileAgents.getAgents(
    {profileAgent, secrets});

  /* 1. Use the ProfileAgent to create the profile's keystore as its temporary
  controller. Once created and the Profile's root ZCAP key has been generated
  in it, then the Profile can be assigend an identifier and become the
  controller of its own keystore. */
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

  /* 2. Generate the Profile's ZCAP key and use it to set the Profile's DID. */
  const key = await profileKeystoreAgent.generateKey({
    type: 'asymmetric',
    publicAliasTemplate: utils.getPublicAliasTemplate({didMethod, didOptions})
  });
  // the above `publicAliasTemplate` ensures that the DID key identifier will
  // be: <did>#<key identifier fragment>
  const profileId = key.id.split('#')[0];

  /* 3. Delegate a capability from the Profile DID to the ProfileAgent to
  allow the ProfileAgent to sign with the ProfileZcapKey for the purpose
  of performing capability invocations. */
  const zcap = await _delegateProfileCapabilityInvocationKeyZcap({
    key, controller: paZcapAgent.id, profileKeystoreId: profileKeystore.id
  });

  // FIXME: should be storing the profile agent for the first time here
  profileAgent.profile = profileId;

  await profileAgents.update({
    profileAgent: {
      ...profileAgent,
      sequence: profileAgent.sequence + 1,
      profile: profileId,
      zcaps: {
        profileCapabilityInvocationKey: zcap,
      }
    }
  });

  // 4. Update the `controller` for the Profile Keystore, change from
  // `profileAgent.id` to Profile DID and update the `controller` for the
  // WebKMS Meter and EDV Meter, change from `br-app-identity.application.id`
  // to Profile DID.
  profileKeystore.controller = profileId;
  const edvMeter = {
    id: edvOptions.profile.meterId,
    profile: profileId,
    serviceType: 'edv',
    referenceId: 'profile:core:edv'
  };
  const kmsMeter = {
    id: keystoreOptions.profile.meterId,
    profile: profileId,
    serviceType: 'webkms',
    referenceId: 'profile:core:webkms'
  };

  // FIXME: should we update the keystore config prior to storing the
  // profile agent? we're changing the controller from the profile agent
  // to the profile ... the order should probably be:
  // 1. create other EDVs using wallet's ZCAP client
  // 2. create zcaps for profile agent to access EDVs
  // 3. write profile agent record with meters in it (to allow continuation
  //    if we fail)
  // 4. update keystore config
  // 5. update meter controllers and write them to the database
  //    (can happen in parallel)
  // 6. remove meters from profile agent record
  //
  // ... if a profile agent record is ever loaded and it has meters in it,
  // ... attempt to run steps 3-6 again, allowing for failures if the
  // ... meters were already added or the controllers were already changed
  // ... will need to loop when getting the keystore configs -- *and* if
  // ... the keystore config can't be retrieved due to NotAllowedError,
  // ... assume it was already updated to the profile
  const [, , , ...meters] = await Promise.all([
    kms.updateKeystoreConfig({
      keystoreAgent: profileKeystoreAgent,
      keystoreConfig: profileKeystore,
    }),
    _updateMeterController({
      ...keystoreOptions.profile, controller: profileId
    }),
    _updateMeterController({...edvOptions.profile, controller: profileId}),
    profileMeters.add({meter: kmsMeter}),
    profileMeters.add({meter: edvMeter})
  ]);

  return {id: profileId, meters};
}

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
