/*!
 * Copyright (c) 2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import {profileAgents, profiles} from '@bedrock/profile';
import {getAppIdentity} from '@bedrock/app-identity';
import {mockData} from './mock.data.js';
import {v4 as uuid} from 'uuid';

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
    // eslint-disable-next-line max-len
    it.only('should refresh profile agent zcaps when "profileAgents.getAll()" is ' +
      'called if the time remaining until their expiration date is equal to ' +
      'or less than the refresh threshold value.', async () => {
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
        agents = await profileAgents.getAll({accountId});
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
      // intentionally update zcaps expiration to a date 15 days from now
      // which is less than the refresh threshold value of 1 month
      const now = Date.now();
      // 15 days in milliseconds
      const expiresIn15Days = new Date(now + 15 * 24 * 60 * 60 * 1000);
      zcaps.userDocument.expires = expiresIn15Days;
      zcaps['user-edv-kak'].expires = expiresIn15Days;

      // update the profileAgent
      a.profileAgent.zcaps = zcaps;
      a.profileAgent.sequence = 2;
      await profileAgents.update({profileAgent: a.profileAgent});

      // get the updated profileAgent record
      const updatedRecord = await profileAgents.get({
        id: a.profileAgent.id
      });
      const {zcaps: updatedZcaps} = updatedRecord.profileAgent;
      updatedZcaps.userDocument.expires.should.eql(expiresIn15Days);
      updatedZcaps['user-edv-kak'].expires.should.eql(expiresIn15Days);

      // profileAgent zcaps must be refreshed when getAll() is called
      const refreshedAgents = await profileAgents.getAll({accountId});
      const {zcaps: refreshedZcaps} = refreshedAgents[0].profileAgent;
      refreshedZcaps.userDocument.expires.should.not.eql(expiresIn15Days);
      refreshedZcaps['user-edv-kak'].expires.should.not.eql(expiresIn15Days);

      // Get the current year
      const currentYear = new Date().getFullYear();
      // Check if the year in zcaps.expires is one year more than the current
      // year
      const userDocumentYear = new Date(refreshedZcaps.userDocument.expires)
        .getFullYear();
      const userEdvKakYear = new Date(refreshedZcaps['user-edv-kak'].expires)
        .getFullYear();
      userDocumentYear.should.equal(currentYear + 1);
      userEdvKakYear.should.equal(currentYear + 1);
    });
  });
});
