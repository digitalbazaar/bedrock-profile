/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as kms from './kms.js';
import * as meterClient from './meterClient.js';
import * as profileMeters from './profileMeters.js';
import * as profileAgents from './profileAgents.js';
import * as utils from './utils.js';
import {createRequire} from 'module';
import {delegate} from './zcaps.js';
import {httpsAgent} from '@bedrock/https-agent';
import {keyResolver} from './keyResolver.js';
const require = createRequire(import.meta.url);
const assert = require('assert-plus');
const {EdvClient, default: edvClient} = require('@digitalbazaar/edv-client');

const {util: {BedrockError}} = bedrock;

// TTL for root profile agent's zcap to use profile zcap invocation key:
// 1000 years
const PROFILE_ZCAP_INVOCATION_KEY_ZCAP_TTL = 1000 * 365 * 24 * 60 * 60 * 1000;

// TTL for profile agent's EDV zcaps: 365 days
const DEFAULT_PROFILE_AGENT_ZCAP_TTL = 365 * 24 * 60 * 60 * 1000;

const ZCAP_REFERENCE_IDS = {
  profileUserDoc: 'profile-edv-document',
  profileAgentUserDoc: 'userDocument',
  userDocs: 'user-edv-documents',
  userKak: 'user-edv-kak',
  userHmac: 'user-edv-hmac',
};

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
 * @typedef {object} ProfileEdvOptions
 * @property {EdvOptions} options.edvOptions.profile - The profile EDV
 *   options to use.
 *
 * @param {object} options - The options to use.
 * @param {string} options.accountId - The id of the account to associate
 *   with the Profile.
 * @param {string} options.didMethod - Supported: 'key' and 'v1'.
 * @param {ProfileKeystoreOptions} options.keystoreOptions - The keystore
 *   options to use.
 * @param {ProfileEdvOptions} options.edvOptions - The edv options to use.
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
  utils.assertEdvOptions(edvOptions.profile, 'edvOptions.profile');
  assert.optionalObject(didOptions, 'didOptions');

  const SUPPORTED_DID_METHODS = ['key', 'v1'];
  if(!SUPPORTED_DID_METHODS.includes(didMethod)) {
    throw new Error(`Unsupported DID method "${didMethod}".`);
  }

  // reserve `user` `referenceIdPrefix`
  const {additionalEdvs = []} = edvOptions.profile;
  for(const {referenceIdPrefix} of additionalEdvs) {
    if(referenceIdPrefix === 'user') {
      throw new Error('"user" reference ID prefix is reserved.');
    }
  }

  // require meter zcap invocation signer to match local application zcap
  // invocation signer
  const appInvocationSignerId = utils.ZCAP_CLIENT.invocationSigner.id;
  if(keystoreOptions.profile.meterCapabilityInvocationSigner.id !==
    appInvocationSignerId) {
    throw new Error(
      'Profile keystore meter invocation signer ' +
      `"${meterCapabilityInvocationSigner.id}" must match local application ` +
      `zcap invocation signer "${appInvocationSignerId}".`);
  }
  if(edvOptions.profile.meterCapabilityInvocationSigner.id !==
    appInvocationSignerId) {
    throw new Error(
      'Profile EDV meter invocation signer ' +
      `"${meterCapabilityInvocationSigner.id}" must match local application ` +
      `zcap invocation signer "${appInvocationSignerId}".`);
  }

  /* The following is the profile provisioning process. It is safe for this
  process to fail at any step. If it fails before the profile agent record
  is written then some unusable data will be generated on external systems
  that can be garbage collected. If it fails thereafter, the process is
  recoverable / continuable. */

  /* 1. In parallel:
  1.1. Generate a new profile agent w/o storing it.
  1.2. Create a keystore and EDVs for the profile using a temporary capability
    agent, TMP. */
  const [
    profileAgentRecord,
    {tmpCapabilityAgent, edvs, profileId, keystore, keystoreAgent, key}
  ] = await Promise.all([
    profileAgents.create({
      keystoreOptions: keystoreOptions.profileAgent, accountId,
      store: false
    }),
    _createKeystoreAndEDVs({
      didMethod, keystoreOptions, edvOptions, didOptions
    })
  ]);
  const {profileAgent} = profileAgentRecord;

  /* 2. Prepare access management by generating User EDV document IDs and
  zcaps. */
  const {
    profileCapabilityInvocationKeyZcap, edvsZcaps,
    profileUserDocZcap, profileAgentUserDocZcap,
    profileUserDocId, profileAgentUserDocId,
    tmpEdvDocumentsZcap
  } = await _prepareAccessManagement({
    tmpCapabilityAgent, edvs, keystore, key, profileAgent
  });

  /* 3. Create profile and profile agent user docs. */
  const profileUserDoc = _createProfileUserDoc(
    {profileId, profileUserDocId, userEdv: edvs.user});
  const profileAgentUserDoc = _createProfileAgentUserDoc({
    profileAgent, profileAgentUserDocId,
    profileCapabilityInvocationKeyZcap, edvsZcaps,
    profileUserDocZcap, profileAgentUserDocZcap
  });

  /* 4. In parallel:
  4.1. Write Profile User EDV doc using TMP. Note: TMP is still the controller
    of the profile's KAK and HMAC, so it can use the root ZCAP to invoke those.
  4.2. Write Profile agent EDV doc using TMP. */
  const edvClient = new EdvClient({
    capability: tmpEdvDocumentsZcap,
    invocationSigner: tmpCapabilityAgent.getSigner(),
    keyResolver,
    keyAgreementKey: edvs.user.keyAgreementKey,
    hmac: edvs.user.hmac,
    httpsAgent
  });
  for(const index of profileUserDoc.content.accessManagement.indexes) {
    edvClient.ensureIndex(index);
  }
  await Promise.all([
    edvClient.update({doc: profileUserDoc}),
    edvClient.update({doc: profileAgentUserDoc})
  ]);

  /* 4. Update the profile keystore controller to be the profile agent. This
    step effectively invalidates TMP and must be done last right before
    the profile agent record is written to the database. If the process
    fails at this point (or at any point prior), then some unusable data may
    have been created on external systems (e.g., KMS and EDV systems), but
    it will be linked to the meter controller, which is the local application.
    Therefore, if necessary, this data can be periodically garbage collected by
    the local application or disassociated from the local application as it
    has authority over it via this meter binding. */


  /* 5. Write the profile agent record to the database, including the meter IDs
    in its meta to track them temporarily. **Once this step completes, the
    provisioning process is recoverable / continuable if it should fail in
    any subsequent step.** */

  /* 6. In parallel:
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
    also continuing the provisioning process. */

  /* 7. Remove the meters from the profile agent record, signaling that the
    provisioning process is complete and does not need to be continued by
    any other process. This update function must be written in a loop, allowing
    for concurrent updates. If a concurrent update occurs, the function must
    treat errors that are thrown because the profile agent record has already
    been updated to remove the meters (by a concurrent process that is also
    continuing the provisioning process) as success. Other errors must be
    thrown. */

  /* 8. Return the profile ID and the meters. */

  // FIXME: move to later
  await profileAgents.insert({record: profileAgentRecord});
  const {secrets} = profileAgentRecord;

  const {capabilityAgent: paZcapAgent} = await profileAgents.getAgents(
    {profileAgent, secrets});

  /* 1. Use the ProfileAgent to create the profile's keystore as its temporary
  controller. Once created and the Profile's root ZCAP key has been generated
  in it, then the Profile can be assigend an identifier and become the
  controller of its own keystore. */
  const profileKeystore2 = await kms.createKeystore({
    ...keystoreOptions.profile,
    // this keystore must be accessible from any IP; it needs to support
    // delegated zcaps, it defers key security to external parties at the edge
    // where there is no centralized "honey pot" of keys to attempt to steal
    applyIpAllowList: false,
    controller: paZcapAgent.id
  });
  const profileKeystoreAgent2 = kms.getKeystoreAgent(
    {capabilityAgent: paZcapAgent, keystoreId: profileKeystore2.id});

  /* 2. Generate the Profile's ZCAP key and use it to set the Profile's DID. */
  const key2 = await profileKeystoreAgent2.generateKey({
    type: 'asymmetric',
    publicAliasTemplate: utils.getPublicAliasTemplate({didMethod, didOptions})
  });
  // the above `publicAliasTemplate` ensures that the DID key identifier will
  // be: <did>#<key identifier fragment>
  const profileId2 = key2.id.split('#')[0];

  /* 3. Delegate a capability from the Profile DID to the ProfileAgent to
  allow the ProfileAgent to sign with the ProfileZcapKey for the purpose
  of performing capability invocations. */
  const zcap2 = await _delegateProfileCapabilityInvocationKeyZcap({
    key: key2, controller: paZcapAgent.id,
    profileKeystoreId: profileKeystore2.id
  });

  // FIXME: should be storing the profile agent for the first time here
  profileAgent.profile = profileId2;

  await profileAgents.update({
    profileAgent: {
      ...profileAgent,
      sequence: profileAgent.sequence + 1,
      profile: profileId2,
      zcaps: {
        profileCapabilityInvocationKey: zcap2,
      }
    }
  });

  // 4. Update the `controller` for the Profile Keystore, change from
  // `profileAgent.id` to Profile DID and update the `controller` for the
  // WebKMS Meter and EDV Meter, change from `br-app-identity.application.id`
  // to Profile DID.
  profileKeystore2.controller = profileId2;
  const edvMeter = {
    id: edvOptions.profile.meterId,
    profile: profileId2,
    serviceType: 'edv',
    referenceId: 'profile:core:edv'
  };
  const kmsMeter = {
    id: keystoreOptions.profile.meterId,
    profile: profileId2,
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
      keystoreAgent: profileKeystoreAgent2,
      keystoreConfig: profileKeystore2,
    }),
    _updateMeterController({
      ...keystoreOptions.profile, controller: profileId2
    }),
    _updateMeterController({...edvOptions.profile, controller: profileId2}),
    profileMeters.add({meter: kmsMeter}),
    profileMeters.add({meter: edvMeter})
  ]);

  return {id: profileId2, meters};
}

