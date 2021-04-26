/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {didIo} = require('bedrock-did-io');
const {documentLoader} = require('bedrock-jsonld-document-loader');

module.exports = async url => {
  let document;
  if(url.startsWith('did:')) {
    document = await didIo.get({did: url, forceConstruct: true});
    // FIXME: Remove the startsWith() logic once did-io.get() return signature
    // is updated.
    if(url.startsWith('did:v1:')) {
      document = document.doc;
    }
    return {
      contextUrl: null,
      documentUrl: url,
      document
    };
  }

  // finally, try the bedrock document loader
  return documentLoader(url);
};
