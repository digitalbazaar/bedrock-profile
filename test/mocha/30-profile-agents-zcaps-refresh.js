/*!
 * Copyright (c) 2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import * as utils from '@bedrock/profile/lib/utils.js';
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
  getProfileSigner,
  parseEdvId
} = utils;

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
    it('should refresh profile agent user doc zcaps and profile agent zcaps ' +
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
      const kmsClient = new KmsClient({httpsAgent});
      const profileSigner = await getProfileSigner({
        kmsClient, profileAgentRecord
      });
      const zcap = zcaps.userDocument;
      const edvId = parseEdvId({capability: zcap});
      const edvClient = new EdvClient({id: edvId, httpsAgent});
      const docId = zcap.invocationTarget.split('/').pop();
      const edvConfig = await getEdvConfig({edvClient, profileSigner});

      const profileAgentUserDoc = await getProfileAgentUserDoc({
        edvClient, kmsClient, profileSigner, docId, edvConfig
      });
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
      // Get the current year
      const currentYear = new Date().getFullYear();
      // zcaps expiration should have been set to a year from now
      const expectedExpiresYear = currentYear + 1;
      const {zcaps: refreshedZcaps} = refreshedAgents[0].profileAgent;
      verifyZcapsExpiration({
        zcaps: refreshedZcaps,
        expectedExpiresYear
      });
      // get updated profile agent user doc zcaps
      const refreshedProfileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      const {
        zcaps: refreshedProfileAgentUserDocZcaps
      } = refreshedProfileAgentUserDoc.content;
      verifyZcapsExpiration({
        zcaps: refreshedProfileAgentUserDocZcaps,
        expectedExpiresYear
      });
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
