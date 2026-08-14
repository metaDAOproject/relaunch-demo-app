// Node globals that Anchor and its dependency tree reach for in the browser.
import { Buffer } from "buffer";

const g = globalThis as any;
if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = { env: {} };
