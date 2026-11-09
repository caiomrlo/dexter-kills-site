// Builds procedural texture pixels off the main thread (see texture-pixels.js).
// Each message is one job name; the reply carries its RGBA buffers (transferred, not copied).
import { texturePixelsJob, collectBuffers } from './texture-pixels.js';

self.onmessage = (e) => {
  const job = e.data;
  try {
    const result = texturePixelsJob(job);
    self.postMessage({ job, result }, collectBuffers(result));
  } catch (err) {
    self.postMessage({ job, error: String(err && err.message ? err.message : err) });
  }
};
