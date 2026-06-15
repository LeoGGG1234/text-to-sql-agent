import type { NextConfig } from 'next';
import webpack from 'webpack';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  webpack: (config) => {
    // @better-auth/kysely-adapter imports SQLite dialect files that
    // reference exports missing from `kysely` 0.29.x. We use Drizzle + Postgres,
    // so replace them with stubs.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /@better-auth\/kysely-adapter\/dist\/(bun-sqlite|d1-sqlite|node-sqlite)-dialect/,
        path.resolve(__dirname, 'src/lib/kysely-shim.ts'),
      ),
    );
    return config;
  },
};

export default nextConfig;
