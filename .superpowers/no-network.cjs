// Offline-build proof: loaded through NODE_OPTIONS=--require in every Node
// process (Next.js, Turbopack's loader pool, Vitest). Any attempt to resolve
// or connect to a non-loopback host throws, so a build that needs the
// network fails loudly instead of silently downloading.
const dns = require("node:dns");
const net = require("node:net");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"]);
function deny(host) {
  const err = new Error(`[no-network] blocked connection to ${host}`);
  err.code = "ENETUNREACH";
  process.stderr.write(err.message + "\n");
  return err;
}
function isLoopback(host) {
  return host === undefined || LOOPBACK.has(String(host)) || String(host).startsWith("127.");
}
const origLookup = dns.lookup;
dns.lookup = function (host, ...rest) {
  if (!isLoopback(host)) {
    const cb = rest[rest.length - 1];
    if (typeof cb === "function") { process.nextTick(() => cb(deny(host))); return; }
    throw deny(host);
  }
  return origLookup.call(this, host, ...rest);
};
const origPromisesLookup = dns.promises.lookup;
dns.promises.lookup = function (host, ...rest) {
  if (!isLoopback(host)) { return Promise.reject(deny(host)); }
  return origPromisesLookup.call(this, host, ...rest);
};
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const opts = typeof args[0] === "object" && args[0] !== null ? args[0] : { host: args[1] };
  const host = opts.path ? undefined : opts.host;
  if (!isLoopback(host)) { process.nextTick(() => this.destroy(deny(host))); return this; }
  return origConnect.apply(this, args);
};
