# bedrock-profile ChangeLog

## 26.1.0 - 2025-05-22

### Changed
- Use `@digitalbazaar/lru-memoize@4`. Existing cache defaults and options
  are coerced from previous versions to the new version.

## 26.0.0 - 2025-03-08

### Changed
- Update peer dependencies.
  - `@bedrock/core@6.3.0`.
  - `@bedrock/jsonld-document-loader@5.2.0`.
  - **BREAKING**: `@bedrock/mongodb@11`.
    - Use MongoDB driver 6.x and update error names and details.
    - See changelog for details.
- Update dev dependencies.
- Update test dependencies.

## 25.0.2 - 2025-03-04

### Fixed
- Pass `includeResultMetadata: true` to `findOneAndUpdate` to ensure meta data
  is always returned.

## 25.0.1 - 2025-03-04

### Fixed
- Return passed `record` instead of resulting record from mongodb calls to
  enable using newer mongodb driver.
- Use `result.deletedCount` to enable newer mongodb driver.
- Remove unused `background` option from mongodb index creation.

## 25.0.0 - 2024-10-15

### Changed
- **BREAKING**: Remove support for deprecated and non-standard
  Ed25519Signature2018 use in zcap delegation. This is not
  expected to be used in many applications.
- Update dependencies.

## 24.0.1 - 2024-09-13

### Fixed
- Ensure core user EDV indexes when refreshing zcaps.

## 24.0.0 - 2024-08-05

### Changed
- **BREAKING**: Update peer deps:
  - `@bedrock/core@6.1.3`
  - `@bedrock/https-agent@4.1.0`
  - `@bedrock/jsonld-document-loader@5.1.0`
  - `@bedrock/mongodb@10.2.0`
- **BREAKING**: Update deps:
  - `@digitalbazaar/webkms-client@14.1.1`
- Update minor, test, and dev dependencies.

## 23.0.1 - 2023-10-12

### Fixed
- Update test deps.

## 23.0.0 - 2023-10-12

### Changed
- **BREAKING**: Drop support for Node.js < 18.
- **BREAKING**: Update peer deps:
  - Use `@bedrock/jsonld-document-loader@4.0.0`.
  - Use `@bedrock/mongodb@10.1`.
- Update deps:
  - Use `@digitalbazaar/ed25519-signature-2020@5.2`.
  - Use `@digitalbazaar/ed25519-verification-key-2020@4.1`.
  - Use `@digitalbazaar/edv-client@16.0` that drops support for Node.js < 18.
  - Use `@digitalbazaar/http-client@4.0` that requires Node.js 18+.
  - Use `@digitalbazaar/webkms-client@13.0` that drops support for Node.js < 18.

## 22.1.0 - 2023-09-25

### Added
- Added a new `zcap` config options for auto-refreshing and setting the TTLs
  for zcaps. These come with defaults that match existing behavior and add
  new auto-refresh behavior.
- Update `profileAgents.update()` to return updated record, previously it
  did not return any values.

### Changed
- `profileAgents.getAll()` will now update the zcaps in the profile agent
  mongodb record if the time remaining until their expiration is equal to
  or less than `zcap.autoRefreshThreshold` value. The zcaps in the profile
  agent's user EDV document will also be updated at that time if they were
  delegated more than `zcap.syncTimeDelta` milliseconds ago. This approach
  keeps the zcaps in the record and in the user EDV doc in sync when auto
  refreshing without performing more EDV document updates than are
  necessary when multiple concurrent processes are requesting profile
  agent records.

### Removed
- Remove `database.writeOptions` from database calls. These options should
  already have been set globally.

## 22.0.1 - 2022-12-06

### Fixed
- Ensure profile agent index on account is non-unique and that controller
  unique index is not present (as it is not needed and causes problems
  with sharding).

## 22.0.0 - 2022-12-06

### Changed
- **BREAKING**: Make profile agent secret tokens index non-unique. It
  is presumed that secret tokens will always be random and sufficiently
  large to make it infeasible for a conflict to occur.
- **BREAKING**: Indexes on `profile-profileAgent` must be dropped or
  updated if used with existing deployments.

### Fixed
- Ensure profile agents are indexed by account.

### Removed
- **BREAKING**: Remove adding any passed `referenceId` into keystore
  configs. This feature was unused and is no longer supported.

## 21.0.0 - 2022-11-13

### Changed
- **BREAKING**: Update `ezcap` and signature libraries to get better
  safe mode protections.

## 20.0.1 - 2022-08-14

### Changed
- Use `@digitalbazaar/edv-client@15.0.1`.

## 20.0.0 - 2022-08-13

### Changed
- **BREAKING**: Require Node.js >=16.
- Update dependencies.
- **BREAKING**: Update peer dependencies.
  - `@bedrock/app-identity@4`
- Test on Node.js 18.x.
- Lint module.
- Use `package.json` `files` field.

## 19.0.0 - 2022-05-05

