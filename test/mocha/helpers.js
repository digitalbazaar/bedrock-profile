/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import {agent} from '@bedrock/https-agent';
import {createRequire} from 'node:module';
import {getAppIdentity} from '@bedrock/app-identity';
import {mockData} from './mock.data.js';
import {passport, _deserializeUser} from '@bedrock/passport';
const require = createRequire(import.meta.url);
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

export async function createMeter({type}) {
  if(!(type && typeof type === 'string')) {
    throw new TypeError('`"type" must be a string.');
  }
  const {id: controller, keys} = getAppIdentity();
  const invocationSigner = keys.capabilityInvocationKey.signer();
  const zcapClient = new ZcapClient({
    agent,
    invocationSigner,
    SuiteClass: Ed25519Signature2020
  });

  const productId = mockData.productIdMap.get(type);
  let meter = {
    controller,
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
  const original = passport.authenticate;
  passport._original = original;

  passport.authenticate = (strategyName, options, callback) => {
    // if no email given, call original `passport.authenticate`
    if(!email) {
      return passport._original.call(
        passport, strategyName, options, callback);
    }

    // eslint-disable-next-line no-unused-vars
    return async function(req, res, next) {
      req._sessionManager = passport._sm;
      req.isAuthenticated = req.isAuthenticated || (() => !!req.user);
      req.login = (user, callback) => {
        req._sessionManager.logIn(req, user, function(err) {
          if(err) {
            req.user = null;
            return callback(err);
          }
          callback();
        });
      };
      let user = false;
      try {
        const {accounts} = mockData;
        const {account} = accounts[email] || {account: {id: 'does-not-exist'}};
        user = await _deserializeUser({
          accountId: account.id
        });
      } catch(e) {
        return callback(e);
      }
      callback(null, user);
    };
  };

  return {
    restore() {
      passport.authenticate = passport._original;
    }
  };
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
