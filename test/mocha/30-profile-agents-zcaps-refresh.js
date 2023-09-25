/*!
 * Copyright (c) 2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import {profileAgents, profiles} from '@bedrock/profile';
import {EdvClient} from '@digitalbazaar/edv-client';
import {getAppIdentity} from '@bedrock/app-identity';
import {httpsAgent} from '@bedrock/https-agent';
import {keyResolver} from '@bedrock/profile/lib/keyResolver.js';
import {klona} from 'klona';
import {KmsClient} from '@digitalbazaar/webkms-client';
import {mockData} from './mock.data.js';
import {v4 as uuid} from 'uuid';

const {
  getEdvConfig,
  getEdvDocument,
  parseEdvId
} = helpers;

describe('Refresh Profile Agent Zcaps', () => {
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

  describe('profileAgents.getAll() API', () => {
    it.only('should refresh profile agent user doc zcaps and profile agent zcaps ' +
      'when "profileAgents.getAll()" is called if the time remaining until ' +
      'their expiration is equal to or less than the refresh threshold ' +
      'value.', async () => {
      const accountId = uuid();
      const didMethod = 'v1';
      const profile = await createProfile({
        accountId, didMethod, edvOptions, keystoreOptions
      });
      should.exist(profile);
      // should get all profile agents by accountId
      const agents = await getAllProfileAgents({
        accountId, includeSecrets: true
      });
      agents.should.have.length(1);
      const [a] = agents;
      a.should.have.property('meta');
      a.meta.should.have.keys(['created', 'updated']);
      a.should.have.property('profileAgent');
      a.profileAgent.should.have.keys([
        'id', 'sequence', 'account', 'profile', 'controller', 'keystore',
        'capabilityInvocationKey', 'zcaps'
      ]);
      a.profileAgent.sequence.should.equal(1);
      a.profileAgent.controller.should.be.a('string');
      const {zcaps} = a.profileAgent;
      zcaps.should.have.keys([
        'profileCapabilityInvocationKey', 'userDocument', 'user-edv-kak'
      ]);
      // intentionally update the expiration date of profile agent user doc
      // zcaps and profile agent zcaps to a date 15 days from now which is less
      // than the refresh threshold value of 1 month
      const now = Date.now();
      // 15 days in milliseconds
      const expiresIn15Days =
        new Date(now + 15 * 24 * 60 * 60 * 1000).toISOString();
      const profileAgentRecord = klona(agents[0]);
      const profileSigner = await profileAgents.getProfileSigner(
        {profileAgentRecord});
      const zcap = zcaps.userDocument;
      const edvId = parseEdvId({capability: zcap});
      const edvClient = new EdvClient({id: edvId, httpsAgent});
      const docId = zcap.invocationTarget.split('/').pop();
      const edvConfig = await getEdvConfig({edvClient, profileSigner});

      const kmsClient = new KmsClient({httpsAgent});
      const profileAgentUserDoc = await getProfileAgentUserDoc({
        edvClient, kmsClient, profileSigner, docId, edvConfig
      });
      profileAgentUserDoc.sequence.should.equal(0);
      const updateProfileAgentUserDoc = klona(profileAgentUserDoc);
      const updateProfileAgent = klona(a.profileAgent);

      // update zcaps expiration for profile agent
      await updateZcapsExpiration({
        profileAgent: updateProfileAgent,
        newExpires: expiresIn15Days,
      });
      // update zcaps expiration for profile agent user doc
      await updateZcapsExpiration({
        profileAgentUserDoc: updateProfileAgentUserDoc,
        newExpires: expiresIn15Days,
        edvClient,
        profileSigner
      });

      // get the updated profileAgent record, zcaps should be updated to expire
      // in 15 days
      const updatedRecord = await profileAgents.get({
        id: updateProfileAgent.id
      });
      updatedRecord.profileAgent.sequence.should.equal(2);
      const {zcaps: updatedProfileAgentZcaps} = updatedRecord.profileAgent;
      verifyZcapsExpiration({
        zcaps: updatedProfileAgentZcaps,
        expectedExpires: expiresIn15Days
      });

      // get the updated profile agent user document, zcaps should be updated
      // to expire in 15 days
      const updatedProfileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      updatedProfileAgentUserDoc.sequence.should.equal(1);
      const {
        zcaps: updatedProfileAgentUserDocZcaps
      } = updatedProfileAgentUserDoc.content;
      verifyZcapsExpiration({
        zcaps: updatedProfileAgentUserDocZcaps,
        expectedExpires: expiresIn15Days
      });

      // profileAgent user doc zcaps and profile agent zcaps should be refreshed
      // when getAll() is called.
      const refreshedAgents = await profileAgents.getAll({accountId});
      const refreshedAgent = refreshedAgents[0].profileAgent;
      refreshedAgent.sequence.should.equal(3);
      // Get the current year
      const currentYear = new Date().getFullYear();
      // zcaps expiration should have been set to a year from now
      const expectedExpiresYear = currentYear + 1;
      const {zcaps: refreshedZcaps} = refreshedAgent;
      verifyZcapsExpiration({
        zcaps: refreshedZcaps,
        expectedExpiresYear
      });
      // get updated profile agent user doc zcaps
      const refreshedProfileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      refreshedProfileAgentUserDoc.sequence.should.equal(2);
      const {
        zcaps: refreshedProfileAgentUserDocZcaps
      } = refreshedProfileAgentUserDoc.content;
      verifyZcapsExpiration({
        zcaps: refreshedProfileAgentUserDocZcaps,
        expectedExpiresYear
      });

      // FIXME: ensure zcaps still work!
    });
    it('should ensure that when "profileAgents.getAll()" is called multiple ' +
      'times concurrently, just one call should succeed at performing the ' +
      'refresh while the others should return the properly refreshed ' +
      'records and ensure that the document sequence is only incremented ' +
      'once.', async () => {
      const accountId = uuid();
      const didMethod = 'v1';
      const profile = await createProfile({
        accountId, didMethod, edvOptions, keystoreOptions
      });
      should.exist(profile);
      // should get all profile agents by accountId
      const agents = await getAllProfileAgents({
        accountId, includeSecrets: true
      });
      agents.should.have.length(1);
      const [a] = agents;
      a.should.have.property('meta');
      a.meta.should.have.keys(['created', 'updated']);
      a.should.have.property('profileAgent');
      a.profileAgent.should.have.keys([
        'id', 'sequence', 'account', 'profile', 'controller', 'keystore',
        'capabilityInvocationKey', 'zcaps'
      ]);
      a.profileAgent.sequence.should.equal(1);
      a.profileAgent.controller.should.be.a('string');
      const {zcaps} = a.profileAgent;
      zcaps.should.have.keys([
        'profileCapabilityInvocationKey', 'userDocument', 'user-edv-kak'
      ]);
      // intentionally update the expiration date of profile agent user doc
      // zcaps and profile agent zcaps to a date 15 days from now which is less
      // than the refresh threshold value of 1 month
      const now = Date.now();
      // 15 days in milliseconds
      const expiresIn15Days = new Date(now + 15 * 24 * 60 * 60 * 1000)
        .toISOString();
      const profileAgentRecord = klona(agents[0]);
      const profileSigner = await profileAgents.getProfileSigner(
        {profileAgentRecord});
      const zcap = zcaps.userDocument;
      const edvId = parseEdvId({capability: zcap});
      const edvClient = new EdvClient({id: edvId, httpsAgent});
      const docId = zcap.invocationTarget.split('/').pop();
      const edvConfig = await getEdvConfig({edvClient, profileSigner});

      const kmsClient = new KmsClient({httpsAgent});
      const profileAgentUserDoc = await getProfileAgentUserDoc({
        edvClient, kmsClient, profileSigner, docId, edvConfig
      });
      profileAgentUserDoc.sequence.should.equal(0);
      const updateProfileAgentUserDoc = klona(profileAgentUserDoc);
      const updateProfileAgent = klona(a.profileAgent);

      // Update zcaps expiration for profile agent
      await updateZcapsExpiration({
        profileAgent: updateProfileAgent,
        newExpires: expiresIn15Days,
      });
      // Update zcaps expiration for profile agent user doc
      await updateZcapsExpiration({
        profileAgentUserDoc: updateProfileAgentUserDoc,
        newExpires: expiresIn15Days,
        edvClient,
        profileSigner
      });

      // get the updated profileAgent record, zcaps should be updated to expire
      // in 15 days
      const updatedRecord = await profileAgents.get({
        id: updateProfileAgent.id
      });
      updatedRecord.profileAgent.sequence.should.equal(2);
      const {zcaps: updatedProfileAgentZcaps} = updatedRecord.profileAgent;
      verifyZcapsExpiration({
        zcaps: updatedProfileAgentZcaps,
        expectedExpires: expiresIn15Days
      });

      // get the updated profile agent user document, zcaps should be updated
      // to expire in 15 days
      const updatedProfileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      updatedProfileAgentUserDoc.sequence.should.equal(1);
      const {
        zcaps: updatedProfileAgentUserDocZcaps
      } = updatedProfileAgentUserDoc.content;
      verifyZcapsExpiration({
        zcaps: updatedProfileAgentUserDocZcaps,
        expectedExpires: expiresIn15Days
      });

      // profileAgent user doc zcaps and profile agent zcaps should be refreshed
      // when getAll() is called.
      const promises = [];
      for(let i = 0; i < 10; i++) {
        const refreshedAgentsPromise = profileAgents.getAll({accountId});
        promises.push(refreshedAgentsPromise);
      }
      const refreshedAgentsRecords = await Promise.all(promises);
      // All 10 calls should return a refreshed record, but only one should
      // have updated the record, expected the sequence to have incremented
      // only once and expected all calls to return records with refreshed
      // zcaps
      const expectedSequence = updatedRecord.profileAgent.sequence + 1;
      // Get the current year
      const currentYear = new Date().getFullYear();
      const expectedExpiresYear = currentYear + 1;
      refreshedAgentsRecords.forEach(records => {
        const refreshedAgent = records[0].profileAgent;
        refreshedAgent.sequence.should.equal(expectedSequence);
        const {zcaps: refreshedZcaps} = refreshedAgent;
        // zcaps expiration should have been set to a year from now
        verifyZcapsExpiration({
          zcaps: refreshedZcaps,
          expectedExpiresYear
        });
      });

      // get updated profile agent user doc zcaps
      const refreshedProfileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      // expected the profile agent user document sequence to have incremented
      // only once
      const expectedProfileAgentUserDocSequence =
        updatedProfileAgentUserDoc.sequence + 1;
      refreshedProfileAgentUserDoc.sequence.should.equal(
        expectedProfileAgentUserDocSequence);
      const {
        zcaps: refreshedProfileAgentUserDocZcaps
      } = refreshedProfileAgentUserDoc.content;
      // zcaps expiration should have been set to a year from now
      verifyZcapsExpiration({
        zcaps: refreshedProfileAgentUserDocZcaps,
        expectedExpiresYear
      });

      // FIXME: ensure zcaps still work!
    });

    it('should refresh zcaps for additional profile EDVs', async () => {
      const accountId = uuid();
      const didMethod = 'key';
      const newEdvOptions = {
        profile: {
          ...edvOptions.profile,
          additionalEdvs: [
            {referenceId: 'credentials'},
            {referenceId: 'inbox'}
          ]
        }
      };
      let error;
      let profile;
      try {
        profile = await profiles.create({
          accountId, didMethod, edvOptions: newEdvOptions, keystoreOptions
        });
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profile);
      profile.id.should.be.a('string');
      profile.edvs.should.be.an('object');
      profile.edvs.should.include.keys(['user', 'credentials', 'inbox']);

      // FIXME: get existing zcaps

      // FIXME: confirm zcaps have been refreshed

      // FIXME: read and write with refreshed zcaps
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

async function getProfileAgentUserDoc({
  edvClient, kmsClient, profileSigner, docId, edvConfig
} = {}) {
  try {
    return getEdvDocument({
      docId, edvConfig, edvClient, kmsClient, profileSigner
    });
  } catch(e) {
    assertNoError(e);
  }
}

async function updateZcapsExpiration({
  profileAgent, profileAgentUserDoc, newExpires, edvClient, profileSigner
} = {}) {
  let zcaps;
  if(profileAgent) {
    ({zcaps} = profileAgent);
  } else if(profileAgentUserDoc) {
    ({zcaps} = profileAgentUserDoc.content);
  }
  for(const zcapName in zcaps) {
    if(zcapName !== 'profileCapabilityInvocationKey') {
      const zcap = zcaps[zcapName];
      zcap.expires = newExpires;
      // also backdate `created` on proof to ensure an update will occur
      zcap.proof.created = new Date(0).toISOString();
    }
  }
  if(profileAgent) {
    // update the profileAgent
    profileAgent.sequence += 1;
    await profileAgents.update({
      profileAgent
    });
  }
  if(profileAgentUserDoc) {
    // update profile agent user doc
    await edvClient.update({
      doc: profileAgentUserDoc,
      invocationSigner: profileSigner,
      keyResolver,
    });
  }
}

function verifyZcapsExpiration({
  zcaps, expectedExpires, expectedExpiresYear
} = {}) {
  for(const zcapName in zcaps) {
    if(zcapName === 'profileCapabilityInvocationKey') {
      continue;
    }
    const zcap = zcaps[zcapName];
    if(expectedExpires) {
      zcap.expires.should.equal(expectedExpires);
    }
    if(expectedExpiresYear) {
      // zcaps expiration should have been set to a year from now
      const zcapExpiresYear = new Date(zcap.expires).getFullYear();
      zcapExpiresYear.should.equal(expectedExpiresYear);
    }
  }
}
