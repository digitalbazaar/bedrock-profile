# bedrock-profile ChangeLog

## 12.0.0 - 2021-08-31

### Changed
- **BREAKING**: A `meterId` parameter is now required in `keystoreOptions`
  instead of a `meterCapability`. This version of the module must be used
  in conjunction with a KMS service that accepts `meterId` in keystore
  configs instead of `meterCapability`. This simplifies the keystore creation
  process whereby the KMS service is the root controller for the meter's
  usage endpoint instead of requiring the KMS service to have a delegated
  meter usage zcap to report usage.

## 11.0.0 - 2021-08-24

### Changed
- **BREAKING**: Refactor use of KMS system. Remove KMS related parameters from
  some public APIs. The KMS is now configured via the bedrock config.
- **BREAKING**: `keystoreOptions` must now be passed when creating
  profile agents or profiles. These options must specify the `meterCapability`
  and `meterCapabilityInvocationSigner` used when creating the keystore and
  may optionally provide the `kmsModule` to use (otherwise the configured
  default will be used). These options are now required since this version of
  the library now depends on a KMS system that requires a meter capability to
  create a keystore and keystore creation must be invoked by the controller
  of the associated meter.
- **BREAKING**: Require `config.profile.kms.defaultKmsModule` to be overridden
  in deployments.

## 10.0.4 - 2021-08-19

## Fixed
- Update deps to use fixed ed25519* packages.

## 10.0.3 - 2021-08-19

## Fixed
- Use bedrock-did-io@4.

## 10.0.2 - 2021-08-19

## Fixed
- Use did-method-key@2.0.0 with fixes broken ed25519* dependencies.

## 10.0.1 - 2021-06-02

### Changed
- Use did-veres-one@14.0.0-beta.1.

## 10.0.0 - 2021-05-21

### Changed
- **BREAKING**: Supports `ed25519-2020` signature suite and verification keys.
- **BREAKING**: Remove `referenceId: 'primary'`. `referenceId` is no longer set
  on any keyStores.
- Update deps.
  - **BREAKING**: Uses [@digitalbazaar/did-method-key@1.0](https://github.com/digitalbazaar/did-method-key-js/blob/master/CHANGELOG.md).
    - `did-method-key` has been renamed to `@digitalbazaar/did-method-key` and uses `crypto-ld@5.0` based key suites.
  - **BREAKING**: Renamed `ocapld` to [@digitalbazaar/zcapld@4.0](https://github.com/digitalbazaar/zcapld/blob/main/CHANGELOG.md).
    - fetchInSecurityContext API uses the new zcap-context.
  - **BREAKING**: Uses [@digitalbazaar/webkms-client@6.0](https://github.com/digitalbazaar/webkms-client/blob/main/CHANGELOG.md).
    - Uses new `webkms-context@1.0`, `aes-key-wrapping-2019-context@1.0.3`
      and `sha256-hmac-key-2019-context@1.0.3` libs.
  - **BREAKING**: Uses [did-veres-one@14.0.0-beta.0](https://github.com/veres-one/did-veres-one/blob/v14.x/CHANGELOG.md).
  - Uses [crypto-ld@6.0.0](https://github.com/digitalbazaar/crypto-ld/blob/master/CHANGELOG.md).
  - Uses [edv-client@9.0.0](https://github.com/digitalbazaar/edv-client/blob/master/CHANGELOG.md).
- Update test deps and peerDeps.

## 9.0.1 - 2021-04-14

### Fixed
- Include use of Node.js 12 in CI test matrix and `engines` requirement.
  Node.js 12 was removed in error as it is still LTS and there is no technical
  requirement preventing its use.

## 9.0.0 - 2021-03-02

### Changed
- **BREAKING**: Drop support for Node.js < 14.
- **BREAKING**: Update to latest KMS keystore config data model. The data model
  no longer includes `invoker` or `delegator`.
- Use `KeystoreAgent` to update keystore configs vs using the `bedrock-kms` API
  directly.
- **BREAKING**: Use `webkms-client@3`. Implements changes in the
  http-signature-zcap headers used to interact with the KMS system.

## 8.0.0 - 2020-12-11

### Added
- **BREAKING**: `didMethod` is now a required param when creating profile.

## 7.1.0 - 2020-09-28

### Changed
- Use edv-client@6.
- Use did-method-key@0.7.0.

## 7.0.0 - 2020-09-25

### Added
- **BREAKING**: New required params `privateKmsBaseUrl` and `publicKmsBaseUrl`
  to the `profileAgents.create` and `profile.create` APIs. The keystore for the
  profile agents zCap key is created in the private KMS because it is accessed
  by a `capabilityAgent` that is generated from a secret that is stored in the
  database. If the database is stolen, the attacker cannot use the secret
  to hit the private KMS. The attacker must also break into the network.

## 6.3.1 - 2020-09-25

### Fixed
- Fix zcap to not throw error when expires has passed expiration date.

## 6.3.0 - 2020-09-16

### Added
- Add `expires` date to capabilities created by the `delegateCapability` API.

## 6.2.0 - 2020-07-07

### Changed
- Update peer deps, test deps and CI workflow.

### Fixed
- Fix usage of the MongoDB projection API.

## 6.1.0 - 2020-06-30

### Changed
- Update test deps.
- Update CI workflow.

## Fixed
- Remove unused bedrock-account peer dep.

## 6.0.0 - 2020-06-23

### Changed
- **BREAKING**: Upgrade from edv-client@2 to edv-client@4. This is a breaking
  change here because edv-client@3 changed the way EDV documents are serialized.

## 5.0.0 - 2020-06-09

### Changed
- **BREAKING**: Upgraded bedrock-mongodb to ^7.0.0.
- Swapped out old mongo API for mongo driver 3.5 api.

## 4.2.0 - 2020-05-15

### Changed
- Update dependencies to use a release.

## 4.1.0 - 2020-04-16

### Added
- Added support for VeresOne type DIDs for profiles.

## 4.0.0 - 2020-04-03

### Changed
- **BREAKING**: Change data model for capability invocation key storage.

### Added
- Add `getSigner` API.

## 3.0.0 - 2020-04-02

### Changed
- **BREAKING** - Change data model for profile agents.
- **BREAKING** - Use ocapld@2.

### Added
- Add support for application tokens.
- Add `includeSecrets` param to multiple APIs.

## 2.0.0 - 2020-03-12

### Changed
- **BREAKING** - Change data model for profile agents.
- **BREAKING** - Remove `capabilitySets` collection and API.

## 1.0.0 - 2020-03-06

### Added
- Added core files.

- See git history for changes.
