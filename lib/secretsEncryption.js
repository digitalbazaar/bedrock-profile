/*!
 * Copyright (c) 2019-2026 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {logger} from './logger.js';
import {RecordCipher} from './RecordCipher.js';

// load all key encryption keys (KEKs) from config
let RECORD_CIPHER;
bedrock.events.on('bedrock.init', async () => {
  await _loadKeks();
});

export async function decryptRecordSecrets({record} = {}) {
  return RECORD_CIPHER.decryptRecordSecrets({record});
}

export async function encryptRecordSecrets({record} = {}) {
  return RECORD_CIPHER.encryptRecordSecrets({record});
}

export function isSecretsEncryptionEnabled() {
  return RECORD_CIPHER.isSecretsEncryptionEnabled();
}

// exported for testing purposes only
export async function _loadKeks() {
  RECORD_CIPHER = await RecordCipher.fromConfig({
    config: bedrock.config.profile.profileAgent.secretsEncryption
  });
  const status = RECORD_CIPHER.isSecretsEncryptionEnabled() ?
    'enabled' : 'disabled';
  logger.info(`Profile agent record secrets encryption is ${status}.`);
}
