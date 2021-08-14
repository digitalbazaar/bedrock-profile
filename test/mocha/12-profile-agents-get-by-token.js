/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {CapabilityAgent} = require('@digitalbazaar/webkms-client');
const {profileAgents} = require('bedrock-profile');
const helpers = require('./helpers');
const {util: {uuid}} = require('bedrock');
const mockData = require('./mock.data');

describe('profileAgents getByToken API', () => {
  // top-level application capability agent for creating meters
  let capabilityAgent;
  let keystoreOptions;
  // mock session authentication for delegations endpoint
  let passportStub;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();

    // top-level applications must create meters to associate with the
    // creation of profile agents; the tests here reuse the same meter but
    // applications can create as many as needed
    const secret = 'b07e6b31-d910-438e-9a5f-08d945a5f676';
    const handle = 'app';
    capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});
    const {meterCapability} = await helpers.createMeter({capabilityAgent});
    keystoreOptions = {
      meterCapability,
      meterCapabilityInvocationSigner: capabilityAgent.getSigner()
    };
  });
  after(() => {
    passportStub.restore();
  });
  it('successfully gets a profile agent by token', async () => {
    const profileId = uuid();
    const token = uuid();
    let error;
    let profileAgent;
    try {
      ({profileAgent} = await profileAgents.create({
        keystoreOptions, profileId, token
      }));
    } catch(e) {
      error = e;
    }
    assertNoError(error);

    error = null;
    profileAgent = null;
    let secrets;
    try {
      ({profileAgent, secrets} = await profileAgents.getByToken(
        {token, includeSecrets: true}));
    } catch(e) {
      error = e;
    }
    assertNoError(error);
    should.exist(profileAgent);
    profileAgent.profile.should.equal(profileId);
    profileAgent.sequence.should.equal(0);
    should.exist(secrets);
    secrets.token.should.equal(token);
  });
}); // end profileAgents getByToken API
