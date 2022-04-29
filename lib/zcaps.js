/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('assert-plus');
const {Ed25519Signature2018} =
  require('@digitalbazaar/ed25519-signature-2018');
const {Ed25519Signature2020} =
  require('@digitalbazaar/ed25519-signature-2020');
const {EdvClient} = require('@digitalbazaar/edv-client');
const {ZcapClient} = require('@digitalbazaar/ezcap');

export async function delegate({
  capability, controller, expires, invocationTarget, allowedActions,
  allowedAction, signer
}) {
  if(allowedAction) {
    throw new TypeError(
      '"allowedAction" not supported; pass "allowedActions" instead.');
  }
  if(!(capability &&
    (typeof capability === 'string' || typeof capability === 'object'))) {
    throw new TypeError('"capability" must be a string or object.');
  }
  assert.string(controller, 'controller');
  assert.object(signer, 'signer');

  let SuiteClass;
  if(signer.type === 'Ed25519VerificationKey2018') {
    SuiteClass = Ed25519Signature2018;
  } else if(signer.type === 'Ed25519VerificationKey2020') {
    SuiteClass = Ed25519Signature2020;
  }

  const zcapClient = new ZcapClient({SuiteClass, delegationSigner: signer});
  return zcapClient.delegate({
    allowedActions,
    capability,
    controller,
    expires,
    invocationTarget
  });
}

export async function id() {
  return `urn:zcap:${await EdvClient.generateId()}`;
}
