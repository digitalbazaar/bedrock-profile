/*!
 * Copyright (c) 2020-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import * as helpers from './helpers.js';
import {profileAgents, profiles} from '@bedrock/profile';
import {getAppIdentity} from '@bedrock/app-identity';
import {mockData} from './mock.data.js';
import {v4 as uuid} from 'uuid';

describe('profiles API', () => {
  let edvOptions;
  let keystoreOptions;
  // mock session authentication for delegations endpoint
  let passportStub;
  let profileAgentCollection;
  let kmsKeystoreCollection;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = helpers.stubPassport();
    profileAgentCollection = database.collections['profile-profileAgent'];
    kmsKeystoreCollection = database.collections['kms-keystore'];
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

  describe('Create Profile', () => {
    it('should create a profile', async () => {
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
      profile.id.should.be.a('string');
      profile.id.startsWith('did:v1:').should.equal(true);
      const agents = await profileAgentCollection.find({
        'profileAgent.profile': profile.id,
      }).toArray();
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
      a.should.have.property('secrets');
      a.secrets.should.have.property('seed');

      profile.meters.should.be.an('array');
      const {meters} = profile;
      meters.should.have.length(2);
      const {meter: edvMeter} = meters.find(m => m.meter.serviceType === 'edv');
      edvMeter.id.should.equal(edvOptions.profile.meterId);
      edvMeter.profile.should.equal(profile.id);
      edvMeter.serviceType.should.equal('edv');
      edvMeter.referenceId.should.equal('profile:core:edv');
      const {meter: kmsMeter} = meters.find(
        m => m.meter.serviceType === 'webkms');
      kmsMeter.id.should.equal(keystoreOptions.profile.meterId);
      kmsMeter.profile.should.equal(profile.id);
      kmsMeter.serviceType.should.equal('webkms');
      kmsMeter.referenceId.should.equal('profile:core:webkms');
    });
    it('should remove an irrecoverable profile', async () => {
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

      // profile agent should exist
      let profileAgentId;
      try {
        const {profileAgent} = await profileAgents.getByProfile(
          {profileId: profile.id, accountId});
        should.exist(profileAgent);
        should.exist(profileAgent.id);
        profileAgentId = profileAgent.id;
      } catch(e) {
        error = e;
      }
      assertNoError(error);

      // should get profile agent by ID
      try {
        await profileAgents.get({id: profileAgentId});
      } catch(e) {
        error = e;
      }
      assertNoError(error);

      // now remove the profile ID from the profile agent to cause it to
      // be in an irrecoverable partial state from an older version of this
      // library
      await profileAgentCollection.updateOne({
        'profileAgent.id': profileAgentId
      }, {
        $unset: {'profileAgent.profile': true}
      });

      // now profile agent should be removed
      try {
        await profileAgents.get({id: profileAgentId});
      } catch(e) {
        error = e;
      }
      should.exist(error);
      error.name.should.equal('NotFoundError');
    });
    it('should remove a partially created profile', async () => {
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

      // profile agent should exist
      let profileAgentId;
      try {
        const {profileAgent} = await profileAgents.getByProfile(
          {profileId: profile.id, accountId});
        should.exist(profileAgent);
        should.exist(profileAgent.id);
        profileAgentId = profileAgent.id;
      } catch(e) {
        error = e;
      }
      assertNoError(error);

      // should get profile agent by ID
      try {
        await profileAgents.get({id: profileAgentId});
      } catch(e) {
        error = e;
      }
      assertNoError(error);

      // now remove the `userDocument` zcap from the profile agent to cause it
      // to be in a partially created state that is no longer supported by
      // this library
      await profileAgentCollection.updateOne({
        'profileAgent.id': profileAgentId
      }, {
        $unset: {'profileAgent.zcaps.userDocument': true}
      });

      // now profile agent should be removed
      try {
        await profileAgents.get({id: profileAgentId});
      } catch(e) {
        error = e;
      }
      should.exist(error);
      error.name.should.equal('NotFoundError');
    });
    it('keystore should be controlled by the profile', async () => {
      const accountId = uuid();
      const didMethod = 'key';
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
      profile.id.should.be.a('string');
      const keystores = await kmsKeystoreCollection.find({
        'config.controller': profile.id,
      }).toArray();
      keystores.should.have.length(1);
      const [keystore] = keystores;
      keystore.should.have.keys(['_id', 'meta', 'config']);
      keystore.config.should.have.keys(
        ['id', 'sequence', 'controller', 'meterId', 'kmsModule']);
      keystore.config.controller.should.equal(profile.id);
    });
    it('should create additional profile EDVs', async () => {
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
    });
    it('should throw error if didMethod is not `key` or `v1`', async () => {
      const accountId = uuid();
      const didMethod = 'some-other-method';
      let error;
      let profile;
      try {
        profile = await profiles.create({
          accountId, didMethod, edvOptions, keystoreOptions
        });
      } catch(e) {
        error = e;
      }
      should.exist(error);
      should.not.exist(profile);
      error.message.should.equal(`Unsupported DID method "${didMethod}".`);
    });
    it('should throw error if type of didMethod is not string', async () => {
      const accountId = uuid();
      const badTypes = [{}, false, undefined];
      for(const didMethod of badTypes) {
        let error;
        let profile;
        try {
          profile = await profiles.create({
            accountId, didMethod, edvOptions, keystoreOptions
          });
        } catch(e) {
          error = e;
        }
        should.exist(error);
        should.not.exist(profile);
        error.message.should.equal('didMethod (string) is required');
      }
    });
    it('should throw error if type of accountId is not string', async () => {
      const accountIds = [{}, false, undefined];
      const didMethod = 'key';
      for(const accountId of accountIds) {
        let error;
        let profile;
        try {
          profile = await profiles.create({
            accountId, didMethod, edvOptions, keystoreOptions
          });
        } catch(e) {
          error = e;
        }
        should.exist(error);
        should.not.exist(profile);
        error.message.should.equal('accountId (string) is required');
      }
    });
    it('should throw error if type of didOptions is not object', async () => {
      const accountId = uuid();
      const didMethod = 'key';
      const didOptions = 'string';
      let error;
      let profile;
      try {
        profile = await profiles.create({
          accountId, didMethod, edvOptions, keystoreOptions, didOptions
        });
      } catch(e) {
        error = e;
      }
      should.exist(error);
      should.not.exist(profile);
      error.message.should.equal('didOptions (object) is required');
    });
  });
}); // end profiles API
