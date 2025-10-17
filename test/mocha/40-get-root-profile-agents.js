/*!
 * Copyright (c) 2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import {profileAgents, profiles} from '@bedrock/profile';
import {getAppIdentity} from '@bedrock/app-identity';
import {mockData} from './mock.data.js';
import {randomUUID} from 'node:crypto';

describe('Get Root Profile Agents', () => {
  let edvOptions;
  let keystoreOptions;
  // mock session authentication for delegations endpoint
  let passportStub;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = helpers.stubPassport();
  });
  beforeEach(async () => {
    // top-level applications must create meters
    const {keys} = getAppIdentity();
    const invocationSigner = keys.capabilityInvocationKey.signer();

    const {id: edvMeterId} = await helpers.createMeter({type: 'edv'});
    const {id: kmsMeterId} = await helpers.createMeter({type: 'webkms'});
    edvOptions = {
      profile: {
        baseUrl: bedrock.config.server.baseUri,
        meterId: edvMeterId,
        meterCapabilityInvocationSigner: invocationSigner
      }
    };
    keystoreOptions = {
      profileAgent: {
        meterId: kmsMeterId,
        meterCapabilityInvocationSigner: invocationSigner
      },
      profile: {
        meterId: kmsMeterId,
        meterCapabilityInvocationSigner: invocationSigner
      }
    };
  });
  after(() => {
    passportStub.restore();
  });

  describe('profileAgents.getRoots() API', () => {
    it('successfully get a root profile agent by "profile"', async () => {
      // insert several root profile agents for the same profile by creating
      // a profile and then hacking the root profile agents to have the
      // necessary zcaps to appear to be another root profile (even though the
      // zcaps will not be technically invokable, this does not matter to test
      // lookups); a future revision could use a new API (when it exists) to
      // properly provision more root profile agent zcaps
      let profileId;
      let zcaps;
      {
        const accountId = randomUUID();
        const profile = await createProfile({
          accountId, didMethod: 'key', edvOptions, keystoreOptions
        });
        profileId = profile.id;
        const [profileAgentRecord] = await getAllProfileAgents({
          accountId
        });
        zcaps = profileAgentRecord.profileAgent.zcaps;
      }

      const {keys} = getAppIdentity();
      const invocationSigner = keys.capabilityInvocationKey.signer();
      // add non-root profile agents for the same profile ID
      for(let i = 0; i < 10; ++i) {
        const {id: meterId} = await helpers.createMeter({type: 'webkms'});
        const keystoreOptions = {
          meterId,
          meterCapabilityInvocationSigner: invocationSigner
        };
        const accountId = randomUUID();
        await profileAgents.create({
          keystoreOptions, accountId, profileId, store: true
        });
      }
      // add root profile agents for the same profile ID
      for(let i = 0; i < 10; ++i) {
        const {id: meterId} = await helpers.createMeter({type: 'webkms'});
        const keystoreOptions = {
          meterId,
          meterCapabilityInvocationSigner: invocationSigner
        };
        const accountId = randomUUID();
        const {profileAgent} = await profileAgents.create({
          keystoreOptions, accountId, profileId, store: true
        });
        await profileAgents.update({
          profileAgent: {
            ...profileAgent,
            sequence: profileAgent.sequence + 1,
            // none are actually invokable, but required for the query
            zcaps
          }
        });
      }

      // ensure the proper index is used for finding root profile agents
      {
        // use a limit of `2` to ensure the non-roots that come after the
        // first root profile agent are not examined
        const {executionStats} = await profileAgents.getRootAgents({
          profileId, options: {limit: 2}, explain: true
        });
        executionStats.nReturned.should.equal(2);
        executionStats.totalKeysExamined.should.equal(2);
        executionStats.totalDocsExamined.should.equal(2);
        executionStats.executionStages.inputStage.inputStage.stage
          .should.equal('IXSCAN');
        executionStats.executionStages.inputStage.inputStage
          .keyPattern.should.eql({
            'profileAgent.profile': 1,
            'profileAgent.zcaps.profileCapabilityInvocationKey.id': 1
          });
      }

      // find a single root profile agent w/secrets
      {
        let error;
        let profileAgent;
        try {
          const records = await profileAgents.getRootAgents({
            profileId, includeSecrets: true
          });
          records.length.should.equal(1);
          should.exist(records[0].secrets);
          ([{profileAgent}] = records);
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profileAgent);
        profileAgent.profile.should.equal(profileId);
      }

      // find a single root profile agent w/o secrets
      {
        let error;
        let profileAgent;
        try {
          const records = await profileAgents.getRootAgents({profileId});
          records.length.should.equal(1);
          should.not.exist(records[0].secrets);
          ([{profileAgent}] = records);
        } catch(e) {
          error = e;
        }
        assertNoError(error);
        should.exist(profileAgent);
        profileAgent.profile.should.equal(profileId);
      }
    });
  });
});

async function createProfile({
  accountId, didMethod, edvOptions, keystoreOptions
} = {}) {
  try {
    return profiles.create({
      accountId, didMethod, edvOptions, keystoreOptions
    });
  } catch(e) {
    assertNoError(e);
  }
}

async function getAllProfileAgents({accountId, includeSecrets} = {}) {
  try {
    return profileAgents.getAll({accountId, includeSecrets});
  } catch(e) {
    assertNoError(e);
  }
}
