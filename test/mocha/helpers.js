/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brAccount = require('bedrock-account');
const {getAppIdentity} = require('bedrock-app-identity');
const brPassport = require('bedrock-passport');
const database = require('bedrock-mongodb');
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {agent} = require('bedrock-https-agent');
const sinon = require('sinon');
const {ZcapClient} = require('@digitalbazaar/ezcap');
const mockData = require('./mock.data');

exports.createMeter = async ({capabilityAgent, type}) => {
  if(!(type && capabilityAgent)) {
    throw new Error(`"capabilityAgent" and "type" must be provided.`);
  }
  const {keys} = getAppIdentity();
  const invocationSigner = keys.capabilityInvocationKey.signer();
  const zcapClient = new ZcapClient({
    agent,
    invocationSigner,
    SuiteClass: Ed25519Signature2020
  });

  const productId = mockData.productIdMap.get(type);
  let meter = {
    controller: capabilityAgent.id,
    product: {
      id: productId
    }
  };

  // create a meter
  const meterService = `${bedrock.config.server.baseUri}/meters`;
  ({data: {meter}} = await zcapClient.write({url: meterService, json: meter}));

  // return usage capability
  const {id} = meter;
  return {id: `${meterService}/${id}`};
};

exports.stubPassport = async ({email = 'alpha@example.com'} = {}) => {
  const actors = await exports.getActors(mockData);
  const passportStub = sinon.stub(brPassport, 'optionallyAuthenticated');
  passportStub.callsFake((req, res, next) => {
    req.user = {
      account: mockData.accounts[email].account,
      actor: actors[email],
    };
    next();
  });
  return passportStub;
};

exports.getActors = async mockData => {
  const actors = {};
  for(const [key, record] of Object.entries(mockData.accounts)) {
    actors[key] = await brAccount.getCapabilities({id: record.account.id});
  }
  return actors;
};

exports.prepareDatabase = async mockData => {
  await exports.removeCollections();
  await insertTestData(mockData);
};

exports.removeCollections = async (
  collectionNames = [
    'account',
    'edvConfig',
    'edvDoc',
    'edvDocChunk',
    'profile-profileAgent',
    'profile-profileAgentCapabilitySet'
  ]) => {
  await database.openCollections(collectionNames);
  for(const collectionName of collectionNames) {
    await database.collections[collectionName].deleteMany({});
  }
};

exports.removeCollection =
  async collectionName => exports.removeCollections([collectionName]);

async function insertTestData(mockData) {
  const records = Object.values(mockData.accounts);
  for(const record of records) {
    try {
      await brAccount.insert(
        {actor: null, account: record.account, meta: record.meta || {}});
    } catch(e) {
      if(e.name === 'DuplicateError') {
        // duplicate error means test data is already loaded
        continue;
      }
      throw e;
    }
  }
}
