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
import {KmsClient} from '@digitalbazaar/webkms-client';
import {mockData} from './mock.data.js';
import {v4 as uuid} from 'uuid';

const {
  getEdvConfig,
  getEdvDocument,
  getProfileSigner,
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
    it('should refresh profile agent user doc zcaps and profile agent zcaps' +
      'when "profileAgents.getAll()" is called if the time remaining until ' +
      'their expiration is equal to or less than the refresh threshold ' +
      'value.', async () => {
      const accountId = uuid();
      const didMethod = 'v1';
      let error;
      let profile;
      try {
        profile = await profiles.create({
          accountId, didMethod, edvOptions, keystoreOptions
        });
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profile);
      // should get all profile agents by accountId
      let agents;
      try {
        agents = await profileAgents.getAll({accountId, includeSecrets: true});
      } catch(e) {
        error = e;
      }
      assertNoError(error);
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
      const profileAgentRecord = agents[0];
      const kmsClient = new KmsClient({httpsAgent});
      const profileSigner = await getProfileSigner({
        kmsClient, profileAgentRecord
      });
      const docUrl = new URL(zcaps.userDocument.invocationTarget);
      const edvId =
        `${docUrl.protocol}//${docUrl.hostname}:${docUrl.port}` +
        `${docUrl.pathname.split('/').slice(0, 3).join('/')}`;
      const edvClient = new EdvClient({id: edvId, httpsAgent});
      const edvConfig = await getEdvConfig({edvClient, profileSigner});
      const docId = zcaps.userDocument.invocationTarget.split('/').pop();
      // get profile agent user doc
      const profileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      const updateProfileAgentUserDoc =
        JSON.parse(JSON.stringify(profileAgentUserDoc));
      const {zcaps: profileAgentUserDocZcaps} =
        updateProfileAgentUserDoc.content;
      for(const profileAgentUserDocZcapName in profileAgentUserDocZcaps) {
        if(
          profileAgentUserDocZcapName !== 'profileCapabilityInvocationKey'
        ) {
          const profileAgentUserDocZcap =
            profileAgentUserDocZcaps[profileAgentUserDocZcapName];
          // update the zcap's expires property
          profileAgentUserDocZcap.expires = expiresIn15Days;
        }
      }
      const updateProfileAgent = JSON.parse(JSON.stringify(a.profileAgent));
      const {zcaps: profileAgentZcaps} = updateProfileAgent;
      for(const profileAgentZcapName in profileAgentZcaps) {
        if(
          profileAgentZcapName !== 'profileCapabilityInvocationKey'
        ) {
          const profileAgentZcap = profileAgentZcaps[profileAgentZcapName];
          // update the zcap's expires property
          profileAgentZcap.expires = expiresIn15Days;
        }
      }
      // update profile agent user doc
      await edvClient.update({
        doc: updateProfileAgentUserDoc,
        invocationSigner: profileSigner,
        keyResolver,
      });
      // update the profileAgent
      updateProfileAgent.sequence = 2;
      await profileAgents.update({
        profileAgent: updateProfileAgent
      });

      // get the updated profileAgent record, zcaps should be updated to expire
      // in 15 days
      const updatedRecord = await profileAgents.get({
        id: a.profileAgent.id
      });
      const {zcaps: updatedProfileAgentZcaps} = updatedRecord.profileAgent;
      updatedProfileAgentZcaps.userDocument.expires.should.equal(
        expiresIn15Days);
      updatedProfileAgentZcaps['user-edv-kak'].expires.should.equal(
        expiresIn15Days);

      // get the updated profile agent user document
      const updatedProfileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      const {
        zcaps: updatedProfileAgentUserDocZcaps
      } = updatedProfileAgentUserDoc.content;
      for(const zcapName in updatedProfileAgentUserDocZcaps) {
        if(zcapName !== 'profileCapabilityInvocationKey') {
          const zcap = updatedProfileAgentUserDocZcaps[zcapName];
          zcap.expires.should.equal(expiresIn15Days);
        }
      }
      // profileAgent user doc zcaps and profile agent zcaps must be refreshed
      // when getAll() is called.

      // Get the current year
      const currentYear = new Date().getFullYear();

      const refreshedAgents = await profileAgents.getAll({accountId});
      const {zcaps: refreshedZcaps} = refreshedAgents[0].profileAgent;
      for(const zcapName in refreshedZcaps) {
        const zcap = refreshedZcaps[zcapName];
        zcap.expires.should.not.equal(expiresIn15Days);
        if(zcapName !== 'profileCapabilityInvocationKey') {
          // zcaps expiration should have been set to a year from now
          const zcapExpiresYear = new Date(zcap.expires).getFullYear();
          zcapExpiresYear.should.equal(currentYear + 1);
        }
      }
      // get updated profile agent user doc zcaps
      const refreshedProfileAgentUserDoc = await getEdvDocument({
        docId, edvConfig, edvClient, kmsClient, profileSigner
      });
      const {
        zcaps: refreshedProfileAgentUserDocZcaps
      } = refreshedProfileAgentUserDoc.content;
      for(const zcapName in refreshedProfileAgentUserDocZcaps) {
        const zcap = refreshedProfileAgentUserDocZcaps[zcapName];
        zcap.expires.should.not.equal(expiresIn15Days);
        if(zcapName !== 'profileCapabilityInvocationKey') {
          // zcaps expiration should have been set to a year from now
          const zcapExpiresYear = new Date(zcap.expires).getFullYear();
          zcapExpiresYear.should.equal(currentYear + 1);
        }
      }
    });
  });
});