async function _createEdv({
  referenceIdPrefix, keystoreAgent, edvOptions, profileId
}) {
  const edv = {referenceIdPrefix};
  const {
    baseUrl,
    meterId,
    meterCapabilityInvocationSigner: invocationSigner
  } = edvOptions.profile;

  // create EDV recipient keys
  const {hmac, keyAgreementKey} = await _createEdvRecipientKeys(
    {keystoreAgent});

  // create EDV
  let config = {
    sequence: 0,
    controller: profileId,
    // FIXME: remove in future versions to reduce information exposed to server
    referenceId: referenceIdPrefix,
    meterId,
    keyAgreementKey: {id: keyAgreementKey.id, type: keyAgreementKey.type},
    hmac: {id: hmac.id, type: hmac.type}
  };
  config = await EdvClient.createEdv(
    {config, httpsAgent, invocationSigner, url: `${baseUrl}/edvs`});

  edv.id = config.id;
  edv.config = config;
  edv.hmac = hmac;
  edv.keyAgreementKey = keyAgreementKey;
  return edv;
}

async function _createEdvRecipientKeys({keystoreAgent} = {}) {
  const [keyAgreementKey, hmac] = await Promise.all([
    keystoreAgent.generateKey({type: 'keyAgreement'}),
    keystoreAgent.generateKey({type: 'hmac'})
  ]);
  return {hmac, keyAgreementKey};
}

