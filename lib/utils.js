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
 * @param {AsymmetricKey} key - WebKMS AsymmetricKey.
 * @param {string} [didMethod='key'] - DID method to use for key id.
 * @param {object} [didOptions={}] - Optional did method options hashmap.
 * @param {string} [didOptions.mode='live'] - For v1 dids, test or live.
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