### Changed
- **BREAKING**: Use `@digitalbazaar/edv-client@14` with new blind
  attribute version. This version is incompatible with previous
  versions and a manual migration must be performed to update all
  EDV documents to use the new blind attribute version -- or a new
  deployment is required.

## 18.0.0 - 2022-04-29

### Changed
- **BREAKING**: Update peer deps:
  - `@bedrock/core@6`
  - `@bedrock/app-identity@3`
  - `@bedrock/https-agent@4`
  - `@bedrock/jsonld-document-loader@3`
  - `@bedrock/mongodb@10`.

## 17.0.0 - 2022-04-18

### Changed
- **BREAKING**: Require `store` boolean parameter to be set to `true` or
  `false` in `profileAgents.create` to indicate whether the created
  profile agent record should be stored in the database or just returned.
- **BREAKING**: Require top-level applications to be the controllers
  of meters used to create keystores and EDVs for profiles/profile agents.
- **BREAKING**: Require `baseUrl` for EDV server to be passed in `edvOptions`
  when creating a profile.
- **BREAKING**: Require `profileId` to be given when creating a profile
  agent if it is to be stored immediately. This is to prevent root profile
  agents for profiles from being created in a partial state whereby profile
  provisioning cannot continue to completion at a later time.
- **BREAKING**: A new continuable profile provisioning process has been
  implemented.. This process means that "access management" will be
  automatically initialized when a profile is created. A new profile's root
  profile agent will not be written to the database until access management is
  initialized and the profile provisioning process is rendered continuable
  should it fail thereafter. If the process fails prior to writing the profile
  agent to the database, a profile will not be created leaving no local state
  behind (external state may be created and later garbage collected). This
  version of the library must not be used with other modules that attempt to
  initialize access management on the client; those client modules must be
  updated. If an old client module is used, it will experience errors and may
  create superfluous state, but it is not expected to corrupt existing
  profiles.

## 16.0.0 - 2022-04-06

### Changed
- **BREAKING**: Rename package to `@bedrock/profile`.
- **BREAKING**: Convert to module (ESM).
- **BREAKING**: Remove default export.
- **BREAKING**: Require node 14.x.

## 15.1.0 - 2022-03-29

### Changed
- Update peer deps:
  - `bedrock@4.5`
  - `bedrock-https-agent@2.3`
  - `bedrock-jsonld-document-loader@1.3`
  - `bedrock-mongodb@8.5`.
- Remove unused peer dep `bedrock-did-io`.
- Update internals to use esm style and use `esm.js` to
  transpile to CommonJS.

## 15.0.2 - 2022-03-18

### Changed
- Optimize profile creation by doing more steps in parallel.

### Fixed
- Fix root profile zcap invocation key zcap expires (to 1000y).
- Fix profile creation order so that profile agent has zcap
  stored prior to changing controller on profile keystore.

## 15.0.1 - 2022-03-01

### Fixed
- Remove unnecessary `bedrock-edv-storage` peer dependency.

## 15.0.0 - 2022-03-01

### Changed
- **BREAKING**: Use `@digitalbazaar/webkms-client@10` and
  `@digitalbazaar/edv-client@13`.
- **BREAKING**: Require `bedrock-edv-storage@12` as a peer dependency.

## 14.0.0 - 2022-02-23

### Changed
- **BREAKING**: Use `@digitalbazaar/edv-client@12`. This new version computes
  encrypted indexes differently (more privacy preserving) and is incompatible
  with the previous version.

## 13.2.0 - 2022-02-16

### Added
- Add ability to specify an account when removing a profile agent. If the
  account does not match the profile agent, then it will not be removed.

## 13.1.0 - 2022-02-10

### Changed
- Use `bedrock-did-io@6`.

## 13.0.1 - 2022-02-10

### Fixed
- Fix `getAgents` and `getSigner` to use proper keystore.

## 13.0.0 - 2022-02-10

### Added
- **BREAKING**: New required param `edvOptions` to the `profile.create` API.
  The edvOptions must contain a `meterCapabilityInvocationSigner` and a
  `meterId` to ensure the meter's controller can be updated to be the profile.

### Changed
- **BREAKING**: The `profileAgentCapabilityInvocationKey` zcap has removed
  `invoker` in favor of `controller`.
- **BREAKING**: The `referenceId` property has been removed on all zcaps.
- **BREAKING**: The capability agent that controls a profile agent no longer
  has its own keystore. The profile agent's keystore is now IP restricted
  and its controller is the capability agent. This eliminates an extra
  indirection and requires enforces stronger security on the profile agent.
  Any zcaps the profile agent has must be either invoked by system that
  has IP access to the profile agent's keystore -- or the zcaps must be
  delegated to another entity so that they can be invoked elsewhere.

## 12.0.1 - 2021-09-21

### Changed
- Update test dependency to `bedrock-meter-http@3` which requires tests to
  add a zCap invocation via http-sigs to create meters.

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
