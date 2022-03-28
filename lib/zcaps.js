/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import {EdvClient} from '@digitalbazaar/edv-client';
import {Ed25519Signature2018} from '@digitalbazaar/ed25519-signature-2018';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {ZcapClient} from '@digitalbazaar/ezcap';

const SUPPORTED_KEY_TYPES = [
  'Ed25519VerificationKey2018',
  'Ed25519VerificationKey2020',
  'Sha256HmacKey2019',
  'X25519KeyAgreementKey2019',
  'X25519KeyAgreementKey2020'
];

export async function delegateCapability({signer, edvClient, request} = {}) {
  const {controller, expires, parentCapability, type} = request;
  let {invocationTarget} = request;

  const targetType = type;

  if(SUPPORTED_KEY_TYPES.includes(targetType)) {
    if(!invocationTarget) {
      throw new TypeError(
        '"invocationTarget" must be set for Web KMS capabilities.');
    }
    // TODO: fetch `target` from a key mapping document in the profile's
    // edv to get public key ID to set as `referenceId`
  } else if(targetType === 'urn:edv:document') {
    if(invocationTarget) {
      // TODO: handle case where an existing target is requested
    } else {
      // use 128-bit random multibase encoded value
      const docId = await EdvClient.generateId();
      invocationTarget = `${edvClient.id}/documents/${docId}`;
      // insert empty doc to establish self as a recipient
      const doc = {
        id: docId,
        content: {}
      };
      // TODO: this is not clean; `edvClient` may not have direct
      // access to `keyAgreementKey` for the EDV, but just a zcap
      // to use it
      const recipients = [{
        header: {
          kid: edvClient.keyAgreementKey.id,
          alg: 'ECDH-ES+A256KW'
        }
      }];

      const invocationSigner = signer;
      await edvClient.insert({doc, recipients, invocationSigner});
    }
  } else if(targetType === 'urn:edv:documents') {
    if(invocationTarget) {
      // TODO: handle case where an existing target is requested
    } else {
      // TODO: note that only the recipient of the zcap will be able
      // to read the documents it writes -- as no recipient is specified
      // here ... could add this to the zcap as a special caveat that
      // requires the recipient always be present for every document written
      invocationTarget = `${edvClient.id}/documents`;
    }
  } else {
    throw new Error(`Unsupported invocation target type "${targetType}".`);
  }

  return delegate({
    capability: parentCapability, controller, expires, invocationTarget, signer
  });
}

export async function id() {
  return `urn:zcap:${await EdvClient.generateId()}`;
}

export async function delegate({
  capability, controller, expires, invocationTarget, signer}) {
  assert.string(controller, 'controller');

  let SuiteClass;
  if(signer.type === 'Ed25519VerificationKey2018') {
    SuiteClass = Ed25519Signature2018;
  } else if(signer.type === 'Ed25519VerificationKey2020') {
    SuiteClass = Ed25519Signature2020;
  }

  const zcapClient = new ZcapClient({SuiteClass, delegationSigner: signer});
  return zcapClient.delegate({
    capability,
    controller,
    expires,
    invocationTarget,
  });
}