function _createProfileUserDoc({profileId, profileUserDocId, userEdv}) {
  const {hmac, keyAgreementKey} = userEdv;
  const profileUserDoc = {
    id: profileUserDocId,
    content: {
      id: profileId,
      type: ['User', 'Profile'],
      accessManagement: {
        edvId: userEdv.id,
        hmac: {id: hmac.id, type: hmac.type},
        keyAgreementKey: {id: keyAgreementKey.id, type: keyAgreementKey.type},
        indexes: [
          {attribute: 'content.id', unique: true},
          {attribute: 'content.type'}
        ]
      },
      zcaps: {}
    }
  };
  return profileUserDoc;
}

function _createProfileAgentUserDoc({
  profileAgent, profileAgentUserDocId,
  profileCapabilityInvocationKeyZcap, edvsZcaps,
  profileUserDocZcap, profileAgentUserDocZcap
}) {
  const profileAgentUserDoc = {
    id: profileAgentUserDocId,
    content: {
      id: profileAgent.id,
      name: 'root',
      type: ['User', 'Agent'],
      zcaps: {
        profileCapabilityInvocationKey: profileCapabilityInvocationKeyZcap,
        [ZCAP_REFERENCE_IDS.profileUserDoc]: profileUserDocZcap,
        [ZCAP_REFERENCE_IDS.profileAgentUserDoc]: profileAgentUserDocZcap
      },
      authorizedDate: (new Date()).toISOString()
    }
  };
  for(const zcaps of Object.values(edvsZcaps)) {
    for(const [referenceId, zcap] of Object.entries(zcaps)) {
      profileAgentUserDoc.content.zcaps[referenceId] = zcap;
    }
  }
  return profileAgentUserDoc;
}

