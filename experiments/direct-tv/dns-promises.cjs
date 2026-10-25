'use strict';
module.exports = { lookup: require('util').promisify(require('dns').lookup) };
