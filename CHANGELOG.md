# bedrock-profile ChangeLog

### 7.0.0 - 2020-09-25

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
