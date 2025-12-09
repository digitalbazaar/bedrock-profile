/*!
 * Copyright (c) 2019-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {decode, encode} from 'cborg';
import {generalDecrypt, GeneralEncrypt} from 'jose';
import {logger} from './logger.js';

const {util: {BedrockError}} = bedrock;

/* Multikey registry IDs and encoded header values
aes-256 | 0xa2 | 256-bit AES symmetric key
*/
export const SUPPORTED_KEK_TYPES = new Map([
  ['aes-256', {header: new Uint8Array([0xa2, 0x01]), size: 32}]
]);

// load all key encryption keys (KEKs) from config
const KEKS = new Map();
bedrock.events.on('bedrock.init', () => {
  _loadKeks();
});

export async function decryptRecordSecrets({record} = {}) {
  if(record.encryptedSecrets === undefined) {
    // nothing to decrypt, return early
    return record;
  }

  try {
    // decrypt secrets
    const {encryptedSecrets, ...rest} = record;
    const {kekId, jwe} = encryptedSecrets;
    const secretKey = _getKek(kekId);
    const {plaintext} = await generalDecrypt(jwe, secretKey);
    const secrets = _decodeSecrets(plaintext);

    // new record object w/decrypted secrets
    return {...rest, secrets};
  } catch(cause) {
    throw new BedrockError('Could not decrypt record secrets.', {
      name: 'OperationError',
      cause,
      details: {
        public: true,
        httpStatusCode: 500
      }
    });
  }
}

export async function encryptRecordSecrets({record} = {}) {
  if(record.encryptedSecrets !== undefined) {
    // should not happen; bad call
    throw new Error(
      'Could not encrypt record secrets; secrets already encrypted.');
  }

  try {
    // get current wrap key ID
    const kekId = _getCurrentKekId();
    if(!kekId) {
      // no KEK config; return early
      return record;
    }

    // encrypt secrets
    const {secrets, ...nonSecrets} = record;
    const plaintext = _encodeSecrets(secrets);
    const secretKey = _getKek(kekId);
    const jwe = await new GeneralEncrypt(plaintext)
      .setProtectedHeader({enc: 'A256GCM'})
      .addRecipient(secretKey)
      .setUnprotectedHeader({alg: 'A256KW', kid: kekId})
      .encrypt();

    // return new record w/encrypted secrets
    return {
      ...nonSecrets,
      encryptedSecrets: {kekId, jwe}
    };
  } catch(cause) {
    throw new BedrockError('Could not encrypt record secrets.', {
      name: 'OperationError',
      cause,
      details: {
        public: true,
        httpStatusCode: 500
      }
    });
  }
}

export function isSecretsEncryptionEnabled() {
  return !!_getCurrentKekId();
}

function _getCurrentKekId() {
  // get current wrap key ID
  return bedrock.config.profile.profileAgent.secretsEncryption?.kek?.id;
}

function _getKek(kekId) {
  const secretKey = KEKS.get(kekId);
  if(secretKey) {
    return secretKey;
  }
  throw new BedrockError(`Key encryption key "${kekId}" not found.`, {
    name: 'NotFoundError',
    details: {
      public: true,
      httpStatusCode: 400
    }
  });
}

function _loadKek(secretKeyMultibase) {
  if(!secretKeyMultibase?.startsWith('u')) {
    throw new BedrockError(
      'Unsupported multibase header; ' +
      '"u" for base64url-encoding must be used.', {
        name: 'NotSupportedError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
  }

  // check multikey header
  let keyType;
  let secretKey;
  const multikey = Buffer.from(secretKeyMultibase.slice(1), 'base64url');
  for(const [type, {header, size}] of SUPPORTED_KEK_TYPES) {
    if(multikey[0] === header[0] && multikey[1] === header[1]) {
      keyType = type;
      if(multikey.length !== (2 + size)) {
        // intentionally do not report what was detected because a
        // misconfigured secret could have its first two bytes revealed
        throw new BedrockError(
          'Incorrect multikey size or invalid multikey header.', {
            name: 'DataError',
            details: {
              public: true,
              httpStatusCode: 400
            }
          });
      }
      secretKey = multikey.subarray(2);
      break;
    }
  }
  if(keyType === undefined) {
    throw new BedrockError(
      'Unsupported multikey type; only AES-256 is supported.', {
        name: 'NotSupportedError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
  }

  return secretKey;
}

// exported for testing purposes only
export function _loadKeks() {
  KEKS.clear();
  const cfg = bedrock.config.profile.profileAgent;
  const key = cfg.secretsEncryption?.kek;
  if(!key) {
    logger.info('Profile agent record secrets encryption is disabled.');
  } else {
    if(!(key.id && typeof key.id === 'string')) {
      throw new BedrockError(
        'Invalid key encryption key configuration; ' +
        'key "id" must be a string.', {
          name: 'DataError',
          details: {
            public: true,
            httpStatusCode: 400
          }
        });
    }
    KEKS.set(key.id, _loadKek(key.secretKeyMultibase));
    logger.info('Profile agent record secrets encryption is enabled.');
  }
}

function _decodeSecrets(cbor) {
  const decoded = decode(cbor);
  // convert Uint8Arrays to Buffers for compatibility
  for(const [key, value] of decoded) {
    decoded[key] = value instanceof Uint8Array ? Buffer.from(value) : value;
  }
  return decoded;
}

function _encodeSecrets(secrets) {
  return encode(secrets);
}
