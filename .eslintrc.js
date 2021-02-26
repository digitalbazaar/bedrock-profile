module.exports = {
  env: {
    node: true
  },
  extends: [
    'digitalbazaar',
    'digitalbazaar/jsdoc',
  ],
  parserOptions: {
    ecmaVersion: 2020,
  },
  root: true,
  ignorePatterns: ['node_modules/']
};
