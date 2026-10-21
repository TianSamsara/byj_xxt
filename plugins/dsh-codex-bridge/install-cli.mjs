// Run with the installed Harness executable in Electron's Node mode.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const resources = process.env.DSH_CODEX_INSTALL_RESOURCES;
if (!resources || !path.isAbsolute(resources)) throw new Error('Missing installed Harness resources directory');
const runtime = path.join(resources, 'app.asar', 'dsh');
const { runDesktopCli } = await import(pathToFileURL(path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')).href);
await runDesktopCli(runtime, path.join(resources, 'runtime'));
