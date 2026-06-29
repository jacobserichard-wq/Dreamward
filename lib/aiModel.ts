// lib/aiModel.ts
//
// Single source of truth for the Anthropic model id used by every AI
// feature (PDF/receipt extraction, categorization, reclassify, invoice
// ingest) + the telemetry that records which model ran.
//
// Pinned to one snapshot on purpose. When Anthropic retires it, EVERY AI
// feature starts failing at once with an opaque "AI processing failed"
// (a 404 from the API). The fix is then a ONE-LINE change here + redeploy.
// The weekly founder digest probes this id and flags it if the model stops
// responding, so you hear about it before a customer does.
export const AI_MODEL = "claude-sonnet-4-6";
