import { describe, expect, it } from "vitest";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import { databaseConfig } from "../src/server/database-config";
import { supabaseCa } from "../src/server/supabase-ca";

describe("database TLS configuration", () => {
  it("uses a valid self-signed CA supplied by the operator", () => {
    const cert = new X509Certificate(supabaseCa);
    expect(cert.ca).toBe(true);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(Date.parse(cert.validTo)).toBeGreaterThan(Date.now());
  });
  it("enforces TLS verification despite conflicting URL options", () => {
    const config = databaseConfig(
      "postgresql://u:p@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=no-verify&sslrootcert=bad&ssl=false",
    );
    const ssl = config.ssl as Exclude<typeof config.ssl, boolean | undefined>;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.servername).toBe("aws-1-eu-central-1.pooler.supabase.com");
    expect(ssl.ca).toContain(supabaseCa);
    expect(ssl.checkServerIdentity).toBeUndefined(); // Node's secure default.
    expect(
      checkServerIdentity(
        "wrong.example",
        new X509Certificate(supabaseCa).toLegacyObject(),
      ),
    ).toBeInstanceOf(Error);
    expect(new URL(config.connectionString!).search).toBe("");
  });
  it("does not apply provider trust to other endpoints", () => {
    const connectionString = "postgresql://u:p@localhost:5432/test";
    expect(databaseConfig(connectionString)).toEqual({ connectionString });
    const spoof =
      "postgresql://u:p@aws-1-eu-central-1.pooler.supabase.com.evil.example/db";
    expect(databaseConfig(spoof)).toEqual({ connectionString: spoof });
  });
});
