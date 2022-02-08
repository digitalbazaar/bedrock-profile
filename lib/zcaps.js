/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const assert = require('assert-plus');
const {EdvClient} = require('@digitalbazaar/edv-client');
const {Ed25519Signature2018} = require('@digitalbazaar/ed25519-signature-2018');
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

const SUPPORTED_KEY_TYPES = [
  'Ed25519VerificationKey2018',
  'Ed25519VerificationKey2020',
  'Sha256HmacKey2019',
  'X25519KeyAgreementKey2019',
  'X25519KeyAgreementKey2020'
];

exports.delegateCapability = async ({signer, edvClient, request} = {}) => {
  const {controller, parentCapability, type} = request;
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
      // TODO: this is not clean; zcap query needs work! ... another
      // option is to get a `keyAgreement` verification method from
      // the controller of the `invoker`
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

  return exports.delegate({
    capability: parentCapability, controller, invocationTarget, signer
  });
};

exports.id = async () => `urn:zcap:${await EdvClient.generateId()}`;

exports.delegate = async ({
  capability, controller, invocationTarget, signer}) => {
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
    invocationTarget,
  });
};
