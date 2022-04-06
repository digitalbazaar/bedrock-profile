/*!
 * Copyright (c) 2021-2022 Digital Bazaar, Inc. All rights reserved.
 */
import {agent} from '@bedrock/https-agent';
import {createRequire} from 'module';
const require = createRequire(import.meta.url);
const {Ed25519Signature2020} =
  require('@digitalbazaar/ed25519-signature-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

export async function get({url, invocationSigner}) {
  const zcapClient = new ZcapClient({
    agent,
    invocationSigner,
    SuiteClass: Ed25519Signature2020
  });

  const {data} = await zcapClient.read({url});

  return data;
}

export async function update({url, meter, invocationSigner}) {
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
}
