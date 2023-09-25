/*!
 * Copyright (c) 2020-2023 Digital Bazaar, Inc. All rights reserved.
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
  zcap: {
    // max time before zcap expiry to trigger refresh: 1 month (in ms)
    // note: has a minimum of 15 minutes
    autoRefreshThreshold: 30 * 24 * 60 * 60 * 1000,
    // max time delta between zcaps in profile agent record and user EDV doc:
    // 10 minutes (in ms)
    // note: maximum of 10 minutes, can be as little as zero
    syncTimeDelta: 10 * 60 * 1000,
    ttl: {
      // default TTL to use for profile agent's zcaps: 365 days (in ms)
      // note: cannot be higher than 365 days, it's a hard limit
      default: 365 * 24 * 60 * 60 * 1000,
      // TTL to use for profile capability invocation key zcap:
      // 1000 years (in ms)
      // note: cannot be higher than 1000 years, it's a hard limit
      profileCapabilityInvocationKey: 1000 * 365 * 24 * 60 * 60 * 1000
    }
  }
};
