/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const database = require('bedrock-mongodb');
const {profiles} = require('bedrock-profile');
const helpers = require('./helpers');
const mockData = require('./mock.data');
const {util: {uuid}} = require('bedrock');

describe('profiles API', () => {
  // mock session authentication for delegations endpoint
  let passportStub;
  let profileAgentCollection;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
    profileAgentCollection = database.collections['profile-profileAgent'];
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
      const agents = await profileAgentCollection.find({
        'profileAgent.profile': profile.id,
      }).toArray();
      agents.should.have.length(1);
      const [a] = agents;
      const profileCapabilityInvocationKey =
        a.profileAgent.zcaps.profileCapabilityInvocationKey;
      a.should.have.property('meta');
      a.meta.should.have.property('created');
      a.meta.should.have.property('updated');
      a.should.have.property('profileAgent');
      a.profileAgent.should.have.property('id');
      a.profileAgent.should.have.property('sequence');
      a.profileAgent.should.have.property('account');
      a.profileAgent.should.have.property('profile');
      a.profileAgent.should.have.property('controller');
      a.profileAgent.controller.should.have.property('id');
      a.profileAgent.controller.should.have.property('keystore');
      a.profileAgent.should.have.property('keystore');
      a.profileAgent.should.have.property('capabilityInvocationKey');
      a.profileAgent.should.have.property('zcaps');
      profileCapabilityInvocationKey.should.have.property('expires');
      profileCapabilityInvocationKey.expires.should.be.a('string');
      a.should.have.property('secrets');
      a.secrets.should.have.property('seed');
    });
  }); // end create a profile agent
}); // end profiles API
