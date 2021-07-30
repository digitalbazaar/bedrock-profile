/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brAccount = require('bedrock-account');
const brPassport = require('bedrock-passport');
const database = require('bedrock-mongodb');
const {httpClient} = require('@digitalbazaar/http-client');
const {httpsAgent} = require('bedrock-https-agent');
const sinon = require('sinon');
const mockData = require('./mock.data');

exports.createMeter = async ({capabilityAgent} = {}) => {
  // create a meter
  const meterService = `${bedrock.config.server.baseUri}/meters`;
  let meter = {
    controller: capabilityAgent.id,
    product: {
      // mock ID for webkms service product
      id: 'urn:uuid:80a82316-e8c2-11eb-9570-10bf48838a41'
    }
  };
  const response = await httpClient.post(meterService, {
    agent: httpsAgent, json: meter
  });
  ({data: {meter}} = response);

  // return usage capability
  const {usageCapability: meterCapability} = meter;
  return {meterCapability};
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
