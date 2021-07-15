/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const documentLoader = require('./documentLoader');
const {CapabilityDelegation, constants: {ZCAP_CONTEXT_URL}} =
  require('@digitalbazaar/zcapld');
const {EdvClient} = require('edv-client');
const {Ed25519Signature2018} = require('@digitalbazaar/ed25519-signature-2018');
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {sign} = require('jsonld-signatures');

const SUPPORTED_KEY_TYPES = [
  'Ed25519VerificationKey2018',
  'Ed25519VerificationKey2020',
  'Sha256HmacKey2019',
  'X25519KeyAgreementKey2019',
  'X25519KeyAgreementKey2020'
];

exports.delegateCapability = async (
  {signer, keystoreAgent, edvClient, request} = {}) => {
  const {
    invocationTarget, invoker, delegator, controller, referenceId,
    allowedAction, caveat, expires
  } = request;
  if(!(invocationTarget && typeof invocationTarget === 'object' &&
    invocationTarget.type)) {
    throw new TypeError(
      '"invocationTarget" must be an object that includes a "type".');
  }
  // TODO: Look into requiring an invoker or controller on a zcap
  let contextUrl;
  if(signer.type === 'Ed25519VerificationKey2018') {
    contextUrl = [ZCAP_CONTEXT_URL, Ed25519Signature2018.CONTEXT_URL];
  } else if(signer.type === 'Ed25519VerificationKey2020') {
    contextUrl = [ZCAP_CONTEXT_URL, Ed25519Signature2020.CONTEXT_URL];
  }
  let zcap = {
    '@context': contextUrl,
    // use 128-bit random multibase encoded value
    id: await exports.id()
  };
  if(invoker) {
    zcap.invoker = invoker;
  }
  if(controller) {
    zcap.controller = controller;
  }
  if(delegator) {
    zcap.delegator = delegator;
  }
  if(referenceId) {
    zcap.referenceId = referenceId;
  }
  if(allowedAction) {
    zcap.allowedAction = allowedAction;
  }
  if(caveat) {
    zcap.caveat = caveat;
  }
  if(expires) {
    zcap.expires = expires;
  }
  let {parentCapability} = request;
  const {id: target, type: targetType, publicAlias} = invocationTarget;
  if(SUPPORTED_KEY_TYPES.includes(targetType)) {
    if(!target) {
      throw new TypeError(
        '"invocationTarget.id" must be set for Web KMS capabilities.');
    }
    if(!publicAlias) {
      throw new TypeError('"invocationTarget.publicAlias" is required.');
    }
    // TODO: fetch `target` from a key mapping document in the profile's
    // edv to get public key ID to set as `referenceId`
    zcap.invocationTarget = {
      id: target,
      type: targetType,
      publicAlias,
    };
    zcap.parentCapability = parentCapability || target;
    zcap = await exports.delegate({zcap, signer});

    return zcap;
  } else if(targetType === 'urn:edv:document') {
    zcap.invocationTarget = {
      id: target,
      type: targetType
    };

    if(target) {
      // TODO: handle case where an existing target is requested
    } else {
      // use 128-bit random multibase encoded value
      const docId = await EdvClient.generateId();
      zcap.invocationTarget.id = `${edvClient.id}/documents/${docId}`;
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
      if(invocationTarget.recipient) {
        recipients.push(invocationTarget.recipient);
      }
      const invocationSigner = signer;
      await edvClient.insert({doc, recipients, invocationSigner});
    }
    if(!parentCapability) {
      const idx = zcap.invocationTarget.id.lastIndexOf('/');
      const docId = zcap.invocationTarget.id.substr(idx + 1);
      parentCapability = `${edvClient.id}/zcaps/documents/${docId}`;
    }
    zcap.parentCapability = parentCapability;
    zcap = await exports.delegate({zcap, signer});

    return zcap;
  } else if(targetType === 'urn:edv:documents') {
    zcap.invocationTarget = {
      id: target,
      type: targetType
    };

    if(target) {
      // TODO: handle case where an existing target is requested
    } else {
      // TODO: note that only the recipient of the zcap will be able
      // to read the documents it writes -- as no recipient is specified
      // here ... could add this to the zcap as a special caveat that
      // requires the recipient always be present for every document written
      zcap.invocationTarget.id = `${edvClient.id}/documents`;
    }
    if(!parentCapability) {
      parentCapability = `${edvClient.id}/zcaps/documents`;
    }
    zcap.parentCapability = parentCapability;
    zcap = await exports.delegate({zcap, signer});

    return zcap;
  } else if(targetType === 'urn:edv:authorizations') {
    zcap.invocationTarget = {
      id: target,
      type: targetType
    };

    if(target) {
      // TODO: handle case where an existing target is requested
    } else {
      zcap.invocationTarget.id = `${edvClient.id}/authorizations`;
    }
    if(!parentCapability) {
      parentCapability = `${edvClient.id}/zcaps/authorizations`;
    }
    zcap.parentCapability = parentCapability;
    zcap = await exports.delegate({zcap, signer});

    return zcap;
  } else if(targetType === 'urn:webkms:authorizations') {
    zcap.invocationTarget = {
      id: target,
      type: targetType
    };
    const keystore = keystoreAgent.keystore.id;

    if(target) {
      // TODO: handle case where an existing target is requested
    } else {
      zcap.invocationTarget.id = `${keystore}/authorizations`;
    }
    if(!parentCapability) {
      parentCapability = `${keystore}/zcaps/authorizations`;
    }
    zcap.parentCapability = parentCapability;
    zcap = await exports.delegate({zcap, signer});

    return zcap;
  } else {
    throw new Error(`Unsupported invocation target type "${targetType}".`);
  }
};

exports.id = async () => `urn:zcap:${await EdvClient.generateId()}`;

exports.delegate = async ({zcap, signer, capabilityChain}) => {
  capabilityChain =
    Array.isArray(capabilityChain) ? capabilityChain : [zcap.parentCapability];
  let suite;
  if(signer.type === 'Ed25519VerificationKey2018') {
    suite = new Ed25519Signature2018({signer});
  } else if(signer.type === 'Ed25519VerificationKey2020') {
    suite = new Ed25519Signature2020({signer});
  }
  // attach capability delegation proof
  return sign(zcap, {
    suite,
    purpose: new CapabilityDelegation({
      capabilityChain
    }),
    documentLoader
  });
};
