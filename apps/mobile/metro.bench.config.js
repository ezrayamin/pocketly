// Metro config for jsCore perf bundles: the core plus the benchmark harness (metro.config.js).
module.exports = require('./metro.config').createConfig('js', { bench: true });
