/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const {keystores} = require('bedrock-kms');
const brHttpsAgent = require('bedrock-https-agent');
const {
  AsymmetricKey,
  Hmac,
  Kek,
  KeystoreAgent,
  KeyAgreementKey,
  KmsClient
} = require('webkms-client');
const {util: {BedrockError}} = bedrock;

// load config defaults
require('./config');

exports.createKeystore = async ({capabilityAgent, referenceId} = {}) => {
  const kmsBaseUrl = `${bedrock.config.server.baseUri}/kms`;
  // create keystore
  const config = {
    sequence: 0,
    controller: capabilityAgent.id,
    // TODO: prefer using just controller when the invoker and delegator will be
    //       the same
    invoker: capabilityAgent.id,
    delegator: capabilityAgent.id
  };
  if(referenceId) {
    config.referenceId = referenceId;
  }
  const {httpsAgent} = brHttpsAgent;
  return KmsClient.createKeystore({
    url: `${kmsBaseUrl}/keystores`,
    config,
    httpsAgent
  });
};

// FIXME: this only works with an integrated KMS right now and that needs to be
//        fixed in the future
exports.updateKeystoreController = async ({id, controller} = {}) => {
  const {httpsAgent} = brHttpsAgent;
  const config = await KmsClient.getKeystore({id, httpsAgent});

  const {invoker} = config;
  if(!Array.isArray(invoker)) {
    config.invoker = [invoker];
  }

  // update config
  config.sequence++;
  const {controller: oldController} = config;
  config.controller = controller;
  // replace existing controller with new one
  config.invoker = config.invoker.map(
    x => x === oldController ? controller : x);
  if(Array.isArray(config.delegator)) {
    config.delegator = config.delegator.map(
      x => x === oldController ? controller : x);
  } else if(config.delegator === oldController) {
    config.delegator = controller;
  }
  const updated = await keystores.update({config});
  if(!updated) {
    throw new BedrockError(
      'Failed to update keystore with new controller.',
      'InvalidStateError');
  }
  return config;
};

exports.getKeystore = async ({id} = {}) => {
  const {httpsAgent} = brHttpsAgent;
  return KmsClient.getKeystore({id, httpsAgent});
};

exports.getKeystoreAgent = ({capabilityAgent, keystore} = {}) => {
  const {httpsAgent} = brHttpsAgent;
  const kmsClient = new KmsClient({keystore, httpsAgent});
  const keystoreAgent = new KeystoreAgent(
    {keystore, capabilityAgent, kmsClient});
  return keystoreAgent;
};

exports.generateKey = async (
  {type, invocationSigner, kmsClient, kmsModule} = {}) => {
  let Class;
  if(type === 'hmac' || type === 'Sha256HmacKey2019') {
    type = 'Sha256HmacKey2019';
    Class = Hmac;
  } else if(type === 'kek' || type === 'AesKeyWrappingKey2019') {
    type = 'AesKeyWrappingKey2019';
    Class = Kek;
  } else if(type === 'Ed25519VerificationKey2018') {
    type = 'Ed25519VerificationKey2018';
    Class = AsymmetricKey;
  } else if(type === 'keyAgreement' || type === 'X25519KeyAgreementKey2019') {
    type = 'X25519KeyAgreementKey2019';
    Class = KeyAgreementKey;
  } else {
    throw new Error(`Unknown key type "${type}".`);
  }

  const keyDescription = await kmsClient.generateKey(
    {kmsModule, type, invocationSigner});
  const {id: newId} = keyDescription;
  return new Class(
    {id: newId, type, invocationSigner, kmsClient, keyDescription});
};
