/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const database = require('bedrock-mongodb');
const {profiles} = require('bedrock-profile');
const helpers = require('./helpers');
const mockData = require('./mock.data');
const {util: {uuid}} = require('bedrock');

describe('profiles API', () => {
  // mock session authentication for delegations endpoint
  let passportStub;
  let profileAgentCollection;
  let kmsKeystoreCollection;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
    profileAgentCollection = database.collections['profile-profileAgent'];
    kmsKeystoreCollection = database.collections.kmsKeystore;
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
        profile = await profiles.create({accountId, didMethod});
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
    });
    it('keystore should be controlled by the profile', async () => {
      const accountId = uuid();
      const didMethod = 'key';
      let error;
      let profile;
      try {
        profile = await profiles.create({accountId, didMethod});
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
      a.should.have.keys(['_id', 'id', 'controller', 'meta', 'config']);
      a.config.should.have.keys(['id', 'sequence', 'controller']);
      a.config.controller.should.equal(profile.id);
    });
    it('should throw error if didMethod is not `key` or `v1`', async () => {
      const accountId = uuid();
      const didMethod = 'some-other-method';
      let error;
      let profile;
      try {
        profile = await profiles.create({accountId, didMethod});
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
          profile = await profiles.create({accountId, didMethod});
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
          profile = await profiles.create({accountId, didMethod});
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
        profile = await profiles.create({accountId, didMethod, didOptions});
      } catch(e) {
        error = e;
      }
      should.exist(error);
      should.not.exist(profile);
      error.message.should.equal('didOptions (object) is required');
    });
  });
}); // end profiles API
