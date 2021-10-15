/*!
 * Copyright (c) 2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {agent} = require('bedrock-https-agent');
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

exports.get = async ({url, invocationSigner}) => {
  const zcapClient = new ZcapClient({
    agent,
    invocationSigner,
    SuiteClass: Ed25519Signature2020
  });

  const {data} = await zcapClient.read({url});

  return data;
};

exports.update = async ({url, meter, invocationSigner}) => {
  const zcapClient = new ZcapClient({
    agent,
    invocationSigner,
    SuiteClass: Ed25519Signature2020
  });

  if(!(Number.isInteger(meter.sequence) && meter.sequence >= 0)) {
    throw new Error(`"meter.sequence" not found.`);
  }

  ++meter.sequence;

  const {data} = await zcapClient.write({url, json: meter});

  return data;
};
