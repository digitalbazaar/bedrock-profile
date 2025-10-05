/*!
 * Copyright (c) 2020-2025 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {ZcapClient} from '@digitalbazaar/ezcap';

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

  // only supported `SuiteClass` at this time
  const SuiteClass = Ed25519Signature2020;

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
  if(capability.proof.capabilityChain.length !== 1) {
    throw new TypeError(
      'Only capabilities with a chain length of one can be refreshed.');
  }
  return delegate({
    allowedActions: capability.allowedAction,
    capability: capability.proof.capabilityChain[0],
    controller: capability.controller,
    expires,
    invocationTarget: capability.invocationTarget,
    signer
  });
}
