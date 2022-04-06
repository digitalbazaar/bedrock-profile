/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import '@bedrock/https-agent';

// NOTE: if the config sets config parameters for other bedrock modules,
// those modules should be required here
import './config.js';

export * as profileAgents from './profileAgents.js';
export * as profileMeters from './profileMeters.js';
export * as profiles from './profiles.js';
