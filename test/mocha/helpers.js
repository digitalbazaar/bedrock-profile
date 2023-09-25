/*!
 * Copyright (c) 2020-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as brAccount from '@bedrock/account';
import * as database from '@bedrock/mongodb';
import {_deserializeUser, passport} from '@bedrock/passport';
import {EdvClient, EdvDocument} from '@digitalbazaar/edv-client';
import {Hmac, KeyAgreementKey} from '@digitalbazaar/webkms-client';
import {agent} from '@bedrock/https-agent';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {getAppIdentity} from '@bedrock/app-identity';
import {httpsAgent} from '@bedrock/https-agent';
import {keyResolver} from '@bedrock/profile/lib/keyResolver.js';
import {KmsClient} from '@digitalbazaar/webkms-client';
import {profileAgents} from '@bedrock/profile';
import {ZcapClient} from '@digitalbazaar/ezcap';

import {mockData} from './mock.data.js';

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

export async function getEdvConfig({edvClient, profileSigner} = {}) {
  return edvClient.getConfig({invocationSigner: profileSigner});
}

export async function getEdvDocument({
  docId, edvConfig, edvClient,
  kmsClient = new KmsClient({httpsAgent}),
  profileSigner
} = {}) {
  const {hmac, keyAgreementKey} = edvConfig;

  const doc = new EdvDocument({
    invocationSigner: profileSigner,
    id: docId,
    keyAgreementKey: new KeyAgreementKey({
      id: keyAgreementKey.id,
      type: keyAgreementKey.type,
      invocationSigner: profileSigner,
      kmsClient
    }),
    hmac: new Hmac({
      id: hmac.id,
      type: hmac.type,
      invocationSigner: profileSigner,
      kmsClient
    }),
    client: edvClient
  });
  return doc.read();
}

export async function getUserEdvDocument({
  profileAgentRecord, kmsClient = new KmsClient({httpsAgent})
} = {}) {
  const invocationSigner = await profileAgents.getSigner({profileAgentRecord});
  const {profileAgent: {zcaps}} = profileAgentRecord
  const {userDocument: capability} = zcaps;
  const edvClient = new EdvClient({capability, httpsAgent, keyResolver});
  const keyAgreementKey = await KeyAgreementKey.fromCapability(
    {capability: zcaps['user-edv-kak'], invocationSigner, kmsClient});
  const doc = new EdvDocument({
    capability,
    invocationSigner,
    keyAgreementKey,
    client: edvClient
  });
  return doc;
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

export function parseEdvId({capability}) {
  const {invocationTarget} = capability;
  const idx = invocationTarget.lastIndexOf('/documents');
  if(idx === -1) {
    throw new Error(`Invalid EDV invocation target (${invocationTarget}).`);
  }
  return invocationTarget.slice(0, idx);
}

export async function prepareDatabase(mockData) {
  await removeCollections();
  await insertTestData(mockData);
}

export async function removeCollections(
  collectionNames = [
    'account',
    'account-email',
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

// timestamp is in milliseconds
export function timestampToDateString(timestamp) {
  return new Date(timestamp).toISOString().slice(0, -5) + 'Z';
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
