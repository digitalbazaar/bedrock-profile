/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {createRequire} from 'module';
import {httpsAgent} from '@bedrock/https-agent';
const require = createRequire(import.meta.url);
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

export async function createKeystore({
  controller, kmsModule, meterId, meterCapabilityInvocationSigner,
  referenceId, applyIpAllowList = true
} = {}) {
  // use default KMS module if not provided
  if(!kmsModule) {
    kmsModule = bedrock.config.profile.kms.defaultKmsModule;
  }

  // create keystore
  const keystoreConfig = {
    sequence: 0,
    controller,
    kmsModule,
    meterId
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
    invocationSigner: meterCapabilityInvocationSigner,
    httpsAgent
  });
}

export async function updateKeystoreConfig({keystoreAgent, keystoreConfig}) {
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
}

export function getKeystoreAgent({capabilityAgent, keystoreId} = {}) {
  const kmsClient = new KmsClient({keystoreId, httpsAgent});
  const keystoreAgent = new KeystoreAgent(
    {keystoreId, capabilityAgent, kmsClient});
  return keystoreAgent;
}

export async function generateKey({type, invocationSigner, kmsClient} = {}) {
  let Class;
  let suiteContextUrl;
  if(type === 'hmac' || type === 'Sha256HmacKey2019') {
    type = 'Sha256HmacKey2019';
    suiteContextUrl = 'https://w3id.org/security/suites/hmac-2019/v1';
    Class = Hmac;
  } else if(type === 'kek' || type === 'AesKeyWrappingKey2019') {
    type = 'AesKeyWrappingKey2019';
    suiteContextUrl = 'https://w3id.org/security/suites/aes-2019/v1';
    Class = Kek;
  } else if(type === 'Ed25519VerificationKey2020') {
    type = 'Ed25519VerificationKey2020';
    suiteContextUrl = 'https://w3id.org/security/suites/ed25519-2020/v1';
    Class = AsymmetricKey;
  } else if(type === 'keyAgreement' || type === 'X25519KeyAgreementKey2020') {
    type = 'X25519KeyAgreementKey2020';
    suiteContextUrl = 'https://w3id.org/security/suites/x25519-2020/v1';
    Class = KeyAgreementKey;
  } else {
    throw new Error(`Unknown key type "${type}".`);
  }

  const keyDescription = await kmsClient.generateKey(
    {type, suiteContextUrl, invocationSigner});
  const {id} = keyDescription;
  return new Class({id, type, invocationSigner, kmsClient, keyDescription});
}
