/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as kms from './kms.js';
import * as profileAgents from './profileAgents.js';
import * as profileMeters from './profileMeters.js';
import * as utils from './utils.js';
import {createRequire} from 'node:module';
import {delegate} from './zcaps.js';
import {httpsAgent} from '@bedrock/https-agent';
import {keyResolver} from './keyResolver.js';
const require = createRequire(import.meta.url);
const assert = require('assert-plus');
const {EdvClient} = require('@digitalbazaar/edv-client');

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

  // ensure DID method is supported
  const SUPPORTED_DID_METHODS = ['key', 'v1'];
  if(!SUPPORTED_DID_METHODS.includes(didMethod)) {
    throw new Error(`Unsupported DID method "${didMethod}".`);
  }

  // ensure any additional EDV options are valid
  const {additionalEdvs = []} = edvOptions.profile;
  for(const [i, {referenceId}] of additionalEdvs.entries()) {
    // reserve `user` `referenceId`
    if(referenceId === 'user') {
      throw new Error('"user" reference ID is reserved.');
    }
    if(!(referenceId && typeof referenceId === 'string')) {
      throw new TypeError(
        `"additionalEdv[${i}].referenceId" must be a string.`);
    }
  }

  // require meter zcap invocation signer to match local application zcap
  // invocation signer
  const appInvocationSignerId = utils.ZCAP_CLIENT.invocationSigner.id;
  if(keystoreOptions.profile.meterCapabilityInvocationSigner.id !==
    appInvocationSignerId) {
    throw new Error(
      'Profile keystore meter invocation signer ' +
      `"${keystoreOptions.profile.meterCapabilityInvocationSigner.id}" ` +
      'must match local application ' +
      `zcap invocation signer "${appInvocationSignerId}".`);
  }
  if(edvOptions.profile.meterCapabilityInvocationSigner.id !==
    appInvocationSignerId) {
    throw new Error(
      'Profile EDV meter invocation signer ' +
      `"${edvOptions.profile.meterCapabilityInvocationSigner.id}" ` +
      'must match local application ' +
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

  /* 4. Update the profile keystore controller to be the profile. This
    step effectively invalidates TMP and must be done last right before
    the profile agent record is written to the database. If the process
    fails at this point (or at any point prior), then some unusable data may
    have been created on external systems (e.g., KMS and EDV systems), but
    it will be linked to the meter controller, which is the local application.
    Therefore, if necessary, this data can be periodically garbage collected by
    the local application or disassociated from the local application as it
    has authority over it via this meter binding. */
  keystore.controller = profileId;
  await kms.updateKeystoreConfig({keystoreAgent, keystoreConfig: keystore});

  /* 5. Write the profile agent record to the database, including the meters
    to track them temporarily. **Once this step completes, the provisioning
    process is recoverable / continuable if it should fail in any subsequent
    step.** */
  const {kmsMeter, edvMeter} = await _insertProfileAgentRecord({
    profileAgentRecord, profileId, edvOptions, keystoreOptions,
    profileCapabilityInvocationKeyZcap, profileAgentUserDocZcap, edvsZcaps
  });

  /* 6. Complete the profile provisioning process. This is implemented as a
  function in `profileAgents` to allow other processes that are fetching
  profile agents to complete incomplete provisioning. The steps required to
  complete the provisioning process are detailed in the function. */
  let {meters} = await profileAgents.completeProfileProvisioning(
    {profileAgentRecord});
  if(!meters) {
    // unusual case where profile provisioning completed in another process;
    // get meters
    meters = await Promise.all([
      profileMeters.get({id: kmsMeter.id}),
      profileMeters.get({id: edvMeter.id})
    ]);
  }

  /* 7. Return the profile ID, meters, and EDV configs. */
  const edvConfigs = {};
  for(const {referenceId, config} of Object.values(edvs)) {
    edvConfigs[referenceId] = config;
  }
  return {id: profileId, meters, edvs: edvConfigs};
}

async function _createEdv({referenceId, keystoreAgent, edvOptions, profileId}) {
  const edv = {referenceId};
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
    referenceId,
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
          {attribute: 'content.type'},
          {attribute: 'content.name'},
          {attribute: 'content.email'}
        ]
      },
      created: (new Date()).toISOString(),
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
      created: (new Date()).toISOString(),
      zcaps: {
        profileCapabilityInvocationKey: profileCapabilityInvocationKeyZcap,
        [ZCAP_REFERENCE_IDS.profileUserDoc]: profileUserDocZcap,
        [ZCAP_REFERENCE_IDS.profileAgentUserDoc]: profileAgentUserDocZcap
      }
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
  const allEdvs = [...additionalEdvs, {referenceId: 'user'}];
  await Promise.all(allEdvs.map(async ({referenceId}) => {
    edvs[referenceId] = await _createEdv(
      {referenceId, keystoreAgent, edvOptions, profileId});
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
    const {referenceId} = edv;
    const {zcaps} = await _delegateEdvZcaps(
      {key, keystore, edv, controller, ttl});
    allZcaps[referenceId] = zcaps;
  }));
  return allZcaps;
}

async function _delegateEdvZcaps({
  key, keystore, edv, controller, ttl = DEFAULT_PROFILE_AGENT_ZCAP_TTL
}) {
  const {id: edvId, referenceId, hmac, keyAgreementKey} = edv;
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
    [`${referenceId}-edv-documents`]: documentsZcap,
    [`${referenceId}-edv-hmac`]: hmacZcap,
    [`${referenceId}-edv-kak`]: kakZcap
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
    capability: `urn:zcap:root:${encodeURIComponent(profileKeystoreId)}`,
    controller,
    expires,
    invocationTarget: key.kmsId,
    signer: key
  });
}

async function _insertProfileAgentRecord({
  profileAgentRecord, profileId, edvOptions, keystoreOptions,
  profileCapabilityInvocationKeyZcap, profileAgentUserDocZcap, edvsZcaps
}) {
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
  profileAgentRecord.profileAgent.profile = profileId;
  profileAgentRecord.profileAgent.zcaps = {
    profileCapabilityInvocationKey: profileCapabilityInvocationKeyZcap,
    [ZCAP_REFERENCE_IDS.profileAgentUserDoc]: profileAgentUserDocZcap,
    [ZCAP_REFERENCE_IDS.userKak]: edvsZcaps.user[ZCAP_REFERENCE_IDS.userKak]
  };
  profileAgentRecord.profileAgent._meters = {edvMeter, kmsMeter};
  const record = await profileAgents.insert({record: profileAgentRecord});
  return {record, edvMeter, kmsMeter};
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