async function _createKeystoreAndEDVs({
  didMethod, keystoreOptions, edvOptions, didOptions
}) {
  /* 1. Generate a TMP capability agent. Do not use the zcap client for the
    application so that we can distinguish keystores created for the
    application from those created for users (that may be abandoned if the
    provisioning process doesn't fully complete). Also, we can increase
    security by never storing the secret material for the capability agent
    that is used to bootstrap the keystore. Once the profile's root ZCAP
    key has been generated, the keystore's controller can be updated to be
    the profile. */
  const {capabilityAgent} = await utils.createCapabilityAgent();

  /* 2. Use the passed meters to create a keystore for the new profile that is
    temporarily controlled by TMP. Each meter's controller MUST be the local
    application's identity and these will be updated after provisioning is
    complete. The created keystore's controller will be changed later in the
    provisioning steps. */
  const keystore = await kms.createKeystore({
    ...keystoreOptions.profile,
    // this keystore must be accessible from any IP; it needs to support
    // delegated zcaps, it defers key security to external parties at the edge
    // where there is no centralized "honey pot" of keys to attempt to steal
    applyIpAllowList: false,
    controller: capabilityAgent.id
  });
  const keystoreAgent = kms.getKeystoreAgent(
    {capabilityAgent, keystoreId: keystore.id});

  /* 3. Generate the ZCAP key for the profile and assign the profile ID based
    on the DID in its generated key ID. */
  const key = await keystoreAgent.generateKey({
    type: 'asymmetric',
    publicAliasTemplate: utils.getPublicAliasTemplate({didMethod, didOptions})
  });
  // the above `publicAliasTemplate` ensures that the DID key identifier will
  // be: <did>#<key identifier fragment>
  const profileId = key.id.split('#')[0];

  /* 4. Create N EDVs for the profile. The User EDV will be created
    automatically for access management purposes, but additional EDVs may be
    passed to be created during provisioning. The root profile agent will be
    given full access to all provisioned EDVs. */
  const edvs = {};
  const {additionalEdvs = []} = edvOptions.profile;
  const allEdvs = [...additionalEdvs, {referenceIdPrefix: 'user'}];
  await Promise.all(allEdvs.map(async ({referenceIdPrefix}) => {
    edvs[referenceIdPrefix] = await _createEdv(
      {referenceIdPrefix, keystoreAgent, edvOptions, profileId});
  }));

  return {
    tmpCapabilityAgent: capabilityAgent,
    edvs, keystore, keystoreAgent, profileId, key
  };
}

