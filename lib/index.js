/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

require('bedrock-https-agent');

// NOTE: if the config sets config parameters for other bedrock modules,
// those modules should be required here
require('./config');

// module API
module.exports = {
  profileAgents: require('./profileAgents'),
  profiles: require('./profiles')
};
