/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const database = require('bedrock-mongodb');
const {Ed25519KeyPair} = require('crypto-ld');

// module API
const api = {};
module.exports = api;

api.getCollection = collectionName => database.collections[collectionName];

api.setKeyId = async ({key, method = 'key'} = {}) => {
  // the keyDescription is required to get publicKeyBase58
  const keyDescription = await key.getKeyDescription();
  const fingerprint = Ed25519KeyPair.fingerprintFromPublicKey(keyDescription);
  if(method === 'key') {
    key.id = `did:key:${fingerprint}#${fingerprint}`;
  } else if(method === 'v1') {
    // FIXME: Make DID V1 Identifier creation more robust.
    //        Support live/test/dev and possibly RSA Keys as well.
    throw new Error('"v1" DID creation not implemented.');
  }
}
;
