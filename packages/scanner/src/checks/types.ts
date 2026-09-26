import type { Finding } from "@mendwell/core";

/** A finding plus, for element-level issues, a PNG screenshot of the element (uploaded to R2 by the worker). */
export type ScannerFinding = Finding & { screenshot?: Buffer };