async function _delegateEdvsZcaps({
  key, keystore, edvs, controller, ttl = DEFAULT_PROFILE_AGENT_ZCAP_TTL
}) {
  const allZcaps = {};
  await Promise.all([...Object.values(edvs)].map(async edv => {
    const {referenceIdPrefix} = edv;
    const {zcaps} = await _delegateEdvZcaps(
      {key, keystore, edv, controller, ttl});
    allZcaps[referenceIdPrefix] = zcaps;
  }));
  return allZcaps;
}

async function _delegateEdvZcaps({
  key, keystore, edv, controller, ttl = DEFAULT_PROFILE_AGENT_ZCAP_TTL
}) {
  const {id: edvId, referenceIdPrefix, hmac, keyAgreementKey} = edv;
  const expires = new Date(Date.now() + ttl);
  const keystoreRootZcap = `urn:zcap:root:${encodeURIComponent(keystore.id)}`;

  const [documentsZcap, hmacZcap, kakZcap] = await Promise.all([
    _delegateEdvDocumentsZcap({key, edvId, controller, ttl}),
    // hmac key
    delegate({
      allowedActions: ['sign'],
      capability: keystoreRootZcap,
      controller,
      expires,
      invocationTarget: hmac.kmsId,
      signer: key
    }),
    // key agreement key
    delegate({
      allowedActions: ['deriveSecret'],
      capability: keystoreRootZcap,
      controller,
      expires,
      invocationTarget: keyAgreementKey.kmsId,
      signer: key
    })
  ]);

  // build zcap referenceId => zcap map
  const zcaps = {
    [`${referenceIdPrefix}-edv-documents`]: documentsZcap,
    [`${referenceIdPrefix}-edv-hmac`]: hmacZcap,
    [`${referenceIdPrefix}-edv-kak`]: kakZcap
  };
  return {zcaps};
}

async function _delegateEdvDocumentsZcap({
  key, edvId, controller, ttl = DEFAULT_PROFILE_AGENT_ZCAP_TTL
}) {
  return delegate({
    allowedActions: ['read', 'write'],
    capability: `urn:zcap:root:${encodeURIComponent(edvId)}`,
    controller,
    expires: new Date(Date.now() + ttl),
    invocationTarget: `${edvId}/documents`,
    signer: key
  });
}

async function _delegateEdvDocumentZcap({
  key, edvId, docId, controller,
  ttl = DEFAULT_PROFILE_AGENT_ZCAP_TTL
}) {
  return delegate({
    allowedActions: ['read'],
    capability: `urn:zcap:root:${encodeURIComponent(edvId)}`,
    controller,
    expires: new Date(Date.now() + ttl),
    invocationTarget: `${edvId}/documents/${docId}`,
    signer: key
  });
}

async function _delegateProfileCapabilityInvocationKeyZcap({
  key, controller, profileKeystoreId
}) {
  const expires = new Date(Date.now() + PROFILE_ZCAP_INVOCATION_KEY_ZCAP_TTL);
  return delegate({
    allowedActions: ['sign'],
    capability: `urn:zcap:root:${encodeURIComponent(profileKeystoreId)}`,
    controller,
    expires,
    invocationTarget: key.kmsId,
    signer: key
  });
}

