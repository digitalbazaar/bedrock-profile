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
 * @param {string} [didMethod] - DID method to use for key id.
 * @param {string} [didMethodMode] - Relevant for v1 type dids, testnet or live.
 * @returns {Promise}
 */
exports.setKeyId = async ({key, didMethod, didMethodMode} = {}) => {
  // the keyDescription is required to get publicKeyBase58
  const keyDescription = await key.getKeyDescription();
  const publicKey = await LDKeyPair.from(keyDescription);
  let driver;

  if(didMethod === 'key') {
    driver = didKey.driver();
    key.id = driver.setKeyId({key: publicKey});
  } else if(didMethod === 'v1') {
    driver = v1.driver({mode: didMethodMode});
    key.id = driver.setKeyId({
      key: publicKey, didType: 'nym', mode: didMethodMode
    });
  } else {
    throw new Error(`DID method not supported: '${didMethod}'`);
  }
};
