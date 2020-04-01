/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {profileAgents} = require('bedrock-profile');
const helpers = require('./helpers');
const {util: {uuid}} = require('bedrock');
const mockData = require('./mock.data');

describe('profileAgents getByToken API', () => {
  // mock session authentication for delegations endpoint
  let passportStub;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
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
      ({profileAgent} = await profileAgents.create({profileId, token}));
    } catch(e) {
      error = e;
    }
    assertNoError(error);

    error = null;
    profileAgent = null;
    try {
      ({profileAgent} = await profileAgents.getByToken({token}));
    } catch(e) {
      error = e;
    }
    assertNoError(error);
    should.exist(profileAgent);
    profileAgent.profile.should.equal(profileId);
    profileAgent.sequence.should.equal(0);
    profileAgent.token.should.equal(token);
  });
}); // end profileAgents getByToken API
