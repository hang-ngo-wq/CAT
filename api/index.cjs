const mod = require('./_handler.cjs');
const app = mod.default || mod;

function handler(req, res) {
  return app(req, res);
}

handler.default = handler;
module.exports = handler;
