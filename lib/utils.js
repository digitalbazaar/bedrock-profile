/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const database = require('bedrock-mongodb');
const {LDKeyPair} = require('crypto-ld');
const v1 = require('did-veres-one');
const didKey = require('did-method-key');

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
  const publicKey = await LDKeyPair.from(keyDescription);
  let driver, keyId;

  if(didMethod === 'key') {
    driver = didKey.driver();
    keyId = await driver.computeKeyId({key: publicKey});
  } else if(didMethod === 'v1') {
    //  For v1 dids, mode is set to test or live.
    const mode = didOptions.mode || 'live';
    driver = v1.driver({mode});
    keyId = await driver.computeKeyId({
      key: publicKey, didType: 'nym', mode
    });
  } else {
    throw new Error(`DID method not supported: '${didMethod}'`);
  }
  return keyId;
};
