/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import '@bedrock/ssm-mongodb';
import '@bedrock/kms';
import '@bedrock/edv-storage';
import '@bedrock/account';
import '@bedrock/app-identity';
import '@bedrock/https-agent';
import '@bedrock/jsonld-document-loader';
import '@bedrock/meter';
import '@bedrock/meter-usage-reporter';
import {handlers} from '@bedrock/meter-http';
import '@bedrock/passport';
import '@bedrock/server';
import '@bedrock/kms-http';
import '@bedrock/profile';
import {mockData} from './mocha/mock.data.js';

bedrock.events.on('bedrock.init', async () => {
  /* Handlers need to be added before `bedrock.start` is called. These are
  no-op handlers to enable meter usage without restriction */
  handlers.setCreateHandler({
    handler({meter} = {}) {
      // use configured meter usage reporter as service ID for tests
      const serviceType = mockData.productIdMap.get(meter.product.id);
      meter.serviceId = bedrock.config['app-identity'].seeds
        .services[serviceType].id;
      return {meter};
    }
  });
  handlers.setUpdateHandler({handler: ({meter} = {}) => ({meter})});
  handlers.setRemoveHandler({handler: ({meter} = {}) => ({meter})});
  handlers.setUseHandler({handler: ({meter} = {}) => ({meter})});
});

import '@bedrock/test';
bedrock.start();
