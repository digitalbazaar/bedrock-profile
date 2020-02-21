/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {profileAgents, profiles} = require('bedrock-profile');
const capabilitySets = require('bedrock-profile/lib/capabilitySets');
const helpers = require('./helpers');
const {util: {uuid}} = require('bedrock');
const mockData = require('./mock.data');

describe('bedrock-profile', () => {
  // mock session authentication for delegations endpoint
  let passportStub;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
  });
  after(() => {
    passportStub.restore();
  });
  describe('capabilitySets API', () => {
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
  describe('profileAgents API', () => {
    describe('Create Profile Agent', () => {
      it('successfully create a profile agent', async () => {
        const account = uuid();
        let error;
        let profileAgent;
        try {
          ({profileAgent} = await profileAgents.create({account}));
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profileAgent);
        profileAgent.account.should.equal(account);
        profileAgent.sequence.should.equal(0);

      });
    }); // end create a profile agent
    describe('Get Profile Agent', () => {
      it('successfully get a profile agent by "id"', async () => {
        const account = uuid();
        let error;
        let profileAgent;
        let fetchedProfileAgent;
        try {
          ({profileAgent} = await profileAgents.create({account}));
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
        profileAgent.capabilityInvocationKey.should.equal(
          fetchedProfileAgent.capabilityInvocationKey);
      });
      it('successfully get a profile agent by "profile"', async () => {
        const account = uuid();
        const profile = `did:example:${uuid()}`;
        let error;
        let profileAgent;
        let fetchedProfileAgent;
        try {
          ({profileAgent} = await profileAgents.create({account}));
          await profileAgents.update({
            profileAgent: {
              ...profileAgent,
              sequence: profileAgent.sequence + 1,
              profile
            }
          });
          ({profileAgent: fetchedProfileAgent} =
              await profileAgents.getByProfile({profile}));
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profileAgent);
        should.exist(fetchedProfileAgent);
        profileAgent.id.should.equal(fetchedProfileAgent.id);
        profileAgent.sequence.should.equal(0);
        fetchedProfileAgent.sequence.should.equal(1);
        fetchedProfileAgent.profile.should.equal(profile);
        profileAgent.keystore.should.equal(fetchedProfileAgent.keystore);
        profileAgent.capabilityInvocationKey.should.equal(
          fetchedProfileAgent.capabilityInvocationKey);
      });
    }); // end get a profile agent
    describe('Update Profile Agent', () => {
      it('successfully update a profile agent', async () => {
        const account = uuid();
        const newAccount = uuid();
        const profile = `did:example:${uuid()}`;
        let error;
        let profileAgent;
        let updatedProfileAgent;
        try {
          ({profileAgent} = await profileAgents.create({account}));
          const {id} = profileAgent;
          await profileAgents.update({
            profileAgent: {
              ...profileAgent,
              sequence: profileAgent.sequence + 1,
              profile,
              account: newAccount
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
        profileAgent.capabilityInvocationKey.should.equal(
          updatedProfileAgent.capabilityInvocationKey);
        updatedProfileAgent.profile.should.equal(profile);
        profileAgent.account.should.equal(account);
        updatedProfileAgent.account.should.equal(newAccount);
      });
    }); // end get a profile agent
    describe('Delegate zCaps from a Profile Agent', () => {
      it('successfully delegate capabilites from a profile agent', async () => {
        const account = uuid();
        const controller = `did:example:${uuid()}`;
        let error;
        let profileAgent;
        let delegatedZcaps;
        try {
          ({profileAgent} = await profileAgents.create({account}));
          const {id: profileAgentId} = profileAgent;
          const capabilities = mockData.zcaps;
          delegatedZcaps = await profileAgents.delegateCapabilities(
            {profileAgentId, capabilities, controller});
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profileAgent);
        profileAgent.account.should.equal(account);
        profileAgent.sequence.should.equal(0);
        delegatedZcaps.length.should.equal(3);
        delegatedZcaps[0].proof.capabilityChain.length.should.equal(2);
      });
    }); // end create a profile agent
  }); // end profileAgents API
  describe('profiles API', () => {
    describe('Create Profile', () => {
      it('successfully create a profile', async () => {
        let error;
        let result;
        try {
          const settings = {name: 'Example Profile', color: '#ff0000'};
          result = await profiles.create({account: uuid(), settings});
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(result);
      });
    }); // end create a profile agent
    describe('Get Profile', () => {
      it.skip('successfully get a profile', async () => {
      });
    }); // end create a profile agent
  }); // end profileAgents API
}); // end bedrock-profile
