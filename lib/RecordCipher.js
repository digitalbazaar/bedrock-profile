/*!
 * Copyright (c) 2019-2026 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {decode, encode} from 'cborg';
import {generalDecrypt, GeneralEncrypt} from 'jose';

const {util: {BedrockError}} = bedrock;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/* Multikey registry IDs and encoded header values
aes-256 | 0xa2 | 256-bit AES symmetric key
*/
const SUPPORTED_KEK_TYPES = new Map([
  ['aes-256', {header: new Uint8Array([0xa2, 0x01]), size: 32}]
]);

export class RecordCipher {
  constructor({keks, currentKekId, encoding} = {}) {
    this.keks = keks;
    this.currentKekId = currentKekId;
    this.encoding = encoding;
  }

  /**
   * Decrypts `secrets`, if found, in a record.
   *
   * @param {object} options - The options to use.
   * @param {object} options.record - The record with optional `secrets` to
   *   encrypt.
   *
   * @returns {Promise<object>} An object with `encryptedSecrets` instead of
   *   `secrets`.
   */
  async decryptRecordSecrets({record} = {}) {
    if(record.encryptedSecrets === undefined) {
      // nothing to decrypt, return early
      return record;
    }

    try {
      // decrypt secrets
      const {encryptedSecrets, ...rest} = record;
      const {kekId, jwe} = encryptedSecrets;
      const secretKey = this.getKek({id: kekId});
      const {plaintext} = await generalDecrypt(jwe, secretKey);
      const secrets = this.encoding === 'cbor' ?
        _cborDecodeSecrets(plaintext) : _jsonDecodeSecrets(plaintext);

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

  /**
   * Encrypts `secrets`, if found, in a record.
   *
   * @param {object} options - The options to use.
   * @param {object} options.record - The record with optional `secrets` to
   *   encrypt.
   *
   * @returns {Promise<object>} An object with `encryptedSecrets` instead of
   *   `secrets`.
   */
  async encryptRecordSecrets({record} = {}) {
    if(record.encryptedSecrets !== undefined) {
      // should not happen; bad call
      throw new Error(
        'Could not encrypt record secrets; secrets already encrypted.');
    }

    try {
      // get current wrap key ID
      const kekId = this.currentKekId;
      if(!kekId) {
        // no KEK config; return early
        return record;
      }

      // encrypt secrets
      const {secrets, ...nonSecrets} = record;
      const plaintext = this.encoding === 'cbor' ?
        _cborEncodeSecrets(secrets) : _jsonEncodeSecrets(secrets);
      const secretKey = this.getKek({id: kekId});
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

  getKek({id} = {}) {
    const secretKey = this.keks.get(id);
    if(secretKey) {
      return secretKey;
    }
    throw new BedrockError(`Key encryption key "${id}" not found.`, {
      name: 'NotFoundError',
      details: {
        public: true,
        httpStatusCode: 400
      }
    });
  }

  isSecretsEncryptionEnabled() {
    return this.currentKekId !== null;
  }

  /**
   * Creates a `RecordCipher` instance for encrypting and/or decrypting
   * record `secrets`. The default encoding mode for the `secrets` is `cbor`,
   * which supports any binary subfields present in `secrets`. The encoding
   * can alternatively be set to `json` for backwards compatiblity with
   * modules that previously encoded using JSON, not CBOR.
   *
   * @param {object} options - The options to use.
   * @param {object} options.config - The configuration to use which is
   *   expected to have a `kek` property that includes an `id` value for the
   *   KEK to use for encryption and decryption as well as the
   *   `secretKeyMultibase` including a base64url-encoded AES-256 key value.
   * @param {string} [options.encoding='cbor'] - The encoding to use for the
   *   values found in `secrets`; either `cbor` or `json`, `cbor` supports
   *   binary values and `json` does not and is only provided for backwards
   *   compatibility.
   *
   * @returns {Promise<RecordCipher>} A new RecordCipher instance based on
   *   the given configuration; if no KEKs are specified in the configuration
   *   then this instance will return `false` from
   *   `isSecretsEncryptionEnabled()`.
   */
  static fromConfig({config, encoding = 'cbor'} = {}) {
    const keks = new Map();
    let currentKekId = null;
    if(!(encoding === 'cbor' || encoding === 'json')) {
      throw new Error('"encoding" must be "cbor" or "json".');
    }

    const key = config?.kek;
    if(key) {
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
      currentKekId = key.id;
      keks.set(key.id, _loadKek(key.secretKeyMultibase));
    }

    return new RecordCipher({keks, currentKekId, encoding});
  }
}

function _cborDecodeSecrets(plaintext) {
  const decoded = decode(plaintext);
  // convert Uint8Arrays to Buffers for compatibility
  for(const [key, value] of Object.entries(decoded)) {
    decoded[key] = value instanceof Uint8Array ? Buffer.from(value) : value;
  }
  return decoded;
}

function _cborEncodeSecrets(secrets) {
  return encode(secrets);
}

function _jsonDecodeSecrets(plaintext) {
  return JSON.parse(TEXT_DECODER.decode(plaintext));
}

function _jsonEncodeSecrets(secrets) {
  const obj = secrets instanceof Map ?
    Object.fromEntries(secrets.entries()) : secrets;
  return TEXT_ENCODER.encode(JSON.stringify(obj));
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
