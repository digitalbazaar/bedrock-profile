/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {profiles} = require('bedrock-profile');
const helpers = require('./helpers');
const mockData = require('./mock.data');
const {util: {uuid}} = require('bedrock');

describe('profiles API', () => {
  // mock session authentication for delegations endpoint
  let passportStub;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
  });
  after(() => {
    passportStub.restore();
  });

  describe('Create Profile', () => {
    it('successfully create a profile', async () => {
      const accountId = uuid();
      let error;
      let profile;
      try {
        profile = await profiles.create({accountId});
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profile);
      profile.id.should.be.a('string');
    });
  }); // end create a profile agent
}); // end profiles API
