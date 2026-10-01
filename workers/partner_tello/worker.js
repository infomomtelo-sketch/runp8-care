// Entry point for wrangler. The prompt and the knowledge are plain Markdown
// files bundled as text (see [[rules]] in wrangler.toml); app.js holds the
// logic so test.mjs can run it under Node with the same files read from disk.
import prompt from './prompt.md';
import knowledge from './knowledge.md';
import { createHandler } from './app.js';

export default createHandler({ system: `${prompt}\n\n${knowledge}` });
