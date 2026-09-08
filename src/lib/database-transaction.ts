import { Client } from '@neondatabase/serverless';

export interface TransactionClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

interface ManagedTransactionClient extends TransactionClient {
  connect(): Promise<void>;
  end(): Promise<void>;
}

type ClientFactory = (connectionString: string) => ManagedTransactionClient;

const createClient: ClientFactory = (connectionString) =>
  new Client(connectionString) as unknown as ManagedTransactionClient;

/** Run interactive work on one connection so BEGIN/COMMIT are meaningful. */
export async function withDatabaseTransaction<T>(
  connectionString: string,
  work: (client: TransactionClient) => Promise<T>,
  clientFactory: ClientFactory = createClient,
): Promise<T> {
  const client = clientFactory(connectionString);
  await client.connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[database] transaction rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    await client.end();
  }
}
