/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const base58 = require('bs58');
const brEdvStorage = require('bedrock-edv-storage');
const crypto = require('crypto');
const brHttpsAgent = require('bedrock-https-agent');
const {EdvClient} = require('edv-client');
const {promisify} = require('util');
const getRandomBytes = promisify(crypto.randomBytes);
const keyResolver = require('./keyResolver');
const kms = require('./kms');
const {util: {BedrockError}} = bedrock;

const KMS_MODULE = 'ssm-v1';

/**
 * Creates a new EDV and returns an EdvClient for it.
 *
 * @return {Promise<EdvClient>} resolves to a EdvClient.
 */
exports.create = async (
  {actor, invocationSigner, kmsClient, referenceId, profileId} = {}) => {
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
  // TODO: Update to use the bedrock-edv-storage NodeJS API when the EDV service
  //       is local, otherwise default to use the EDV Client
  if(actor || actor === null) {
    const id = _getEdvId(await _generateRandom());
    ({config} = await brEdvStorage.insertConfig(
      {actor, config: {id, ...config}}));
  } else {
    config = await EdvClient.createEdv(
      {url: edvBaseUrl, config, httpsAgent, invocationSigner, capability});
  }
  return new EdvClient(
    {id: config.id, keyResolver, keyAgreementKey, hmac, httpsAgent});
};

exports.get = async (
  {actor, keystoreAgent, capabilities, referenceId, profileId} = {}) => {
  // TODO: May need to update this in the near future to support non-local EDVs
  const edvBaseUrl = `${bedrock.config.server.baseUri}/edvs`;
  const {httpsAgent} = brHttpsAgent;
  let config;
  if(actor || actor === null) {
    const query = {'config.referenceId': referenceId};
    const results = await brEdvStorage.findConfig(
      {actor, controller: profileId, query, fields: {_id: 0, config: 1}});
    [config] = results.map(r => r.config);
  } else {
    config = await EdvClient.findConfig({
      url: edvBaseUrl,
      controller: profileId,
      referenceId,
      httpsAgent
    });
  }
  if(config === null) {
    throw new BedrockError(
      `Unable to find edv config with reference id: "${referenceId}".`,
      'NotFoundError');
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
  return `${encodeURIComponent(bedrock.config.server.domain)}:` +
    `${encodeURIComponent(name)}`;
};

function _getEdvId(edvIdParam) {
  _assert128BitId(edvIdParam);
  const {baseUri} = bedrock.config.server;
  return `${baseUri}/edvs/${edvIdParam}`;
}

async function _generateRandom() {
  // 128-bit random number, multibase encoded
  // 0x00 = identity tag, 0x10 = length (16 bytes)
  const buf = Buffer.concat([
    Buffer.from([0x00, 0x10]),
    await getRandomBytes(16)
  ]);
  // multibase encoding for base58 starts with 'z'
  return 'z' + base58.encode(buf);
}

function _assert128BitId(id) {
  try {
    // verify ID is multibase base58-encoded 16 bytes
    const buf = base58.decode(id.substr(1));
    // multibase base58 (starts with 'z')
    // 128-bit random number, multibase encoded
    // 0x00 = identity tag, 0x10 = length (16 bytes) + 16 random bytes
    if(!(id.startsWith('z') &&
      buf.length === 18 && buf[0] === 0x00 && buf[1] === 0x10)) {
      throw new Error('Invalid identifier.');
    }
  } catch(e) {
    throw new BedrockError(
      `Identifier "${id}" must be multibase, base58-encoded ` +
      'array of 16 random bytes.',
      'SyntaxError',
      {public: true, httpStatusCode: 400});
  }
}
