/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');
const path = require('path');

config.mocha.tests.push(path.join(__dirname, 'mocha'));
const {permissions, roles} = config.permission;

// MongoDB
config.mongodb.name = 'bedrock_profile_test';
config.mongodb.dropCollections = {};
config.mongodb.dropCollections.onInit = true;
config.mongodb.dropCollections.collections = [];

// HTTPS Agent
config['https-agent'].rejectUnauthorized = false;

// KMS
config.kms.allowedHost = config.server.host;

// Account
roles['bedrock-test.regular'] = {
  id: 'bedrock-test.regular',
  label: 'Account Test Role',
  comment: 'Role for Test User',
  sysPermission: [
    permissions.ACCOUNT_ACCESS.id,
    permissions.ACCOUNT_UPDATE.id,
    permissions.ACCOUNT_INSERT.id,
    permissions.EDV_CONFIG_ACCESS.id,
    permissions.EDV_CONFIG_UPDATE.id,
    permissions.EDV_CONFIG_REMOVE.id
  ]
};

// KMS HTTPS API
// optionally require an authenticated session
// this option may be set to false when operating behind an authenticated proxy
config['kms-http'].requireAuthentication = false;

config.profile.kms.baseUrl = `${config.server.baseUri}/kms`;
config.profile.kms.ipAllowList = ['127.0.0.1/32'];
