import { Pool } from "pg";
import { PostgresRunRepository, ensureSchema } from "../persistence/repository/postgres-repository";
import { createServer } from "./server";

const PORT = Number(process.env.API_PORT ?? 3001);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://camevo:camevo@localhost:5432/camevo";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  await ensureSchema(pool);

  const repository = new PostgresRunRepository(pool);
  const server = createServer(repository);

  server.listen(PORT, () => {
    console.log(`Camevo API escuchando en http://localhost:${PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error("No se pudo iniciar la API de Camevo:", error);
  process.exit(1);
});
