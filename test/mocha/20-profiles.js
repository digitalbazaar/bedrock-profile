/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {CapabilityAgent} = require('@digitalbazaar/webkms-client');
const database = require('bedrock-mongodb');
const {profiles} = require('bedrock-profile');
const helpers = require('./helpers');
const mockData = require('./mock.data');
const {util: {uuid}} = require('bedrock');

describe('profiles API', () => {
  // top-level application capability agent for creating meters
  let capabilityAgent;
  let edvOptions;
  let keystoreOptions;
  // mock session authentication for delegations endpoint
  let passportStub;
  let profileAgentCollection;
  let kmsKeystoreCollection;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
    profileAgentCollection = database.collections['profile-profileAgent'];
    kmsKeystoreCollection = database.collections['kms-keystore'];

    // top-level applications must create meters to associate with the
    // creation of profile agents; the tests here reuse the same meter but
    // applications can create as many as needed
    const secret = 'b07e6b31-d910-438e-9a5f-08d945a5f676';
    const handle = 'app';
    capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});
  });
  beforeEach(async () => {
    const {id: edvMeterId} = await helpers.createMeter({
      capabilityAgent,
      type: 'edv'
    });
    const {id: kmsMeterId} = await helpers.createMeter({
      capabilityAgent,
      type: 'webkms'
    });
    edvOptions = {
      profile: {
        meterId: edvMeterId,
        meterCapabilityInvocationSigner: capabilityAgent.getSigner()
      }
    };
    keystoreOptions = {
      profileAgent: {
        meterId: kmsMeterId,
        meterCapabilityInvocationSigner: capabilityAgent.getSigner()
      },
      profile: {
        meterId: kmsMeterId,
        meterCapabilityInvocationSigner: capabilityAgent.getSigner()
      }
    };
  });
  after(() => {
    passportStub.restore();
  });

  describe('Create Profile', () => {
    it('successfully create a profile', async () => {
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
      a.profileAgent.controller.should.have.keys(['id', 'keystore']);
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
      const agents = await kmsKeystoreCollection.find({
        'config.controller': profile.id,
      }).toArray();
      agents.should.have.length(1);
      const [a] = agents;
      a.should.have.keys(['_id', 'meta', 'config']);
      a.config.should.have.keys(
        ['id', 'sequence', 'controller', 'meterId', 'kmsModule']);
      a.config.controller.should.equal(profile.id);
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
