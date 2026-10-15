// Web Worker that runs a program off the main thread, so a loop that
// never ends can't freeze the page — the UI's stop button just terminates
// the worker. Output is streamed back in chunks as it's produced.

import { runProgram } from './runtime';

// The DOM typings are what the rest of the app compiles against, so the
// worker scope is typed by hand here
const worker = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent<{ source: string }>) => void) | null;
};

worker.onmessage = (e) => {
  const result = runProgram(e.data.source, {
    // Off the main thread we can afford a lot more work; the user has a
    // stop button and a wall-clock limit as the backstop
    stepLimit: 50_000_000,
    timeLimitMs: 20_000,
    onOutput: (text) => worker.postMessage({ type: 'output', text }),
  });
  worker.postMessage({ type: 'done', result });
};
