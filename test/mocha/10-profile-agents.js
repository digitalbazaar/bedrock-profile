/*!
 * Copyright (c) 2020-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import {getAppIdentity} from '@bedrock/app-identity';
import {mockData} from './mock.data.js';
import {profileAgents} from '@bedrock/profile';
import {v4 as uuid} from 'uuid';

// import is for testing purposes only; not a public export
import {_loadKeks} from '@bedrock/profile/lib/secretsEncryption.js';

/* eslint-disable */
/*
'u' + Buffer.concat([Buffer.from([0xa2, 0x01]), Buffer.from(crypto.getRandomValues(new Uint8Array(32)))]).toString('base64url')
*/
/* eslint-enable */
const secretsEncryption = [
  {
    title: 'w/no secrets encryption',
    kek: null
  },
  {
    title: 'w/aes256 secrets encryption',
    kek: {
      id: 'urn:test:aes256',
      secretKeyMultibase: 'uogH3ERq9FRYOV8IuUiD2gKZs_qN6SLU-6RtbBUfzqQwGdg'
    }
  }
];

describe('profileAgents API', () => {
  for(const encryptConfig of secretsEncryption) {
    describe(encryptConfig.title, () => {
      before(() => {
        bedrock.config.profile.profileAgent.secretsEncryption = {
          kek: encryptConfig.kek
        };
        _loadKeks();
      });
      after(() => {
        bedrock.config.profile.profileAgent.secretsEncryption = {kek: null};
      });

      let keystoreOptions;
      // mock session authentication for delegations endpoint
      let passportStub;
      before(async () => {
        await helpers.prepareDatabase(mockData);
        passportStub = helpers.stubPassport();

        // top-level applications must create meters
        const {keys} = getAppIdentity();
        const invocationSigner = keys.capabilityInvocationKey.signer();
        const {id: meterId} = await helpers.createMeter({type: 'webkms'});
        keystoreOptions = {
          meterId,
          meterCapabilityInvocationSigner: invocationSigner
        };
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
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            }));
          } catch(e) {
            error = e;
          }
          assertNoError(error);
          should.exist(profileAgent);
          profileAgent.account.should.equal(accountId);
          profileAgent.sequence.should.equal(0);

        });
      }); // end create a profile agent
      describe('Count Profile Agents', () => {
        it('successfully count profile agents by "accountId"', async () => {
          const accountId = uuid();
          const profileId = uuid();
          let error;
          let count;
          try {
            await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            });
            ({count} = await profileAgents.count({accountId}));
          } catch(e) {
            error = e;
          }
          assertNoError(error);
          should.exist(count);
          count.should.equal(1);
        });
      }); // end count profile agents
      describe('Get Profile Agent', () => {
        it('successfully get a profile agent by "id"', async () => {
          const accountId = uuid();
          const profileId = uuid();
          let error;
          let profileAgent;
          let fetchedProfileAgent;
          try {
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            }));
            const {id} = profileAgent;
            ({
              profileAgent: fetchedProfileAgent
            } = await profileAgents.get({id}));
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
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, profileId, store: true
            }));
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
        it('successfully handle profile agent update conflict', async () => {
          const accountId = uuid();
          const profileId = `did:example:${uuid()}`;
          let error;
          let profileAgent;
          let fetchedProfileAgent;
          try {
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, profileId, store: true
            }));
            // first do update with wrong sequence number
            let invalidStateError;
            try {
              await profileAgents.update({
                profileAgent: {
                  ...profileAgent,
                  sequence: profileAgent.sequence,
                  account: accountId
                }
              });
            } catch(e) {
              invalidStateError = e;
              e.name.should.equal('InvalidStateError');
            }
            should.exist(invalidStateError);
            const updatedRecord = await profileAgents.update({
              profileAgent: {
                ...profileAgent,
                sequence: profileAgent.sequence + 1,
                account: accountId
              },
              includeSecrets: true
            });
            const fetchedRecord = await profileAgents.getByProfile(
              {profileId, accountId, includeSecrets: true});
            ({profileAgent: fetchedProfileAgent} = fetchedRecord);
            updatedRecord.should.deep.equal(fetchedRecord);
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
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            }));
            ({id} = profileAgent);
            await profileAgents.remove({id});
          } catch(e) {
            error = e;
          }
          try {
            ({
              profileAgent: fetchedProfileAgent
            } = await profileAgents.get({id}));
          } catch(e) {
            should.exist(e);
          }
          assertNoError(error);
          should.exist(profileAgent);
          should.not.exist(fetchedProfileAgent);
        });
        it('successfully remove a profile agent by "id" and ' +
          '"account"', async () => {
          const accountId = uuid();
          const profileId = uuid();
          let id;
          let error;
          let profileAgent;
          let fetchedProfileAgent;
          try {
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            }));
            ({id} = profileAgent);
            await profileAgents.remove({id, account: accountId});
          } catch(e) {
            error = e;
          }
          try {
            ({
              profileAgent: fetchedProfileAgent
            } = await profileAgents.get({id}));
          } catch(e) {
            should.exist(e);
          }
          assertNoError(error);
          should.exist(profileAgent);
          should.not.exist(fetchedProfileAgent);
        });
        it('fails to remove a profile agent when "account" does not ' +
          'match', async () => {
          const accountId = uuid();
          const profileId = uuid();
          let id;
          let error;
          let profileAgent;
          let fetchedProfileAgent;
          try {
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            }));
            ({id} = profileAgent);
            await profileAgents.remove({id, account: 'incorrect account'});
          } catch(e) {
            error = e;
          }
          should.exist(error);
          error.name.should.equal('NotFoundError');
          error = undefined;

          try {
            ({
              profileAgent: fetchedProfileAgent
            } = await profileAgents.get({id}));
          } catch(e) {
            error = e;
          }
          assertNoError(error);
          should.exist(profileAgent);
          should.exist(fetchedProfileAgent);
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
              return profileAgents.create({
                keystoreOptions, accountId, profileId, store: true
              });
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
            ({profileAgent} = await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            }));
            const {id} = profileAgent;
            await profileAgents.update({
              profileAgent: {
                ...profileAgent,
                sequence: profileAgent.sequence + 1,
                account: newAccountId
              }
            });
            ({
              profileAgent: updatedProfileAgent
            } = await profileAgents.get({id}));
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
        it('successfully delegate capabilites', async () => {
          const accountId = uuid();
          const profileId = uuid();
          const controller = `did:example:${uuid()}`;
          let error;
          let profileAgent;
          let delegatedZcaps;
          let secrets;
          try {
            ({profileAgent, secrets} = await profileAgents.create({
              keystoreOptions, accountId, profileId, store: true
            }));
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
    });
  }
}); // end profileAgents API
