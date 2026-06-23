# Smart Care Calculator

Mobile-first PWA for medication/fluid calculations and reviewed prescription
extraction.

## Run locally

Serve this directory through localhost. Camera and service workers require a
secure context (`localhost` or HTTPS).

## Demo mode

Leave `config.js` empty. Authentication and history are stored in browser
localStorage. OCR uses a limited local parser and is not real Typhoon OCR.

## Supabase mode

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Deploy `supabase/functions/process-prescription`.
4. Set the Typhoon secrets described in the function README.
5. Add the Supabase project URL and anon key to `config.js`.

Only the Supabase anon key belongs in the browser. The Typhoon API key remains
an Edge Function secret.

## Clinical safety

The included medication content is a prototype derived from the supplied PDF.
It is not a validated formulary. A pharmacist/physician must verify dosing
rules, contraindications, renal/hepatic adjustments, compatibility, maximum
doses, and nursing guidance before production use.
