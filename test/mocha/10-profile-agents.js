/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {CapabilityAgent} = require('@digitalbazaar/webkms-client');
const {profileAgents} = require('bedrock-profile');
const helpers = require('./helpers');
const {util: {uuid}} = require('bedrock');
const mockData = require('./mock.data');

describe('profileAgents API', () => {
  // top-level application capability agent for creating meters
  let capabilityAgent;
  let kmsMeterCapability;
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
    kmsMeterCapability = meterCapability;
  });
  after(() => {
    passportStub.restore();
  });
  describe('Create Profile Agent', () => {
    it('successfully create a profile agent', async () => {
      const accountId = uuid();
      const profileId = uuid();
      let error;
      let profileAgent;
      try {
        ({profileAgent} = await profileAgents.create(
          {accountId, profileId, kmsMeterCapability}));
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profileAgent);
      profileAgent.account.should.equal(accountId);
      profileAgent.sequence.should.equal(0);

    });
  }); // end create a profile agent
  describe('Get Profile Agent', () => {
    it('successfully get a profile agent by "id"', async () => {
      const accountId = uuid();
      const profileId = uuid();
      let error;
      let profileAgent;
      let fetchedProfileAgent;
      try {
        ({profileAgent} = await profileAgents.create(
          {accountId, profileId, kmsMeterCapability}));
        const {id} = profileAgent;
        ({profileAgent: fetchedProfileAgent} = await profileAgents.get({id}));
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profileAgent);
      should.exist(fetchedProfileAgent);
      profileAgent.id.should.equal(fetchedProfileAgent.id);
      profileAgent.sequence.should.equal(fetchedProfileAgent.sequence);
      profileAgent.keystore.should.equal(fetchedProfileAgent.keystore);
      profileAgent.capabilityInvocationKey.should.eql(
        fetchedProfileAgent.capabilityInvocationKey);
    });
    it('successfully get a profile agent by "profileId"', async () => {
      const accountId = uuid();
      const profileId = `did:example:${uuid()}`;
      let error;
      let profileAgent;
      let fetchedProfileAgent;
      try {
        ({profileAgent} = await profileAgents.create(
          {profileId, kmsMeterCapability}));
        await profileAgents.update({
          profileAgent: {
            ...profileAgent,
            sequence: profileAgent.sequence + 1,
            account: accountId
          }
        });
        ({profileAgent: fetchedProfileAgent} =
            await profileAgents.getByProfile({profileId, accountId}));
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profileAgent);
      should.exist(fetchedProfileAgent);
      profileAgent.id.should.equal(fetchedProfileAgent.id);
      profileAgent.sequence.should.equal(0);
      fetchedProfileAgent.sequence.should.equal(1);
      fetchedProfileAgent.profile.should.equal(profileId);
      profileAgent.keystore.should.equal(fetchedProfileAgent.keystore);
      profileAgent.capabilityInvocationKey.should.eql(
        fetchedProfileAgent.capabilityInvocationKey);
    });
  }); // end get a profile agent
  describe('Remove Profile Agent', () => {
    it('successfully remove a profile agent by "id"', async () => {
      const accountId = uuid();
      const profileId = uuid();
      let id;
      let error;
      let profileAgent;
      let fetchedProfileAgent;
      try {
        ({profileAgent} = await profileAgents.create(
          {accountId, profileId, kmsMeterCapability}));
        ({id} = profileAgent);
        await profileAgents.remove({id});
      } catch(e) {
        error = e;
      }
      try {
        ({profileAgent: fetchedProfileAgent} = await profileAgents.get({id}));
      } catch(e) {
        should.exist(e);
      }
      assertNoError(error);
      should.exist(profileAgent);
      should.not.exist(fetchedProfileAgent);
    });
  }); // end remove a profile agent
  describe('Get All Profile Agents', () => {
    it('successfully gets all profile agents by "accountId"', async () => {
      const accountId = uuid();
      const profileId = uuid();
      let error;
      let profileAgent0;
      let profileAgent1;
      let profileAgent2;
      let fetchedProfileAgents;
      try {
        const create3ProfileAgents = [0, 1, 2].map(async () => {
          return profileAgents.create(
            {accountId, profileId, kmsMeterCapability});
        });
        [
          {profileAgent: profileAgent0},
          {profileAgent: profileAgent1},
          {profileAgent: profileAgent2}
        ] = await Promise.all(create3ProfileAgents);
        fetchedProfileAgents = await profileAgents.getAll({accountId});
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profileAgent0);
      should.exist(profileAgent1);
      should.exist(profileAgent2);
      fetchedProfileAgents.should.be.an('array');
      fetchedProfileAgents.length.should.equal(3);
      fetchedProfileAgents[0].profileAgent.account.should.equal(accountId);
      fetchedProfileAgents[1].profileAgent.account.should.equal(accountId);
      fetchedProfileAgents[2].profileAgent.account.should.equal(accountId);
      const [fetchedProfileAgent0] = fetchedProfileAgents.filter(
        ({profileAgent}) => profileAgent.id === profileAgent0.id);
      should.exist(fetchedProfileAgent0);
      fetchedProfileAgent0.profileAgent.id.should.equal(profileAgent0.id);
      fetchedProfileAgent0.profileAgent.keystore.should.equal(
        profileAgent0.keystore);
      fetchedProfileAgent0.profileAgent.capabilityInvocationKey.should.eql(
        profileAgent0.capabilityInvocationKey);
    });
  }); // end get all profile agents
  describe('Update Profile Agent', () => {
    it('successfully update a profile agent', async () => {
      const accountId = uuid();
      const newAccountId = uuid();
      const profileId = `did:example:${uuid()}`;
      let error;
      let profileAgent;
      let updatedProfileAgent;
      try {
        ({profileAgent} = await profileAgents.create(
          {accountId, profileId, kmsMeterCapability}));
        const {id} = profileAgent;
        await profileAgents.update({
          profileAgent: {
            ...profileAgent,
            sequence: profileAgent.sequence + 1,
            account: newAccountId
          }
        });
        ({profileAgent: updatedProfileAgent} = await profileAgents.get({id}));
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profileAgent);
      should.exist(updatedProfileAgent);
      profileAgent.id.should.equal(updatedProfileAgent.id);
      profileAgent.sequence.should.equal(0);
      updatedProfileAgent.sequence.should.equal(1);
      profileAgent.keystore.should.equal(updatedProfileAgent.keystore);
      profileAgent.capabilityInvocationKey.should.eql(
        updatedProfileAgent.capabilityInvocationKey);
      updatedProfileAgent.profile.should.equal(profileId);
      profileAgent.account.should.equal(accountId);
      updatedProfileAgent.account.should.equal(newAccountId);
    });
  }); // end get a profile agent
  describe('Delegate zCaps from a Profile Agent', () => {
    it('successfully delegate capabilites from a profile agent', async () => {
      const accountId = uuid();
      const profileId = uuid();
      const controller = `did:example:${uuid()}`;
      let error;
      let profileAgent;
      let delegatedZcaps;
      let secrets;
      try {
        ({profileAgent, secrets} = await profileAgents.create(
          {accountId, profileId, kmsMeterCapability}));
        const capabilities = mockData.zcaps;
        delegatedZcaps = await profileAgents.delegateCapabilities(
          {profileAgent, capabilities, controller, secrets});
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profileAgent);
      profileAgent.account.should.equal(accountId);
      profileAgent.sequence.should.equal(0);
      delegatedZcaps.length.should.equal(3);
      delegatedZcaps[0].proof.capabilityChain.length.should.equal(2);
    });
  }); // end create a profile agent
}); // end profileAgents API
