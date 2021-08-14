/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');

config.profile = {};

config.profile.kms = {};

// example: https://example.com/kms
config.profile.kms.baseUrl = '';

// ipAllowList is added to keystores that should only be accessible from
// specific applications operating on trusted IP addresses
config.profile.kms.ipAllowList = [];

// default KMS module to use
config.profile.kms.defaultKmsModule = 'ssm-v1';
// ensure default KMS module is overridden in deployments
config.ensureConfigOverride.fields.push('config.profile.kms.defaultKmsModule');
