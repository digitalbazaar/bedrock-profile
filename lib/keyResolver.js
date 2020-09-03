/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const axios = require('axios');
const brHttpsAgent = require('bedrock-https-agent');
const assert = require('assert-plus');
const {didMethods} = require('./config');

module.exports = keyResolver;

async function keyResolver({id, didMethod} = {}) {
  assert.string(id, 'id');
  assert.string(didMethod, 'didMethod');
  console.log('keyResolver is being called');
  if(!didMethods.includes(didMethod)) {
    throw new Error(`Unsupported DID method "${didMethod}".`);
  }
  const headers = {Accept: 'application/ld+json, application/json'};
  const {httpsAgent} = brHttpsAgent;
  const response = await axios.get(id, {
    headers,
    httpsAgent
  });
  return response.data;
}
