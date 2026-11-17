import { rootCertificates } from "node:tls";
import type { PoolConfig } from "pg";
import { supabaseCa } from "./supabase-ca";

export function databaseConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  // Trust this additional CA only for the confirmed production pooler.
  if (url.hostname !== "aws-1-eu-central-1.pooler.supabase.com") {
    return { connectionString };
  }
  // pg's URL SSL options overwrite the explicit ssl object. Remove them and
  // enforce certificate-chain AND hostname verification in the driver instead.
  for (const key of [
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "ssl",
    "uselibpqcompat",
  ]) {
    url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: {
      ca: [...rootCertificates, supabaseCa],
      rejectUnauthorized: true,
      servername: url.hostname,
    },
  };
}
