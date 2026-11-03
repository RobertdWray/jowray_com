import { spawnSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

import { describe, expect, it } from "vitest";

const guardUrl = new URL("../../scripts/no-network.mjs", import.meta.url).href;
const blockedMessage = "[no-network] blocked outbound connection to example.com";

function runGuarded(script: string) {
  const result = spawnSync(process.execPath, ["--import", guardUrl, "-e", script], {
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

describe("no-network preload", () => {
  it("blocks fetch before connecting to an external host", () => {
    const stdout = runGuarded(`
      fetch("https://example.com").catch((error) => {
        console.log(error.cause?.message ?? error.message);
      });
    `);
    expect(stdout).toContain(blockedMessage);
  });

  it("rejects dns.promises.lookup for an external host", () => {
    const stdout = runGuarded(`
      const dns = require("node:dns");
      dns.promises.lookup("example.com").catch((error) => {
        console.log(error.message);
      });
    `);
    expect(stdout).toContain(blockedMessage);
  });

  it("throws from dns.lookup for an external host", () => {
    const stdout = runGuarded(`
      const dns = require("node:dns");
      try {
        dns.lookup("example.com", () => {});
      } catch (error) {
        console.log(error.message);
      }
    `);
    expect(stdout).toContain(blockedMessage);
  });

  it.each([
    ["net.connect(port, callback)", (port: number) => `net.connect(${JSON.stringify(port)}, onConnect)`],
    [
      "net.connect(options, callback)",
      (port: number) => `net.connect({ port: ${JSON.stringify(port)}, host: "127.0.0.1" }, onConnect)`,
    ],
    [
      "Socket.connect(port, callback)",
      (port: number) => `new net.Socket().connect(${JSON.stringify(port)}, onConnect)`,
    ],
  ])("allows %s to connect to a loopback server", async (_signature, connection) => {
    const server = net.createServer((socket) => socket.end());
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected a TCP server address");
      }
      const stdout = runGuarded(`
        const net = require("node:net");
        function onConnect() {
          console.log("connected");
          this.destroy();
        }
        ${connection(address.port)};
      `);
      expect(stdout.trim()).toBe("connected");
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    }
  });

  it("blocks net.connect options with an external host", () => {
    const stdout = runGuarded(`
      const net = require("node:net");
      try {
        net.connect({ port: 443, host: "example.com" })
          .on("error", (error) => console.log(error.message));
      } catch (error) {
        console.log(error.message);
      }
    `);
    expect(stdout).toContain(blockedMessage);
  });

  it("blocks https.get to an external host", () => {
    const stdout = runGuarded(`
      const https = require("node:https");
      try {
        https.get("https://example.com")
          .on("error", (error) => console.log(error.message));
      } catch (error) {
        console.log(error.message);
      }
    `);
    expect(stdout).toContain(blockedMessage);
  });
});
