/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import {getAppIdentity} from '@bedrock/app-identity';
import {createRequire} from 'module';
import {httpsAgent} from '@bedrock/https-agent';
import {promisify} from 'util';
import {randomBytes} from 'crypto';
const require = createRequire(import.meta.url);
const assert = require('assert-plus');
const {CapabilityAgent} = require('@digitalbazaar/webkms-client');
const {CryptoLD} = require('crypto-ld');
const {Ed25519Signature2020} =
  require('@digitalbazaar/ed25519-signature-2020');
const {Ed25519VerificationKey2018} =
  require('@digitalbazaar/ed25519-verification-key-2018');
const {Ed25519VerificationKey2020} =
  require('@digitalbazaar/ed25519-verification-key-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

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

/**
 * @typedef {object} KeystoreOptions
 * @property {object} meterId - The full URL ID of the meter; to be given to
 *   the KMS service when creating a keystore.
 * @property {object} meterCapabilityInvocationSigner - The invocation signer
 *   to use to create a keystore associated with the given meter capability.
 * @property {string} [options.kmsModule] - The KMS module to use to create
 *   a keystore.
 */

export function assertKeystoreOptions(opts, name) {
  assert.object(opts, name);
  assert.string(opts.meterId, `${name}.meterId`);
  assert.object(
    opts.meterCapabilityInvocationSigner,
    `${name}.meterCapabilityInvocationSigner`);
  assert.optionalString(opts.kmsModule, `${name}.kmsModule`);
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
