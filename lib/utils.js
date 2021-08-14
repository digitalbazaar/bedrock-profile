/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const database = require('bedrock-mongodb');
const {CryptoLD} = require('crypto-ld');
const v1 = require('did-veres-one');
const didKey = require('@digitalbazaar/did-method-key');
const {Ed25519VerificationKey2018} =
  require('@digitalbazaar/ed25519-verification-key-2018');
const {Ed25519VerificationKey2020} =
  require('@digitalbazaar/ed25519-verification-key-2020');

const cryptoLd = new CryptoLD();
cryptoLd.use(Ed25519VerificationKey2018);
cryptoLd.use(Ed25519VerificationKey2020);

exports.getCollection = collectionName => database.collections[collectionName];

/**
 * @typedef AsymmetricKey
 *
 * @param {object} options - The options to use.
 * @param {AsymmetricKey} options.key - WebKMS AsymmetricKey.
 * @param {string} [options.didMethod='key'] - DID method to use for key id.
 * @param {object} [options.didOptions={}] - Optional did method options
 *   hashmap.
 *
 * @returns {Promise<string>} Resolves with generated key id.
 */
exports.computeKeyId = async ({
  key, didMethod = 'key', didOptions = {}} = {}) => {
  // the keyDescription is required to get publicKeyBase58
  const keyDescription = await key.getKeyDescription();
  const publicKey = await cryptoLd.from(keyDescription);
  let driver;
  let keyId;

  if(didMethod === 'key') {
    driver = didKey.driver();
    keyId = await driver.computeId({keyPair: publicKey});
  } else if(didMethod === 'v1') {
    //  For v1 dids, mode is set to test or live.
    const mode = didOptions.mode || 'live';
    driver = v1.driver({mode});
    keyId = await driver.computeId({
      key: publicKey, didType: 'nym', mode
    });
  } else {
    throw new Error(`DID method not supported: '${didMethod}'`);
  }
  return keyId;
};

/**
 * @typedef {object} KeystoreOptions
 * @property {object} meterCapability - The meter capability to give to the
 *   KMS service when creating a keystore.
 * @property {object} meterCapabilityInvocationSigner - The invocation signer
 *   to use to create a keystore associated with the given meter capability.
 * @property {string} [options.kmsModule] - The KMS module to use to create
 *   a keystore.
 */

exports.assertKeystoreOptions = (opts, name) => {
  assert.object(opts, name);
  assert.object(opts.meterCapability, `${name}.meterCapability`);
  assert.object(
    opts.meterCapabilityInvocationSigner,
    `${name}.meterCapabilityInvocationSigner`);
  assert.optionalString(opts.kmsModule, `${name}.kmsModule`);
};
