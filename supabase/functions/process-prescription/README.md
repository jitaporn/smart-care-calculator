# Typhoon Edge Function

Deploy from the project directory:

```powershell
supabase functions deploy process-prescription
supabase secrets set TYPHOON_API_KEY=...
supabase secrets set TYPHOON_API_URL=...
supabase secrets set TYPHOON_OCR_MODEL=...
supabase secrets set TYPHOON_LLM_MODEL=...
```

`TYPHOON_API_URL` must be the OpenAI-compatible API base URL supplied by the
Typhoon account, without `/chat/completions`.

Never place `TYPHOON_API_KEY` in `config.js` or browser code.
