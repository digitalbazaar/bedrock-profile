/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const {httpsAgent} = require('bedrock-https-agent');
const {
  AsymmetricKey,
  Hmac,
  Kek,
  KeystoreAgent,
  KeyAgreementKey,
  KmsClient
} = require('@digitalbazaar/webkms-client');
const {config, util: {clone, BedrockError}} = bedrock;

const cfg = config.profile;

exports.createKeystore = async ({
  capabilityAgent, referenceId, applyIpAllowList = true
} = {}) => {
  // create keystore
  const keystoreConfig = {
    sequence: 0,
    controller: capabilityAgent.id,
  };
  if(applyIpAllowList) {
    keystoreConfig.ipAllowList = cfg.kms.ipAllowList;
  }
  if(referenceId) {
    keystoreConfig.referenceId = referenceId;
  }
  return KmsClient.createKeystore({
    url: `${cfg.kms.baseUrl}/keystores`,
    config: keystoreConfig,
    httpsAgent
  });
};

exports.updateKeystoreConfig = async ({keystoreAgent, keystoreConfig}) => {
  keystoreConfig = clone(keystoreConfig);

  // update config sequence
  keystoreConfig.sequence++;

  let result;
  try {
    result = await keystoreAgent.updateConfig({config: keystoreConfig});
  } catch(err) {
    throw new BedrockError(
      'Failed to update keystore with new controller.',
      'InvalidStateError', {
        httpStatusCode: 400,
        public: true,
      }, err);
  }

  return result.config;
};

exports.getKeystore = async ({id} = {}) => {
  return KmsClient.getKeystore({id, httpsAgent});
};

exports.getKeystoreAgent = ({capabilityAgent, keystore} = {}) => {
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
  } else if(type === 'Ed25519VerificationKey2020') {
    type = 'Ed25519VerificationKey2020';
    Class = AsymmetricKey;
  } else if(type === 'keyAgreement' || type === 'X25519KeyAgreementKey2020') {
    type = 'X25519KeyAgreementKey2020';
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
