/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';

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
config.ensureConfigOverride.fields.push('profile.kms.defaultKmsModule');

config.profile.profileAgent = {
  // max time (in ms) before zcap expiry to trigger refresh: 1 month
  zcapRefreshThreshold: 30 * 24 * 60 * 60 * 1000,
  // TTL (in ms) for profile agent's EDV zcaps: 365 days; note
  // cannot be higher than this, it's a hard limit
  edvZcapTtl: 365 * 24 * 60 * 60 * 1000,
  // TTL (in ms) for root profile agent's zcap to use profile zcap invocation
  // key:
  // 1000 years; note: cannot be higher than this it is a hard limit
  profileCapabilityInvocationKeyZcapTtl: 1000 * 365 * 24 * 60 * 60 * 1000
};
