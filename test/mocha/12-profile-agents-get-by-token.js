/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import {getAppIdentity} from '@bedrock/app-identity';
import {mockData} from './mock.data.js';
import {profileAgents} from '@bedrock/profile';

const {util: {uuid}} = bedrock;

describe('profileAgents getByToken API', () => {
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
  it('successfully gets a profile agent by token', async () => {
    const profileId = uuid();
    const token = uuid();
    let error;
    let profileAgent;
    try {
      ({profileAgent} = await profileAgents.create({
        keystoreOptions, profileId, token, store: true
      }));
    } catch(e) {
      error = e;
    }
    assertNoError(error);

    error = null;
    profileAgent = null;
    let secrets;
    try {
      ({profileAgent, secrets} = await profileAgents.getByToken(
        {token, includeSecrets: true}));
    } catch(e) {
      error = e;
    }
    assertNoError(error);
    should.exist(profileAgent);
    profileAgent.profile.should.equal(profileId);
    profileAgent.sequence.should.equal(0);
    should.exist(secrets);
    secrets.token.should.equal(token);
  });
}); // end profileAgents getByToken API
