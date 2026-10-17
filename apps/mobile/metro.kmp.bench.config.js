// Metro config for kmpCore perf bundles: the core plus the benchmark harness (metro.config.js).
module.exports = require('./metro.config').createConfig('kmp', { bench: true });