async function _prepareAccessManagement({
  tmpCapabilityAgent, edvs, keystore, key, profileAgent
}) {
  /* In parallel:
  1. Create a User EDV document ID for the profile.
  2. Create a User EDV document ID for the profile agent. */
  const [profileUserDocId, profileAgentUserDocId] = await Promise.all([
    EdvClient.generateId(),
    EdvClient.generateId()
  ]);

  /* In parallel:
  2. Delegate a ZCAP for the profile's ZCAP key to the profile agent to
    allow the profile agent to sign with the profile's ZCAP key for the purpose
    of performing capability invocations.
  3. Delegate ZCAPs to every profile EDV's KAK and HMAC and `documents`
    endpoint to the profile agent. These must be delegated using the profile's
    ZCAP key.
  4. Delegate ZCAPs to the two User EDV documents to the profile agent. These
    must be delegated using the profile's ZCAP key.
  5. Delegate a ZCAP for the User EDV to TMP. This must be delegated using the
    profile's ZCAP key. This ZCAP is delegated to TMP to enable it to write
    the User EDV documents; it can write them more quickly and more timely than
    using the profile agent. More quickly because it does not need to hit a
    WebKMS system to do HTTP signatures and more timely because we do not have
    to wait for the profile's keystore controller to be changed to do this
    (TMP is still the controller at this time). */
  const [
    profileCapabilityInvocationKeyZcap, edvsZcaps,
    profileUserDocZcap, profileAgentUserDocZcap,
    tmpEdvDocumentsZcap
  ] = await Promise.all([
    _delegateProfileCapabilityInvocationKeyZcap(
      {key, controller: profileAgent.id, profileKeystoreId: keystore.id}),
    _delegateEdvsZcaps({key, keystore, edvs, controller: profileAgent.id}),
    _delegateEdvDocumentZcap({
      key, edvId: edvs.user.id, docId: profileUserDocId,
      controller: profileAgent.id
    }),
    _delegateEdvDocumentZcap({
      key, edvId: edvs.user.id, docId: profileAgentUserDocId,
      controller: profileAgent.id
    }),
    _delegateEdvDocumentsZcap({
      key, edvId: edvs.user.id, controller: tmpCapabilityAgent.id,
      // use a short TTL (5 minutes) as this zcap will be discarded quickly
      ttl: 1000 * 60 * 5
    })
  ]);

  return {
    profileCapabilityInvocationKeyZcap, edvsZcaps,
    profileUserDocZcap, profileAgentUserDocZcap,
    profileUserDocId, profileAgentUserDocId,
    tmpEdvDocumentsZcap
  };
}

async function _updateMeterController({
  meterId, meterCapabilityInvocationSigner, controller
}) {
  while(true) {
    const {meter} = await meterClient.get({
      url: meterId, invocationSigner: meterCapabilityInvocationSigner
    });

    if(meter.controller === controller) {
      // controller already matches meter
      return {meter};
    }

    // meter `controller` must match local application ID in order for it
    // to be changed, otherwise throw
    if(meter.controller !== utils.APP_ID) {
      throw new BedrockError(
        'Profile meter controller cannot be changed; existing controller ' +
        `"${meter.controller}" does not match local application ID ` +
        `"${utils.APP_ID}".`, 'NotAllowedError');
    }

    meter.controller = controller;

    try {
      return await meterClient.update({
        meter, url: meterId, invocationSigner: meterCapabilityInvocationSigner
      });
    } catch(e) {
      if((e.data && e.data.type) !== 'InvalidStateError') {
        throw e;
      }
      // invalid state error when updating means sequence didn't match because
      // meter was changed by another concurrent process, so loop to try again
    }
  }
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

/**
 * @typedef {object} EdvOptions
 * @property {string} baseUrl - The base URL of the EDV service, e.g., the
 *   URL `<baseUrl>/edvs` will be hit to create a vault.
 * @property {object} meterId - The full URL ID of the meter; to be given to
 *   the EDV service when creating a vault.
 * @property {object} meterCapabilityInvocationSigner - The invocation signer
 *   to use to create a vault associated with the given meter capability.
 */
