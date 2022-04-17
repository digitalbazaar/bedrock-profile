/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {fileURLToPath} from 'url';
import path from 'path';
import '@bedrock/express';
import '@bedrock/did-io';
import '@bedrock/https-agent';
import '@bedrock/mongodb';
import '@bedrock/profile';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config.mocha.tests.push(path.join(__dirname, 'mocha'));

// Express
config.express.useSession = true;

// MongoDB
config.mongodb.name = 'bedrock_profile_test';
config.mongodb.dropCollections = {};
config.mongodb.dropCollections.onInit = true;
config.mongodb.dropCollections.collections = [];

// HTTPS Agent
config['https-agent'].rejectUnauthorized = false;

// Profile
config.profile.kms.baseUrl = `${config.server.baseUri}/kms`;
config.profile.kms.ipAllowList = ['127.0.0.1/32'];

config['did-io'].methodOverrides.v1.disableFetch = true;
