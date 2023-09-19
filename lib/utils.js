/*!
 * Copyright (c) 2020-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import * as profileAgents from './profileAgents.js';
import {
  AsymmetricKey, Hmac, KeyAgreementKey
} from '@digitalbazaar/webkms-client';
import assert from 'assert-plus';
import {CapabilityAgent} from '@digitalbazaar/webkms-client';
import {CryptoLD} from 'crypto-ld';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {
  Ed25519VerificationKey2018
} from '@digitalbazaar/ed25519-verification-key-2018';
import {
  Ed25519VerificationKey2020
} from '@digitalbazaar/ed25519-verification-key-2020';
import {EdvDocument} from '@digitalbazaar/edv-client';
import {getAppIdentity} from '@bedrock/app-identity';
import {httpsAgent} from '@bedrock/https-agent';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {ZcapClient} from '@digitalbazaar/ezcap';

export const randomBytesAsync = promisify(randomBytes);

const cryptoLd = new CryptoLD();
cryptoLd.use(Ed25519VerificationKey2018);
cryptoLd.use(Ed25519VerificationKey2020);

export let APP_ID;
export let ZCAP_CLIENT;

bedrock.events.on('bedrock.init', () => {
  // create signer using the application's capability invocation key
  const {id, keys: {capabilityInvocationKey}} = getAppIdentity();
  APP_ID = id;

  ZCAP_CLIENT = new ZcapClient({
    agent: httpsAgent,
    invocationSigner: capabilityInvocationKey.signer(),
    SuiteClass: Ed25519Signature2020
  });
});

export function assertKeystoreOptions(opts, name) {
  assert.object(opts, name);
  assert.string(opts.meterId, `${name}.meterId`);
  assert.object(
    opts.meterCapabilityInvocationSigner,
    `${name}.meterCapabilityInvocationSigner`);
  assert.optionalString(opts.kmsModule, `${name}.kmsModule`);
}

export function assertEdvOptions(opts, name) {
  assert.object(opts, name);
  assert.string(opts.baseUrl, `${name}.baseUrl`);
  assert.string(opts.meterId, `${name}.meterId`);
  assert.object(
    opts.meterCapabilityInvocationSigner,
    `${name}.meterCapabilityInvocationSigner`);
}

export async function createCapabilityAgent() {
  const secret = await randomBytesAsync(32);
  const handle = 'primary';
  const capabilityAgent = await CapabilityAgent.fromSecret({handle, secret});
  return {capabilityAgent, secret};
}

export function getCollection(collectionName) {
  return database.collections[collectionName];
}

/**
 * @param {object} options - The options to use.
 * @param {string} [options.didMethod='key'] - DID method to use for key id.
 * @param {object} [options.didOptions={}] - Optional did method options
 *   hashmap.
 *
 * @returns {Promise<string>} Resolves with generated key id.
 */
export function getPublicAliasTemplate({didMethod = 'key', didOptions = {}}) {
  if(didMethod === 'key') {
    return 'did:key:{publicKeyMultibase}#{publicKeyMultibase}';
  }
  if(didMethod === 'v1') {
    const prefix = (didOptions.mode === 'test') ? 'did:v1:test:' : 'did:v1:';
    return prefix + 'nym:{publicKeyMultibase}#{publicKeyMultibase}';
  }

  throw new Error(`DID Method not supported: "${didMethod}".`);
}

/**
 * Parses the WebKMS Keystore id from the id of a WebKMS Key.
 *
 * @param {string} keyId - An id of a WebKMS Key.
 *
 * @returns {string} Returns a WebKMS Keystore id.
 */
export function parseKeystoreId(keyId) {
  // key ID format: <baseUrl>/<keystores-path>/<keystore-id>/keys/<key-id>
  const idx = keyId.lastIndexOf('/keys/');
  if(idx === -1) {
    throw new Error(`Invalid key ID "${keyId}".`);
  }
  return keyId.slice(0, idx);
}

export async function getEdvConfig({edvClient, profileSigner} = {}) {
  return edvClient.getConfig({
    invocationSigner: profileSigner
  });
}

export async function getEdvDocument({
  docId, edvConfig, edvClient, kmsClient, profileSigner
} = {}) {
  const {hmac, keyAgreementKey} = edvConfig;

  const doc = new EdvDocument({
    invocationSigner: profileSigner,
    id: docId,
    keyAgreementKey: new KeyAgreementKey({
      id: keyAgreementKey.id,
      type: keyAgreementKey.type,
      invocationSigner: profileSigner,
      kmsClient
    }),
    hmac: new Hmac({
      id: hmac.id,
      type: hmac.type,
      invocationSigner: profileSigner,
      kmsClient
    }),
    client: edvClient
  });
  return doc.read();
}

export async function getProfileSigner({kmsClient, profileAgentRecord} = {}) {
  const profileCapabilityInvocationKeyZcap =
    profileAgentRecord.profileAgent.zcaps.profileCapabilityInvocationKey;
  const {capabilityAgent} = await profileAgents.getAgents({
    profileAgent: profileAgentRecord.profileAgent,
    secrets: profileAgentRecord.secrets
  });
  const profileAgentSigner = capabilityAgent.getSigner();
  const profileSigner = await AsymmetricKey.fromCapability({
    capability: profileCapabilityInvocationKeyZcap,
    invocationSigner: profileAgentSigner,
    kmsClient
  });
  return profileSigner;
}

export function removeSecretsFromRecords({records}) {
  return records.map(record => {
    // eslint-disable-next-line no-unused-vars
    const {secrets, ...rest} = record;
    return rest;
  });
}

export function parseEdvId({capability}) {
  const {invocationTarget} = capability;
  const idx = invocationTarget.lastIndexOf('/documents');
  if(idx === -1) {
    throw new Error(
      `Invalid EDV invocation target (${invocationTarget}).`);
  }
  return invocationTarget.slice(0, idx);
}

export async function retryOperation(operationFunction, onInvalidStateError) {
  const retry = true;
  while(retry) {
    try {
      const result = await operationFunction();
      return result;
    } catch(e) {
      const status = e?.status || e?.cause?.status;
      if(status === 409 || e.name == 'InvalidStateError') {
        const result = onInvalidStateError();
        return result;
      }
    }
  }
}

// timestamp is in milliseconds
export function timestampToDateString(timestamp) {
  return new Date(timestamp).toISOString().slice(0, -5) + 'Z';
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
