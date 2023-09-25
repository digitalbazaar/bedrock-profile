/*!
 * Copyright (c) 2020-2023 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import {Ed25519Signature2018} from '@digitalbazaar/ed25519-signature-2018';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {EdvClient} from '@digitalbazaar/edv-client';
import {ZcapClient} from '@digitalbazaar/ezcap';

export async function id() {
  return `urn:zcap:${await EdvClient.generateId()}`;
}

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

export async function refresh({capability, expires, signer}) {
  return delegate({
    allowedActions: capability.allowedAction,
    capability: capability.proof.capabilityChain[0],
    controller: capability.controller,
    expires,
    invocationTarget: capability.invocationTarget,
    signer
  });
}
