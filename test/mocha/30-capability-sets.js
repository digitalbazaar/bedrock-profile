/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {capabilitySets} = require('bedrock-profile');
const helpers = require('./helpers');
const mockData = require('./mock.data');
const {util: {uuid}} = require('bedrock');

describe('capabilitySets API', () => {
  // mock session authentication for delegations endpoint
  let passportStub;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
  });
  after(() => {
    passportStub.restore();
  });

  describe('Create Capability Set', () => {
    it('successfully create a capability set', async () => {
      let error;
      let result;
      try {
        const capabilitySet = {
          sequence: 0,
          profileAgent: `did:example:${uuid()}`,
          zcaps: []
        };
        result = await capabilitySets.create({capabilitySet});
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(result);
    });
  }); // end create capability set
  describe('Get Capability Set', () => {
    it.skip('successfully get a capability set', async () => {
    });
  }); // end get capability set
  describe('Get All Capability Sets', () => {
    it.skip('successfully get all capability sets for a ' +
      'profile agent', async () => {
    });
  }); // end get all capability sets
  describe('Update Capability Set', () => {
    it.skip('successfully update a capability set', async () => {
    });
  }); // end update capability set
  describe('Remove Capability Set', () => {
    it.skip('successfully remove a capability set', async () => {
    });
  }); // end remove capability set
}); // end capabilitySets API
