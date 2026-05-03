/*!
 * Copyright (c) 2019-2026 Digital Bazaar, Inc.
 */
import * as bedrock from '@bedrock/core';
import {logger} from './logger.js';
import {RecordCipher} from '@bedrock/record-cipher';

// load all key encryption keys (KEKs) from config
export let RECORD_CIPHER;
bedrock.events.on('bedrock.init', async () => {
  await _loadKeks();
});

// exported for testing purposes only
export async function _loadKeks() {
  const {kek} = bedrock.config.profile.profileAgent.secretsEncryption;
  const options = {
    currentKekId: null,
    keks: [],
    encoding: 'cbor'
  };
  if(kek !== null) {
    options.currentKekId = kek.id;
    options.keks.push(kek);
  }
  RECORD_CIPHER = await RecordCipher.create(options);
  const status = RECORD_CIPHER.isSecretsEncryptionEnabled() ?
    'enabled' : 'disabled';
  logger.info(`Profile agent record secrets encryption is ${status}.`);
}
