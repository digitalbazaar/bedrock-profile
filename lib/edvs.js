/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brHttpsAgent = require('bedrock-https-agent');
const {EdvClient} = require('edv-client');
const keyResolver = require('./keyResolver');
const kms = require('./kms');

// load config defaults
require('./config');
const KMS_MODULE = 'ssm-v1';

/**
 * Creates an EdvClient
 *
 *
 * @return {Promise<EdvClient>} resolves to a EdvClient.
 */
exports.create = async (
  {invocationSigner, kmsClient, referenceId, profileId} = {}) => {
  const edvBaseUrl = `${bedrock.config.server.baseUri}/edvs`;
  const [keyAgreementKey, hmac] = await Promise.all([
    kms.generateKey({
      invocationSigner,
      type: 'keyAgreement',
      kmsClient,
      kmsModule: KMS_MODULE
    }),
    kms.generateKey({
      invocationSigner,
      type: 'hmac',
      kmsClient,
      kmsModule: KMS_MODULE
    })
  ]);
  // create edv
  let config = {
    sequence: 0,
    controller: profileId,
    keyAgreementKey: {id: keyAgreementKey.id, type: keyAgreementKey.type},
    hmac: {id: hmac.id, type: hmac.type}
  };
  if(referenceId) {
    config.referenceId = referenceId;
  }
  const {httpsAgent} = brHttpsAgent;
  const capability = `${edvBaseUrl}/zcaps/configs`;
  // TODO: Update to use the bedrock-edv-storage NodeJS API
  config = await EdvClient.createEdv(
    {url: edvBaseUrl, config, httpsAgent, invocationSigner, capability});
  return new EdvClient(
    {id: config.id, keyResolver, keyAgreementKey, hmac, httpsAgent});
};

exports.get = async ({keystoreAgent, capabilities, referenceId, profileId}) => {
  const edvBaseUrl = `${bedrock.config.server.baseUri}/edvs`;
  const {httpsAgent} = brHttpsAgent;
  const config = await EdvClient.findConfig({
    url: edvBaseUrl,
    controller: profileId,
    referenceId,
    httpsAgent
  });
  if(config === null) {
    throw new Error(
      `Unable to find edv config with reference id: "${referenceId}"`);
  }
  const [keyAgreementKey, hmac] = await Promise.all([
    keystoreAgent.getKeyAgreementKey({
      id: config.keyAgreementKey.id,
      type: config.keyAgreementKey.type,
      capability: capabilities.kak
    }),
    keystoreAgent.getHmac({
      id: config.hmac.id,
      type: config.hmac.type,
      capability: capabilities.hmac
    })
  ]);
  return new EdvClient(
    {id: config.id, keyResolver, keyAgreementKey, hmac, httpsAgent});
};

exports.getReferenceId = name => {
  return `${encodeURIComponent(bedrock.config.server.domain)}:${name}`;
};
