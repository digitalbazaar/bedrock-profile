/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const database = require('bedrock-mongodb');
const {profiles} = require('bedrock-profile');
const helpers = require('./helpers');
const mockData = require('./mock.data');
const {config, util: {uuid}} = require('bedrock');

const privateKmsBaseUrl = `${config.server.baseUri}/kms`;
const publicKmsBaseUrl = `${config.server.baseUri}/kms`;

describe('profiles API', () => {
  // mock session authentication for delegations endpoint
  let passportStub;
  let profileAgentCollection;
  let kmsKeystoreCollection;
  before(async () => {
    await helpers.prepareDatabase(mockData);
    passportStub = await helpers.stubPassport();
    profileAgentCollection = database.collections['profile-profileAgent'];
    kmsKeystoreCollection = database.collections['kmsKeystore'];
  });
  after(() => {
    passportStub.restore();
  });

  describe('Create Profile', () => {
    it('successfully create a profile', async () => {
      const accountId = uuid();
      let error;
      let profile;
      try {
        profile = await profiles.create({
          accountId, privateKmsBaseUrl, publicKmsBaseUrl
        });
      } catch(e) {
        error = e;
      }
      assertNoError(error);
      should.exist(profile);
      profile.id.should.be.a('string');
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
        profile = await profiles.create({
          accountId, didMethod, privateKmsBaseUrl, publicKmsBaseUrl
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
      a.should.have.keys(['_id', 'id', 'controller', 'meta', 'config']);
      a.config.should.have.keys([
        'id', 'sequence', 'controller', 'invoker', 'delegator', 'referenceId'
      ]);
      a.config.controller.should.equal(profile.id);
    });
  });
}); // end profiles API
