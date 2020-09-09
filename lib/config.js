/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');

config.profile = {
  zcap: {
    // 24 hour expiration
    ttl: 24 * 60 * 60 * 1000
  }
};
