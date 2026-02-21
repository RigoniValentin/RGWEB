/**
 * Path Resolver for Development & Packaged (pkg) Environments
 * ────────────────────────────────────────────────────────────
 * When running inside a `pkg`-compiled .exe, __dirname points to a
 * virtual snapshot filesystem. This module provides the REAL base
 * directory so that runtime files (appdata.ini, .env, frontend/dist)
 * are resolved relative to where the .exe lives on disk.
 *
 * Structure when deployed:
 *   RGWeb/
 *   ├── RGWeb.exe              ← compiled backend
 *   ├── appdata.ini            ← config file
 *   ├── .env                   ← env vars (PORT, JWT_SECRET)
 *   └── public/                ← frontend build (vite dist)
 *       ├── index.html
 *       └── assets/...
 */
import path from 'path';

/** true when running inside a pkg-compiled executable */
export const isPkg = !!(process as any).pkg;

/**
 * Root directory:
 * - Development : project root (3 levels up from dist/config/)
 * - Packaged    : directory where the .exe lives
 */
export const rootDir = isPkg
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '../../../');

/**
 * Frontend static files directory:
 * - Development : ../frontend/dist  (relative to project root)
 * - Packaged    : ./public          (next to the .exe)
 */
export const frontendDir = isPkg
  ? path.join(rootDir, 'public')
  : path.resolve(rootDir, 'frontend/dist');

/** appdata.ini — always next to the exe / project root */
export const appdataPath = path.join(rootDir, 'appdata.ini');

/** .env file — always next to the exe / project root */
export const envPath = path.join(rootDir, '.env');
