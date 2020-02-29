/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const axios = require('axios');
const brHttpsAgent = require('bedrock-https-agent');

module.exports = keyResolver;

// FIXME: make more restrictive, support `did:key` and `did:v1`
// TODO: could be made more restrictive is based on a config option that
//       specifies where the KMS is.
async function keyResolver({id} = {}) {
  const headers = {Accept: 'application/ld+json, application/json'};
  const {httpsAgent} = brHttpsAgent;
  const response = await axios.get(id, {
    headers,
    httpsAgent
  });
  return response.data;
}
