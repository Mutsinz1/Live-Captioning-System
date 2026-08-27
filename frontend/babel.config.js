// Used only by jest (via babel-jest). The react-scripts webpack build sets
// babelrc:false / configFile:false and applies babel-preset-react-app itself,
// so this file does not affect `npm run build`.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
};
