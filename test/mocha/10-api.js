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
              await profileAgents.getByProfile({profile, account}));
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
    describe('Get All Profile Agents', () => {
      it('successfully gets all profile agents by "account"', async () => {
        const account = uuid();
        let error;
        let profileAgent0;
        let profileAgent1;
        let profileAgent2;
        let fetchedProfileAgents;
        try {
          const createThreeProfileAgents = [0, 1, 2].map(async () => {
            return profileAgents.create({account});
          });
          [
            {profileAgent: profileAgent0},
            {profileAgent: profileAgent1},
            {profileAgent: profileAgent2}
          ] = await Promise.all(createThreeProfileAgents);
          fetchedProfileAgents = await profileAgents.getAll({account});
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profileAgent0);
        should.exist(profileAgent1);
        should.exist(profileAgent2);
        fetchedProfileAgents.should.be.an('array');
        fetchedProfileAgents.length.should.equal(3);
        fetchedProfileAgents[0].profileAgent.account.should.equal(account);
        fetchedProfileAgents[1].profileAgent.account.should.equal(account);
        fetchedProfileAgents[2].profileAgent.account.should.equal(account);
        const [fetchedProfileAgent0] = fetchedProfileAgents.filter(
          ({profileAgent}) => profileAgent.id === profileAgent0.id);
        should.exist(fetchedProfileAgent0);
        fetchedProfileAgent0.profileAgent.id.should.equal(profileAgent0.id);
        fetchedProfileAgent0.profileAgent.keystore.should.equal(
          profileAgent0.keystore);
        fetchedProfileAgent0.profileAgent.capabilityInvocationKey.should.equal(
          profileAgent0.capabilityInvocationKey);
      });
    }); // end get all profile agents
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
        const account = uuid();
        const settings = {name: 'Example Profile', color: '#ff0000'};
        let error;
        let profile;
        try {
          profile = await profiles.create({account, settings});
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profile);
        profile.id.should.be.a('string');
        profile.name.should.equal(settings.name);
        profile.color.should.equal(profile.color);
      });
    }); // end create a profile agent
    describe('Get Profile', () => {
      it('successfully get a profile', async () => {
        const account = uuid();
        const settings = {name: 'Example Profile', color: '#ff0000'};
        let error;
        let profile;
        let fetchedProfile;
        try {
          profile = await profiles.create({account, settings});
          const {id: profileId} = profile;
          fetchedProfile = await profiles.get({profileId, account});
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profile);
        should.exist(fetchedProfile);
        fetchedProfile.name.should.equal(settings.name);
        fetchedProfile.color.should.equal(settings.color);
        profile.id.should.equal(fetchedProfile.id);
      });
    }); // end get a profile
    describe('Get All Profiles', () => {
      it('successfully get all profiles by "account"', async () => {
        const account = uuid();
        const settings = {name: 'Example Profile', color: '#ff0000'};
        let error;
        let profile0;
        let profile1;
        let profile2;
        let fetchedProfiles;
        try {
          const create3Profiles = [0, 1, 2].map(async i => {
            return profiles.create({
              account,
              settings: {
                ...settings,
                name: settings.name + i
              }
            });
          });
          [profile0, profile1, profile2] = await Promise.all(create3Profiles);
          fetchedProfiles = await profiles.getAll({account});
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profile0);
        should.exist(profile1);
        should.exist(profile2);
        should.exist(fetchedProfiles);
        fetchedProfiles.should.be.an('array');
        fetchedProfiles.length.should.equal(3);
        fetchedProfiles[0].type.should.equal('Profile');
        fetchedProfiles[0].name.should.equal(settings.name + '0');
        fetchedProfiles[0].color.should.equal(settings.color);
        fetchedProfiles[1].type.should.equal('Profile');
        fetchedProfiles[1].name.should.equal(settings.name + '1');
        fetchedProfiles[1].color.should.equal(settings.color);
        fetchedProfiles[2].type.should.equal('Profile');
        fetchedProfiles[2].name.should.equal(settings.name + '2');
        fetchedProfiles[2].color.should.equal(settings.color);
      });
    }); // end get a profile
  }); // end profiles API
}); // end bedrock-profile
