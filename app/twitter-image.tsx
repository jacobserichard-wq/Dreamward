// app/twitter-image.tsx
//
// Reuse the Open Graph card for X/Twitter so shares there render the
// same branded 1200x630 image instead of a blank card. Re-exports the
// generated image + its metadata from opengraph-image.tsx.

export { default, alt, size, contentType } from "./opengraph-image";
