/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
/* jshint node: true */

'use strict';

const {util: {uuid}} = require('bedrock');
const {constants: {ZCAP_CONTEXT_URL}} = require('@digitalbazaar/zcapld');

const data = {};
module.exports = data;

// mock product IDs and reverse lookup for webkms/edv/etc service products
data.productIdMap = new Map([
  // webkms service
  ['webkms', 'urn:uuid:80a82316-e8c2-11eb-9570-10bf48838a41'],
  ['urn:uuid:80a82316-e8c2-11eb-9570-10bf48838a41', 'webkms'],
  // edv service
  ['edv', 'urn:uuid:dbd15f08-ff67-11eb-893b-10bf48838a41'],
  ['urn:uuid:dbd15f08-ff67-11eb-893b-10bf48838a41', 'edv']
]);

const accounts = data.accounts = {};
const zcaps = data.zcaps = [];

// regular permissions
const email = 'alpha@example.com';
accounts[email] = {};
accounts[email].account = createAccount(email);
accounts[email].meta = {};
accounts[email].meta.sysResourceRole = [{
  sysRole: 'bedrock-test.regular',
  generateResource: 'id'
}];

function createAccount(email) {
  const newAccount = {
    id: 'urn:uuid:' + uuid(),
    email
  };
  return newAccount;
}

const zcap0 = {
  '@context': ZCAP_CONTEXT_URL,
  id: 'urn:zcap:z19vWhR8EsNbWqvazp5bg6BTu',
  controller: 'did:key:z6Mkkt1BWYLPAAXwYBwyVHAZkL94tgT8QbQv2SUxeW1U3DaG',
  // eslint-disable-next-line max-len
  referenceId: 'did:key:z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg#z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg-key-capabilityInvocation',
  allowedAction: 'sign',
  invocationTarget: {
    // eslint-disable-next-line max-len
    id: 'https://bedrock.localhost:18443/kms/keystores/z1AAWWM7Zd4YyyV3NfaCqFuzQ/keys/z19wxodgv1UhrToQMvSxGhQG6',
    type: 'Ed25519VerificationKey2020',
    // eslint-disable-next-line max-len
    publicAlias: 'did:key:z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg#z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg'
  },
  // eslint-disable-next-line max-len
  parentCapability: 'https://bedrock.localhost:18443/kms/keystores/z1AAWWM7Zd4YyyV3NfaCqFuzQ/keys/z19wxodgv1UhrToQMvSxGhQG6',
  proof: {
    type: 'Ed25519Signature2020',
    created: '2020-02-27T21:22:48Z',
    // eslint-disable-next-line max-len
    verificationMethod: 'did:key:z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg#z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg',
    proofPurpose: 'capabilityDelegation',
    capabilityChain: [
      // eslint-disable-next-line max-len
      'https://bedrock.localhost:18443/kms/keystores/z1AAWWM7Zd4YyyV3NfaCqFuzQ/keys/z19wxodgv1UhrToQMvSxGhQG6'
    ],
    // a valid signature is not required for the test
    proofValue: 'zMOCK_PROOF'
  }
};

const zcap1 = {
  '@context': ZCAP_CONTEXT_URL,
  id: 'urn:zcap:z1ACgNxti98PXBjtw7ogfsN45',
  controller: 'did:key:z6Mkkt1BWYLPAAXwYBwyVHAZkL94tgT8QbQv2SUxeW1U3DaG',
  referenceId: 'bedrock.localhost:users',
  allowedAction: [
    'read',
    'write'
  ],
  invocationTarget: {
    id: 'https://bedrock.localhost:18443/edvs/z1A9uTYSmCU3DYQr7jhruhCuK',
    type: 'urn:edv:documents'
  },
  // eslint-disable-next-line max-len
  parentCapability: 'https://bedrock.localhost:18443/edvs/z1A9uTYSmCU3DYQr7jhruhCuK/zcaps/documents',
  proof: {
    type: 'Ed25519Signature2020',
    created: '2020-02-27T21:22:48Z',
    // eslint-disable-next-line max-len
    verificationMethod: 'did:key:z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg#z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg',
    proofPurpose: 'capabilityDelegation',
    capabilityChain: [
      // eslint-disable-next-line max-len
      'https://bedrock.localhost:18443/edvs/z1A9uTYSmCU3DYQr7jhruhCuK/zcaps/documents'
    ],
    // a valid signature is not required for the test
    proofValue: 'zMOCK_PROOF'
  }
};

const zcap2 = {
  '@context': ZCAP_CONTEXT_URL,
  id: 'urn:zcap:z19u4rwByrmyKFr1XC9AYNYcs',
  controller: 'did:key:z6Mkkt1BWYLPAAXwYBwyVHAZkL94tgT8QbQv2SUxeW1U3DaG',
  referenceId: 'bedrock.localhost:settings',
  allowedAction: [
    'read',
    'write'
  ],
  invocationTarget: {
    id: 'https://bedrock.localhost:18443/edvs/z19jTB2drTyi4JHrARunxze8E',
    type: 'urn:edv:documents'
  },
  // eslint-disable-next-line max-len
  parentCapability: 'https://bedrock.localhost:18443/edvs/z19jTB2drTyi4JHrARunxze8E/zcaps/documents',
  proof: {
    type: 'Ed25519Signature2020',
    created: '2020-02-27T21:22:48Z',
    // eslint-disable-next-line max-len
    verificationMethod: 'did:key:z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg#z6MkkrtV7wnBpXKBtiZjxaSghCo8ttb5kZUJTk8bEwTTTYvg',
    proofPurpose: 'capabilityDelegation',
    capabilityChain: [
      // eslint-disable-next-line max-len
      'https://bedrock.localhost:18443/edvs/z19jTB2drTyi4JHrARunxze8E/zcaps/documents'
    ],
    // a valid signature is not required for the test
    proofValue: 'zMOCK_PROOF'
  }
};

zcaps.push(zcap0, zcap1, zcap2);
