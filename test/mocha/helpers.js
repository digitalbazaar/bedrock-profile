/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as brAccount from '@bedrock/account';
import * as brPassport from '@bedrock/passport';
import * as database from '@bedrock/mongodb';
import {agent} from '@bedrock/https-agent';
import {createRequire} from 'module';
import {getAppIdentity} from '@bedrock/app-identity';
import {mockData} from './mock.data.js';
import sinon from 'sinon';
const require = createRequire(import.meta.url);
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

export async function createMeter({capabilityAgent, type}) {
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
}

export function stubPassport({email = 'alpha@example.com'} = {}) {
  const passportStub = sinon.stub(brPassport, 'optionallyAuthenticated');
  passportStub.callsFake((req, res, next) => {
    req.user = {
      account: mockData.accounts[email].account
    };
    next();
  });
  return passportStub;
}

export async function prepareDatabase(mockData) {
  await removeCollections();
  await insertTestData(mockData);
}

export async function removeCollections(
  collectionNames = [
    'account',
    'profile-profileAgent'
  ]) {
  await database.openCollections(collectionNames);
  for(const collectionName of collectionNames) {
    await database.collections[collectionName].deleteMany({});
  }
}

export async function removeCollection(collectionName) {
  return removeCollections([collectionName]);
}

async function insertTestData(mockData) {
  const records = Object.values(mockData.accounts);
  for(const record of records) {
    try {
      await brAccount.insert(
        {account: record.account, meta: record.meta || {}});
    } catch(e) {
      if(e.name === 'DuplicateError') {
        // duplicate error means test data is already loaded
        continue;
      }
      throw e;
    }
  }
}
